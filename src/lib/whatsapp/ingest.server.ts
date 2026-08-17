/**
 * Processamento dos eventos recebidos da MEGA API.
 * Regras: idempotência, ignorar grupos/status, LID preservado,
 * status de entrega sempre por external_message_id.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { WhatsAppIdentifierService } from "@/lib/whatsapp/jid";
import { loadMegaCredentials } from "@/lib/whatsapp/credentials.server";
import { MegaApiService, extractConnectedPhone } from "@/lib/whatsapp/mega.server";

type Json = Record<string, unknown>;
type MessageType = "text" | "audio" | "image" | "document" | "video" | "system" | "other";

const MEDIA_BUCKET = "conversation-media";

/** Inclui a chave apenas quando há valor (exactOptionalPropertyTypes). */
function opt<K extends string, T>(key: K, value: T | null | undefined) {
  return (value === null || value === undefined ? {} : { [key]: value }) as Partial<Record<K, T>>;
}

function pick(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object") return (acc as Json)[part];
    return undefined;
  }, obj);
}

function firstString(source: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const value = pick(source, path);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function extractRemoteJid(payload: unknown): string | null {
  return firstString(payload, [
    "key.remoteJid",
    "data.key.remoteJid",
    "message.key.remoteJid",
    "data.message.key.remoteJid",
    "jid",
    "data.jid",
    "remoteJid",
    "data.remoteJid",
    "from",
    "data.from",
  ]);
}

export function extractText(payload: unknown): string | null {
  return firstString(payload, [
    "message.conversation",
    "message.extendedTextMessage.text",
    "message.imageMessage.caption",
    "message.videoMessage.caption",
    "message.documentMessage.caption",
    "message.buttonsResponseMessage.selectedDisplayText",
    "message.listResponseMessage.title",
    "message.ephemeralMessage.message.conversation",
    "message.ephemeralMessage.message.extendedTextMessage.text",
    "text",
    "body",
  ]);
}

export function detectMessageType(payload: unknown): MessageType {
  const message = pick(payload, "message");
  if (message && typeof message === "object") {
    const keys = Object.keys(message as Json);
    if (keys.some((k) => /audioMessage|pttMessage/i.test(k))) return "audio";
    if (keys.some((k) => /imageMessage|stickerMessage/i.test(k))) return "image";
    if (keys.some((k) => /videoMessage/i.test(k))) return "video";
    if (keys.some((k) => /documentMessage/i.test(k))) return "document";
  }
  return "text";
}

function normalizeEventType(payload: unknown, fallback: string | null): string {
  return (
    firstString(payload, ["event", "type", "eventType", "data.event", "data.type"]) ??
    fallback ??
    "unknown"
  );
}

const STATUS_MAP: Record<string, "SENT" | "DELIVERED" | "READ" | "FAILED"> = {
  "message.sent": "SENT",
  "messages.sent": "SENT",
  sent: "SENT",
  "message.delivered": "DELIVERED",
  delivery_ack: "DELIVERED",
  delivered: "DELIVERED",
  "message.read": "READ",
  read: "READ",
  played: "READ",
  "message.failed": "FAILED",
  failed: "FAILED",
  error: "FAILED",
};

export type IngestOutcome = {
  status: "ignored" | "duplicate" | "processed" | "error";
  reason?: string;
  messageId?: string;
};

export async function processWebhookEvent(input: {
  connectionId: string;
  companyId: string;
  payload: Json;
}): Promise<IngestOutcome> {
  const { connectionId, companyId, payload } = input;
  const body = (pick(payload, "data") as Json | undefined) ?? payload;
  const eventType = normalizeEventType(payload, null);

  // ---- Eventos de conexão da instância ----
  if (/connection|instance|qrcode|status\.instance/i.test(eventType)) {
    await handleConnectionEvent(connectionId, eventType, payload);
    return { status: "processed", reason: "connection" };
  }

  // ---- Eventos de status de mensagem ----
  const mappedStatus = STATUS_MAP[eventType.toLowerCase()];
  const externalId = firstString(body, ["key.id", "id", "messageId", "keyId"]);
  if (mappedStatus) {
    if (!externalId) return { status: "ignored", reason: "status sem id externo" };
    const { data } = await supabaseAdmin.rpc("update_message_delivery", {
      _company_id: companyId,
      _external_message_id: externalId,
      _status: mappedStatus,
      ...opt("_reason", firstString(body, ["reason", "error", "message"])),
    });
    return data ? { status: "processed" } : { status: "ignored", reason: "mensagem desconhecida" };
  }

  // ---- Mensagens ----
  const remoteJid = extractRemoteJid(payload);
  const parsed = WhatsAppIdentifierService.parse(remoteJid);
  if (!parsed) return { status: "ignored", reason: "sem remetente" };
  if (parsed.isGroup) return { status: "ignored", reason: "grupo" };
  if (parsed.isBroadcast) return { status: "ignored", reason: "status/broadcast" };
  if (!parsed.identifier) return { status: "ignored", reason: "identificador inválido" };

  const fromMe = Boolean(pick(body, "key.fromMe") ?? pick(payload, "key.fromMe"));
  if (fromMe) {
    // Mensagem enviada pelo próprio número: só atualizamos o status da mensagem
    // já registrada pelo painel. Nunca duplicamos histórico.
    if (externalId) {
      await supabaseAdmin.rpc("update_message_delivery", {
        _company_id: companyId,
        _external_message_id: externalId,
        _status: "SENT",
      });
    }
    return { status: "ignored", reason: "fromMe" };
  }

  const messageType = detectMessageType(body);
  const content = extractText(body);
  let mediaUrl: string | null = null;
  let mimeType: string | null =
    firstString(body, [
      "message.audioMessage.mimetype",
      "message.imageMessage.mimetype",
      "message.videoMessage.mimetype",
      "message.documentMessage.mimetype",
    ]) ?? null;

  if (messageType !== "text") {
    const stored = await downloadAndStoreMedia({
      connectionId,
      companyId,
      body,
      messageType,
    });
    if (stored) {
      mediaUrl = stored.path;
      mimeType = stored.mimeType ?? mimeType;
    }
  }

  const { data, error } = await supabaseAdmin.rpc("ingest_inbound_message", {
    _connection_id: connectionId,
    _remote_jid: parsed.jid,
    // o parâmetro aceita nulo no banco (mensagem sem id externo)
    _external_message_id: externalId ?? (null as unknown as string),
    ...opt("_push_name", firstString(body, ["pushName", "pushname", "notifyName", "senderName"])),
    _message_type: messageType,
    ...opt("_content", content),
    ...opt("_media_url", mediaUrl),
    ...opt("_mime_type", mimeType),
    _metadata: { remote_jid: parsed.jid, is_lid: parsed.isLid, event: eventType },
  });

  if (error) {
    console.error("[whatsapp] ingest falhou", error.message);
    return { status: "error", reason: error.message };
  }

  const result = (data ?? {}) as {
    duplicate?: boolean;
    message_id?: string;
    conversation_id?: string;
    lead_id?: string;
  };

  console.info("[whatsapp] mensagem processada", {
    evento: eventType,
    tipo: messageType,
    duplicada: Boolean(result.duplicate),
    conversa: result.conversation_id ?? null,
  });

  if (!result.duplicate && result.conversation_id) {
    const { respondWithAI } = await import("@/lib/ai/agent.server");
    const ai = await respondWithAI({
      companyId,
      conversationId: result.conversation_id,
      leadId: result.lead_id ?? null,
      connectionId,
    });
    console.info("[ia] resultado", ai.status, ai.reason ?? "");
  }

  return {
    status: result.duplicate ? "duplicate" : "processed",
    ...(result.message_id ? { messageId: result.message_id } : {}),
  };
}


async function handleConnectionEvent(connectionId: string, eventType: string, payload: unknown) {
  const raw = (
    firstString(payload, ["data.status", "status", "data.state", "state", "connection"]) ?? ""
  ).toUpperCase();

  let status: "CONNECTED" | "CONNECTING" | "DISCONNECTED" | "LOGGED_OUT" | "ERROR" | null = null;
  if (/OPEN|CONNECTED|ONLINE/.test(raw)) status = "CONNECTED";
  else if (/CONNECTING|PAIRING|QR/.test(raw) || /qrcode/i.test(eventType)) status = "CONNECTING";
  else if (/LOGGED_?OUT|LOGOUT/.test(raw)) status = "LOGGED_OUT";
  else if (/CLOSE|DISCONNECT|OFFLINE/.test(raw)) status = "DISCONNECTED";
  else if (/ERROR|FAIL/.test(raw)) status = "ERROR";
  if (!status) return;

  await supabaseAdmin.rpc("set_instance_connection_state", {
    _connection_id: connectionId,
    _status: status,
    ...opt("_phone_number", extractConnectedPhone(payload)),
    ...opt("_qr_code_status", raw || null),
  });
}

async function downloadAndStoreMedia(input: {
  connectionId: string;
  companyId: string;
  body: Json;
  messageType: MessageType;
}): Promise<{ path: string; mimeType: string | null } | null> {
  const creds = await loadMegaCredentials(input.connectionId);
  if (!creds) return null;

  const result = await MegaApiService.downloadMedia(
    creds,
    pick(input.body, "key") ?? input.body["key"],
    pick(input.body, "message"),
  );
  if (!result.ok) return null;

  const base64 = result.data?.data ?? result.data?.base64;
  if (!base64 || typeof base64 !== "string") return null;

  const clean = base64.includes(",") ? (base64.split(",")[1] ?? base64) : base64;
  const bytes = Uint8Array.from(atob(clean), (char) => char.charCodeAt(0));
  const mimeType = result.data?.mimetype ?? null;
  const extension =
    input.messageType === "audio"
      ? "ogg"
      : input.messageType === "image"
        ? "jpg"
        : input.messageType === "video"
          ? "mp4"
          : "bin";
  const path = `${input.companyId}/${input.connectionId}/${crypto.randomUUID()}.${extension}`;

  const { error } = await supabaseAdmin.storage.from(MEDIA_BUCKET).upload(path, bytes, {
    contentType: mimeType ?? "application/octet-stream",
    upsert: false,
  });
  if (error) {
    console.error("[whatsapp] upload de mídia falhou", error.message);
    return null;
  }
  return { path, mimeType };
}
