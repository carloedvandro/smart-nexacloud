/**
 * Operações de instância e envio pelo WhatsApp.
 * Toda autorização acontece ANTES de chamar estas funções (ver whatsapp.functions.ts).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadMegaCredentials } from "@/lib/whatsapp/credentials.server";
import {
  MegaApiService,
  extractConnectedPhone,
  extractQrCode,
  extractWebhookUrl,
} from "@/lib/whatsapp/mega.server";
import { WhatsAppIdentifierService } from "@/lib/whatsapp/jid";

export type InstanceStateResult = {
  status: "AVAILABLE" | "CONNECTING" | "CONNECTED" | "DISCONNECTED" | "LOGGED_OUT" | "ERROR" | "BLOCKED";
  qrCode?: string | null;
  phoneNumber?: string | null;
  error?: string;
};

async function persistState(
  connectionId: string,
  status: InstanceStateResult["status"],
  options: { phone?: string | null; qrCode?: string | null; qrStatus?: string | null } = {},
) {
  await supabaseAdmin.rpc("set_instance_connection_state", {
    _connection_id: connectionId,
    _status: status,
    ...(options.phone ? { _phone_number: options.phone } : {}),
    ...(options.qrCode ? { _qr_code: options.qrCode } : {}),
    ...(options.qrStatus ? { _qr_code_status: options.qrStatus } : {}),
  });
}

/** Gera/obtém o QR Code da instância para o colaborador vinculado escanear. */
export async function requestQrCode(connectionId: string): Promise<InstanceStateResult> {
  const creds = await loadMegaCredentials(connectionId);
  if (!creds) return { status: "ERROR", error: "Credenciais da instância não configuradas." };

  const statusResult = await MegaApiService.getInstanceStatus(creds);
  if (statusResult.ok) {
    const phone = extractConnectedPhone(statusResult.data);
    const raw = JSON.stringify(statusResult.data ?? {}).toUpperCase();
    if (/"(STATE|STATUS)":"(OPEN|CONNECTED)"/.test(raw) && phone) {
      await persistState(connectionId, "CONNECTED", { phone, qrStatus: "connected" });
      return { status: "CONNECTED", phoneNumber: phone };
    }
  }

  const qrResult = await MegaApiService.getQrCode(creds);
  if (!qrResult.ok) {
    await persistState(connectionId, "ERROR", { qrStatus: qrResult.error });
    return { status: "ERROR", error: qrResult.error };
  }

  const qrCode = extractQrCode(qrResult.data);
  if (!qrCode) {
    await persistState(connectionId, "ERROR", { qrStatus: "qr_indisponivel" });
    return { status: "ERROR", error: "A MEGA API não retornou um QR Code legível." };
  }

  await persistState(connectionId, "CONNECTING", { qrCode, qrStatus: "aguardando_leitura" });
  return { status: "CONNECTING", qrCode };
}

/** Consulta a situação real na MEGA e sincroniza o número conectado. */
export async function syncInstanceStatus(connectionId: string): Promise<InstanceStateResult> {
  const creds = await loadMegaCredentials(connectionId);
  if (!creds) return { status: "ERROR", error: "Credenciais da instância não configuradas." };

  const result = await MegaApiService.getInstanceStatus(creds);
  if (!result.ok) {
    await persistState(connectionId, "ERROR", { qrStatus: result.error });
    return { status: "ERROR", error: result.error };
  }

  const raw = JSON.stringify(result.data ?? {}).toUpperCase();
  const phone = extractConnectedPhone(result.data);
  let status: InstanceStateResult["status"] = "DISCONNECTED";
  if (/OPEN|CONNECTED|ONLINE/.test(raw) && phone) status = "CONNECTED";
  else if (/CONNECTING|PAIRING|QRCODE/.test(raw)) status = "CONNECTING";
  else if (/LOGGED_?OUT|LOGOUT/.test(raw)) status = "LOGGED_OUT";

  await persistState(connectionId, status, { phone, qrStatus: status.toLowerCase() });
  return { status, phoneNumber: phone };
}

/** Consulta o webhook atualmente configurado na MEGA para a instância. */
export async function readInstanceWebhook(
  connectionId: string,
): Promise<{ ok: boolean; url?: string | null; error?: string }> {
  const creds = await loadMegaCredentials(connectionId);
  if (!creds) return { ok: false, error: "Credenciais da instância não configuradas." };
  const result = await MegaApiService.getWebhook(creds);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, url: extractWebhookUrl(result.data) };
}

/** Configura/reconfigura o webhook central da instância na MEGA. */
export async function writeInstanceWebhook(
  connectionId: string,
  webhookUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  const creds = await loadMegaCredentials(connectionId);
  if (!creds) return { ok: false, error: "Credenciais da instância não configuradas." };
  const result = await MegaApiService.setWebhook(creds, webhookUrl);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}

/** Logout do número na MEGA. A instância continua contratada pela empresa. */
export async function logoutInstance(connectionId: string): Promise<{ ok: boolean; error?: string }> {
  const creds = await loadMegaCredentials(connectionId);
  if (!creds) return { ok: false, error: "Credenciais da instância não configuradas." };
  const result = await MegaApiService.logout(creds);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}

type OutboundInput = {
  companyId: string;
  conversationId: string;
  userId: string;
  senderName: string | null;
  senderType: "consultant" | "admin";
  content: string;
};

/**
 * Envia mensagem pelo WhatsApp e registra a mensagem com status de entrega.
 * A instância usada é a do consultor vinculado; se ele não tiver instância,
 * usa a instância conectada da empresa registrada na conversa.
 */
export async function sendWhatsAppText(input: OutboundInput) {
  const { data: conversation } = await supabaseAdmin
    .from("conversations")
    .select("id, company_id, channel_id, metadata, lead:leads(whatsapp)")
    .eq("id", input.conversationId)
    .eq("company_id", input.companyId)
    .maybeSingle();

  if (!conversation) return { ok: false as const, error: "Conversa inexistente." };

  const destination =
    (conversation.lead as { whatsapp: string | null } | null)?.whatsapp ?? conversation.channel_id;
  const recipient = WhatsAppIdentifierService.toRecipient(destination);
  if (!recipient) return { ok: false as const, error: "Lead sem WhatsApp válido." };

  const connectionId = await resolveConnection({
    companyId: input.companyId,
    conversationId: input.conversationId,
    userId: input.userId,
    metadata: conversation.metadata as Record<string, unknown> | null,
  });
  if (!connectionId) {
    return { ok: false as const, error: "Nenhuma instância de WhatsApp conectada disponível." };
  }

  const { data: messageId, error: createError } = await supabaseAdmin.rpc("create_outbound_message", {
    _conversation_id: input.conversationId,
    _company_id: input.companyId,
    _sender_id: input.userId,
    _sender_type: input.senderType,
    _sender_name: input.senderName ?? (null as unknown as string),
    _content: input.content,
    _message_type: "text",
    _connection_id: connectionId,
  });
  if (createError || !messageId) {
    return { ok: false as const, error: createError?.message ?? "Falha ao registrar a mensagem." };
  }

  const creds = await loadMegaCredentials(connectionId);
  if (!creds) {
    await supabaseAdmin.rpc("finalize_outbound_message", {
      _message_id: messageId,
      _external_message_id: null as unknown as string,
      _status: "FAILED",
      _reason: "Credenciais da instância não configuradas.",
    });
    return { ok: false as const, error: "Credenciais da instância não configuradas." };
  }

  const sent = await MegaApiService.sendText(creds, recipient, input.content);
  if (!sent.ok) {
    await supabaseAdmin.rpc("finalize_outbound_message", {
      _message_id: messageId,
      _external_message_id: null as unknown as string,
      _status: "FAILED",
      _reason: sent.error,
    });
    return { ok: false as const, error: sent.error, messageId };
  }

  const externalId = sent.data?.key?.id ?? sent.data?.messageId ?? null;
  await supabaseAdmin.rpc("finalize_outbound_message", {
    _message_id: messageId,
    _external_message_id: externalId as unknown as string,
    _status: "SENT",
  });

  return { ok: true as const, messageId };
}

/**
 * Regra de canal: a conversa responde SEMPRE pela instância em que o cliente entrou.
 * Ordem: canal registrado na conversa → instância da última mensagem recebida →
 * número tronco conectado → qualquer instância conectada da empresa.
 * A instância pessoal do consultor nunca troca o canal de uma conversa existente.
 */
async function resolveConnection(input: {
  companyId: string;
  conversationId: string;
  userId: string;
  metadata: Record<string, unknown> | null;
}): Promise<string | null> {
  const fromConversation = input.metadata?.["connection_id"];
  if (typeof fromConversation === "string") return fromConversation;

  const { data: inbound } = await supabaseAdmin
    .from("messages")
    .select("connection_id")
    .eq("conversation_id", input.conversationId)
    .eq("sender_type", "customer")
    .not("connection_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (inbound?.connection_id) {
    await supabaseAdmin
      .from("conversations")
      .update({ metadata: { ...(input.metadata ?? {}), connection_id: inbound.connection_id } })
      .eq("id", input.conversationId);
    return inbound.connection_id;
  }

  const { data: trunk } = await supabaseAdmin
    .from("whatsapp_connections")
    .select("id")
    .eq("company_id", input.companyId)
    .eq("is_trunk", true)
    .eq("status", "CONNECTED")
    .maybeSingle();
  if (trunk?.id) return trunk.id;

  const { data: fallback } = await supabaseAdmin
    .from("whatsapp_connections")
    .select("id")
    .eq("company_id", input.companyId)
    .eq("status", "CONNECTED")
    .order("instance_number", { ascending: true })
    .limit(1)
    .maybeSingle();
  return fallback?.id ?? null;
}
