/**
 * Processamento dos eventos recebidos da MEGA API.
 * Regras: idempotência, ignorar grupos/status, LID preservado,
 * status de entrega sempre por external_message_id.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { WhatsAppIdentifierService } from "@/lib/whatsapp/jid";
import { PhoneNormalizationService } from "@/lib/nexa/phone";
import { loadMegaCredentials } from "@/lib/whatsapp/credentials.server";
import { MegaApiService, extractConnectedPhone } from "@/lib/whatsapp/mega.server";
import type { MediaKind } from "@/lib/whatsapp/media.server";

type Json = Record<string, unknown>;
type MessageType = "text" | "audio" | "image" | "sticker" | "document" | "video" | "system" | "other";

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

/**
 * Percorre o payload inteiro procurando a primeira chave que casa com o padrão.
 * A MEGA embrulha a mensagem de várias formas (ephemeral, viewOnce, editada,
 * documentWithCaption), então a busca precisa ser em profundidade.
 */
function deepFind(payload: unknown, pattern: RegExp, depth = 0): unknown {
  if (!payload || typeof payload !== "object" || depth > 8) return undefined;
  for (const [key, value] of Object.entries(payload as Json)) {
    if (pattern.test(key) && value !== null && value !== undefined) return value;
  }
  for (const value of Object.values(payload as Json)) {
    const found = deepFind(value, pattern, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function deepString(payload: unknown, pattern: RegExp): string | null {
  const found = deepFind(payload, pattern);
  return typeof found === "string" && found.trim() ? found.trim() : null;
}

export function extractText(payload: unknown): string | null {
  return (
    firstString(payload, [
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
    ]) ??
    deepString(payload, /^conversation$/i) ??
    deepString(payload, /^caption$/i) ??
    deepString(payload, /^(selectedDisplayText|selectedButtonId|title)$/i)
  );
}

/** Extrai o mime-type da mídia em qualquer profundidade do payload. */
export function extractMimeType(payload: unknown): string | null {
  const value = deepString(payload, /^mime_?type$/i);
  return value && value.includes("/") ? value : null;
}

/**
 * Número real do contato quando o remetente chega como LID.
 * A MEGA/Baileys envia o telefone em campos paralelos (senderPn, participantPn,
 * remoteJidAlt, participantAlt...). Devolve apenas dígitos válidos.
 */
export function extractRealPhone(payload: unknown): string | null {
  const candidate =
    firstString(payload, [
      "key.senderPn",
      "senderPn",
      "data.key.senderPn",
      "key.participantPn",
      "participantPn",
      "key.remoteJidAlt",
      "remoteJidAlt",
      "key.participantAlt",
      "participantAlt",
    ]) ?? deepString(payload, /^(senderPn|participantPn|remoteJidAlt|participantAlt|senderPhone)$/i);
  if (!candidate || candidate.includes("@lid")) return null;
  const local = candidate.split("@")[0]?.split(":")[0] ?? "";
  return PhoneNormalizationService.normalize(local);
}


export function detectMessageType(payload: unknown): MessageType {
  // 1) pela presença do nó da mídia, em qualquer nível
  if (deepFind(payload, /audioMessage|pttMessage/i) !== undefined) return "audio";
  if (deepFind(payload, /stickerMessage/i) !== undefined) return "sticker";
  if (deepFind(payload, /imageMessage/i) !== undefined) return "image";
  if (deepFind(payload, /videoMessage|gifMessage/i) !== undefined) return "video";
  if (deepFind(payload, /documentMessage/i) !== undefined) return "document";

  // 2) pelo mime-type informado no evento
  const mime = extractMimeType(payload);
  if (mime) {
    if (mime.startsWith("audio/")) return "audio";
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    return "document";
  }

  // 3) por campos textuais que descrevem o tipo (messageType, mediaType...)
  const declared = (
    deepString(payload, /^(messageType|message_type|mediaType|media_type)$/i) ?? ""
  ).toLowerCase();
  if (/audio|ptt|voice/.test(declared)) return "audio";
  if (/sticker/.test(declared)) return "sticker";
  if (/image|photo/.test(declared)) return "image";
  if (/video/.test(declared)) return "video";
  if (/document|file/.test(declared)) return "document";

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

/**
 * Procura uma mensagem de saída registrada pelo sistema nos últimos minutos
 * que ainda não recebeu o id externo. Evita duplicar o balão quando o eco do
 * WhatsApp chega antes (ou depois) de finalizarmos o envio.
 */
async function matchRecentOutbound(input: {
  companyId: string;
  identifier: string;
  messageType: string;
  content: string | null;
}): Promise<string | null> {
  const since = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data } = await supabaseAdmin
    .from("messages")
    .select("id, content, message_type, conversation:conversations!inner(channel_id)")
    .eq("company_id", input.companyId)
    .is("external_message_id", null)
    .neq("sender_type", "customer")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(20);

  const normalized = (input.content ?? "").trim();
  const match = (data ?? []).find((row) => {
    const channel = (row.conversation as { channel_id: string | null } | null)?.channel_id ?? null;
    if (channel && channel !== input.identifier) return false;
    if (row.message_type !== input.messageType) return false;
    if (input.messageType === "text") return (row.content ?? "").trim() === normalized;
    return true;
  });
  return match?.id ?? null;
}

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

  // Quando o remetente vem por LID, a MEGA costuma enviar também o número real
  // em campos paralelos (senderPn / participantPn / remoteJidAlt).
  const realPhone = parsed.isLid ? extractRealPhone(payload) : parsed.phone;


  const fromMe = Boolean(pick(body, "key.fromMe") ?? pick(payload, "key.fromMe"));
  const detected = detectMessageType(body);
  const messageType = detected === "text" ? detectMessageType(payload) : detected;
  const content = extractText(body) ?? extractText(payload);
  const mimeTypeHint: string | null = extractMimeType(body) ?? extractMimeType(payload);

  // Diagnóstico: evento sem texto e sem mídia identificada — registramos o
  // formato recebido para ajustar a leitura do payload.
  if (messageType === "text" && !content) {
    console.warn("[whatsapp] evento sem conteúdo reconhecido", JSON.stringify(payload).slice(0, 1500));
  }



  if (fromMe) {
    // Mensagem enviada pelo próprio número da empresa. Se ela já existe no
    // sistema (enviada pelo painel/IA), apenas atualizamos o status. Se foi
    // digitada direto no celular, registramos no histórico da conversa.
    if (externalId) {
      const { data: updated } = await supabaseAdmin.rpc("update_message_delivery", {
        _company_id: companyId,
        _external_message_id: externalId,
        _status: "SENT",
      });
      if (updated) return { status: "processed", reason: "status da própria mensagem" };
    }

    // A confirmação pode chegar antes de gravarmos o id externo da mensagem
    // que o próprio painel/IA acabou de enviar. Nesse caso, casamos pelo
    // conteúdo recente e apenas anexamos o id — nunca criamos um segundo balão.
    const pending = await matchRecentOutbound({
      companyId,
      identifier: parsed.identifier,
      messageType,
      content,
    });
    if (pending) {
      await supabaseAdmin
        .from("messages")
        .update({
          delivery_status: "SENT",
          ...(externalId ? { external_message_id: externalId } : {}),
        })
        .eq("id", pending);
      return { status: "duplicate", reason: "eco da mensagem enviada pelo sistema" };
    }

    let echoMedia: { path: string; mimeType: string | null } | null = null;
    if (messageType !== "text") {
      echoMedia = await downloadAndStoreMedia({ connectionId, companyId, body, messageType });
    }

    const { data: echo, error: echoError } = await supabaseAdmin.rpc("ingest_outbound_echo", {
      _connection_id: connectionId,
      _remote_jid: parsed.jid,
      _external_message_id: externalId ?? (null as unknown as string),
      _message_type: messageType,
      ...opt("_content", content),
      ...opt("_media_url", echoMedia?.path ?? null),
      ...opt("_mime_type", echoMedia?.mimeType ?? mimeTypeHint),
      _metadata: { remote_jid: parsed.jid, is_lid: parsed.isLid, event: eventType },
    });
    if (echoError) {
      console.error("[whatsapp] eco do aparelho falhou", echoError.message);
      return { status: "error", reason: echoError.message };
    }
    const echoResult = (echo ?? {}) as { duplicate?: boolean; message_id?: string };
    return {
      status: echoResult.duplicate ? "duplicate" : "processed",
      reason: "mensagem enviada pelo aparelho",
      ...(echoResult.message_id ? { messageId: echoResult.message_id } : {}),
    };
  }

  // Número pessoal de colaborador falando com o tronco: não vira lead e não é
  // retransmitido. O atendimento acontece exclusivamente no painel.
  if (!parsed.isLid && parsed.phone) {
    const { handleConsultantInbound } = await import("@/lib/queue/bridge.server");
    const handled = await handleConsultantInbound({
      companyId,
      trunkConnectionId: connectionId,
      phone: parsed.phone,
      text: content,
    });
    if (handled) return { status: "processed", reason: "mensagem de consultor" };
  }

  let mediaUrl: string | null = null;
  let mimeType: string | null = mimeTypeHint;

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
    } else {
      console.error("[whatsapp] mídia recebida não pôde ser baixada", { messageType });
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

  // Lead criado por LID: se a MEGA informou o número real, gravamos no lead.
  if (result.lead_id && realPhone) {
    await supabaseAdmin
      .from("leads")
      .update({ phone: realPhone })
      .eq("id", result.lead_id)
      .is("phone", null);
  }

  // Figurinha: guardamos (somente no servidor) a chave e o conteúdo original
  // da mensagem. Só com eles é possível reencaminhar a figurinha nativamente,
  // preservando animação e transparência no WhatsApp de quem recebe.
  if (!result.duplicate && result.message_id && messageType === "sticker") {
    await persistStickerProviderPayload({
      messageId: result.message_id,
      companyId,
      body,
    });
  }




  console.info("[whatsapp] mensagem processada", {
    evento: eventType,
    tipo: messageType,
    duplicada: Boolean(result.duplicate),
    conversa: result.conversation_id ?? null,
  });

  // Áudio do lead: transcreve antes da IA responder, para que ela entenda.
  if (!result.duplicate && result.message_id && messageType === "audio" && mediaUrl) {
    const { transcribeAudioMessage } = await import("@/lib/ai/transcribe.server");
    await transcribeAudioMessage({
      messageId: result.message_id,
      mediaPath: mediaUrl,
      mimeType,
    });
  }

  // Resposta do lead à pergunta de avaliação (1 a 5 estrelas): registra a nota
  // e não aciona a IA para essa mensagem.
  let ratedNow = false;
  if (!result.duplicate && result.conversation_id) {
    const { captureRatingReply } = await import("@/lib/rating/rating.server");
    ratedNow = await captureRatingReply({
      companyId,
      conversationId: result.conversation_id,
      text: content,
    });
  }

  if (!ratedNow && !result.duplicate && result.conversation_id) {
    const { respondWithAI } = await import("@/lib/ai/agent.server");
    const ai = await respondWithAI({
      companyId,
      conversationId: result.conversation_id,
      leadId: result.lead_id ?? null,
      connectionId,
    });
    console.info("[ia] resultado", ai.status, ai.reason ?? "");

    // Sem IA (ou IA desligada): a conversa entra na fila para o rodízio humano.
    if (ai.status === "skipped" && ai.reason !== "conversa com consultor") {
      const { data: conv } = await supabaseAdmin
        .from("conversations")
        .select("status, assigned_user_id")
        .eq("id", result.conversation_id)
        .maybeSingle();
      if (conv && !conv.assigned_user_id && ["WAITING_HUMAN", "QUEUED"].includes(conv.status)) {
        await supabaseAdmin.rpc("enqueue_conversation", {
          _conversation_id: result.conversation_id,
          _reason: "mensagem recebida sem IA ativa",
        });
      }
    }

    // O consultor acompanha a conversa pelo painel (realtime); nada é
    // espelhado para o WhatsApp pessoal dele.

  }

  // Oportunidade barata de expirar ofertas vencidas (SLA) a cada evento recebido.
  await supabaseAdmin.rpc("queue_tick");

  // Avisa no WhatsApp os consultores com oferta pendente / repassada.
  const { notifyQueueOffers } = await import("@/lib/queue/bridge.server");
  await notifyQueueOffers(companyId);

  // Lead abandonado (rodízio encerrado sem ninguém assumir): pede a avaliação.
  const { requestAbandonedRatings } = await import("@/lib/rating/rating.server");
  await requestAbandonedRatings(companyId).catch((error) =>
    console.error("[avaliação] falha ao solicitar", error),
  );




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

/** Chave da mensagem (key) em qualquer profundidade do payload. */
function findMessageKey(payload: unknown): Record<string, unknown> | null {
  const direct = pick(payload, "key");
  if (direct && typeof direct === "object") return direct as Record<string, unknown>;
  const found = deepFind(payload, /^key$/i);
  if (found && typeof found === "object" && "id" in (found as Json)) {
    return found as Record<string, unknown>;
  }
  return null;
}

const MEDIA_WRAPPERS = [
  "ephemeralMessage",
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "documentWithCaptionMessage",
  "editedMessage",
  "protocolMessage",
];

/** Nó `message` já desembrulhado dos invólucros (ephemeral, viewOnce...). */
function findMessageNode(payload: unknown): unknown {
  let node = pick(payload, "message") ?? deepFind(payload, /^message$/i);
  for (let i = 0; i < 6; i += 1) {
    if (!node || typeof node !== "object") break;
    const entries = Object.keys(node as Json);
    const wrapper = entries.find((key) => MEDIA_WRAPPERS.includes(key));
    if (!wrapper) break;
    const inner = (node as Json)[wrapper];
    const next = inner && typeof inner === "object" ? ((inner as Json)["message"] ?? inner) : null;
    if (!next) break;
    node = next;
  }
  return node;
}

async function downloadAndStoreMedia(input: {
  connectionId: string;
  companyId: string;
  body: Json;
  messageType: MessageType;
}): Promise<{ path: string; mimeType: string | null } | null> {
  const { base64ToBytes, storeMedia } = await import("@/lib/whatsapp/media.server");
  const creds = await loadMegaCredentials(input.connectionId);
  if (!creds) return null;

  const key = findMessageKey(input.body);
  const messageNode = findMessageNode(input.body);
  if (!key) {
    console.error("[whatsapp] mídia sem key no payload", JSON.stringify(input.body).slice(0, 800));
  }

  // Enviamos o payload completo. Em figurinhas, algumas versões da MEGA não
  // incluem stickerMessage dentro de `message`, mas ainda resolvem o arquivo
  // usando a key presente no evento.
  const result = await MegaApiService.downloadMedia(creds, key ?? {}, input.body);
  if (!result.ok) {
    console.error("[whatsapp] download de mídia falhou", {
      erro: result.error,
      tipo: input.messageType,
      key,
      temMessage: Boolean(messageNode),
    });
    return null;
  }


  const findDownloadValue = (
    source: unknown,
    keys: string[],
    accepts: (value: unknown) => boolean,
    depth = 0,
  ): unknown => {
    if (!source || typeof source !== "object" || depth > 6) return undefined;
    const object = source as Json;
    for (const keyName of keys) {
      const value = object[keyName];
      if (accepts(value)) return value;
    }
    for (const value of Object.values(object)) {
      const found = findDownloadValue(value, keys, accepts, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  const encoded = findDownloadValue(
    result.data,
    ["data", "base64", "buffer"],
    (value) =>
      (typeof value === "string" && Boolean(value.trim())) ||
      Array.isArray(value) ||
      Boolean(value && typeof value === "object" && "data" in (value as Json)),
  );
  let bytes: Uint8Array | null = null;
  const returnedMime = findDownloadValue(
    result.data,
    ["mimetype", "mimeType"],
    (value) => typeof value === "string" && value.includes("/"),
  );
  let mimeType: string | null = typeof returnedMime === "string" ? returnedMime : null;

  if (typeof encoded === "string" && encoded.trim()) {
    bytes = base64ToBytes(encoded);
  } else if (Array.isArray(encoded) && encoded.every((value) => typeof value === "number")) {
    bytes = new Uint8Array(encoded);
  } else if (
    encoded &&
    typeof encoded === "object" &&
    "data" in encoded &&
    Array.isArray((encoded as { data?: unknown }).data)
  ) {
    const values = (encoded as { data: unknown[] }).data;
    if (values.every((value) => typeof value === "number")) bytes = new Uint8Array(values as number[]);
  } else {
    const url = findDownloadValue(
      result.data,
      ["url", "mediaUrl", "fileURL"],
      (value) => typeof value === "string" && /^https?:\/\//i.test(value),
    );
    if (typeof url === "string" && url.startsWith("http")) {
      const response = await fetch(url);
      if (response.ok) {
        bytes = new Uint8Array(await response.arrayBuffer());
        mimeType = mimeType ?? response.headers.get("content-type");
      }
    }
  }
  if (!bytes || bytes.byteLength === 0) {
    console.error("[whatsapp] resposta de mídia sem bytes utilizáveis", {
      tipo: input.messageType,
      campos: result.data && typeof result.data === "object" ? Object.keys(result.data) : [],
    });
    return null;
  }

  // Figurinhas do WhatsApp são WebP, inclusive quando animadas. Detectar pelos
  // bytes evita salvá-las como JPG quando a resposta omite o Content-Type.
  const { sniffMimeType } = await import("@/lib/whatsapp/media.server");
  mimeType = sniffMimeType(bytes) ?? mimeType;

  const kind = (
    input.messageType === "sticker"
      ? "image"
      : ["audio", "image", "video", "document"].includes(input.messageType)
        ? input.messageType
        : "other"
  ) as MediaKind;

  const path = await storeMedia({
    companyId: input.companyId,
    connectionId: input.connectionId,
    bytes,
    mimeType,
    kind,
  });
  return path ? { path, mimeType } : null;
}

/**
 * Guarda os dados originais da figurinha (chave + objeto `message` do webhook).
 * Ficam em tabela sem políticas de acesso: só o servidor lê, para reencaminhar
 * a figurinha nativamente pela MEGA API.
 */
async function persistStickerProviderPayload(input: {
  messageId: string;
  companyId: string;
  body: Json;
}) {
  const key = findMessageKey(input.body);
  const messageNode = findMessageNode(input.body);
  if (!key || !messageNode || typeof messageNode !== "object") {
    console.warn("[whatsapp] figurinha sem dados originais para reenvio");
    return;
  }
  const sticker = (messageNode as Json)["stickerMessage"];
  const isAnimated = Boolean(
    sticker && typeof sticker === "object" && (sticker as Json)["isAnimated"],
  );
  const { error } = await supabaseAdmin.from("message_provider_payloads").upsert(
    {
      message_id: input.messageId,
      company_id: input.companyId,
      provider_key: key as never,
      provider_message: messageNode as never,
      is_animated: isAnimated,
    },
    { onConflict: "message_id" },
  );
  if (error) console.error("[whatsapp] falha ao guardar dados da figurinha", error.message);
}
