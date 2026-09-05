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

  console.info("[whatsapp] envio pelo painel", {
    conversa: input.conversationId,
    instancia: connectionId,
    destino: recipient,
  });
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

  // O consultor respondeu dentro do prazo: encerra o rodízio da fila nesta conversa.
  await supabaseAdmin.rpc("queue_register_response", {
    _conversation_id: input.conversationId,
    _user_id: input.userId,
  });

  return { ok: true as const, messageId };
}

/**
 * Regra de canal: a conversa responde SEMPRE pela instância em que o cliente entrou,
 * desde que ela continue conectada e pertença à empresa. Uma instância registrada
 * na conversa mas desconectada faz a MEGA aceitar o envio sem entregar ao lead —
 * por isso validamos antes e caímos para a instância viva (última entrada → tronco →
 * qualquer conectada).
 */
async function isUsableConnection(companyId: string, connectionId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("whatsapp_connections")
    .select("id, status")
    .eq("id", connectionId)
    .eq("company_id", companyId)
    .maybeSingle();
  return data?.status === "CONNECTED";
}

async function resolveConnection(input: {
  companyId: string;
  conversationId: string;
  userId: string;
  metadata: Record<string, unknown> | null;
}): Promise<string | null> {
  const fromConversation = input.metadata?.["connection_id"];
  if (
    typeof fromConversation === "string" &&
    (await isUsableConnection(input.companyId, fromConversation))
  ) {
    return fromConversation;
  }
  if (typeof fromConversation === "string") {
    console.warn("[whatsapp] instância da conversa indisponível — buscando outra", {
      conversa: input.conversationId,
      instancia: fromConversation,
    });
  }

  const { data: inbound } = await supabaseAdmin
    .from("messages")
    .select("connection_id")
    .eq("conversation_id", input.conversationId)
    .eq("sender_type", "customer")
    .not("connection_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (
    inbound?.connection_id &&
    (await isUsableConnection(input.companyId, inbound.connection_id))
  ) {
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
  if (trunk?.id) {
    await supabaseAdmin
      .from("conversations")
      .update({ metadata: { ...(input.metadata ?? {}), connection_id: trunk.id } })
      .eq("id", input.conversationId);
    return trunk.id;
  }

  // Instâncias de disparo jamais atendem: elas são exclusivas das campanhas.
  const { data: fallback } = await supabaseAdmin
    .from("whatsapp_connections")
    .select("id")
    .eq("company_id", input.companyId)
    .eq("connection_type", "TRUNK")
    .eq("status", "CONNECTED")
    .order("instance_number", { ascending: true })
    .limit(1)
    .maybeSingle();
  return fallback?.id ?? null;
}


/**
 * Envia mídia (áudio gravado, imagem, vídeo ou documento) pelo WhatsApp.
 * O arquivo é guardado no bucket da empresa e enviado por link assinado,
 * ficando disponível também no histórico do sistema.
 */
export async function sendWhatsAppMedia(input: {
  companyId: string;
  conversationId: string;
  userId: string;
  senderName: string | null;
  senderType: "consultant" | "admin";
  base64: string;
  mimeType: string | null;
  fileName: string | null;
  caption: string | null;
  kind: "audio" | "image" | "video" | "document";
}) {
  const { base64ToBytes, storeMedia, signedMediaUrl } = await import("@/lib/whatsapp/media.server");

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

  const bytes = base64ToBytes(input.base64);
  if (!bytes.byteLength) return { ok: false as const, error: "Arquivo vazio." };

  const path = await storeMedia({
    companyId: input.companyId,
    connectionId,
    bytes,
    mimeType: input.mimeType,
    kind: input.kind,
  });
  if (!path) return { ok: false as const, error: "Não foi possível guardar o arquivo." };

  const { data: messageId, error: createError } = await supabaseAdmin.rpc(
    "create_outbound_message",
    {
      _conversation_id: input.conversationId,
      _company_id: input.companyId,
      _sender_id: input.userId,
      _sender_type: input.senderType,
      _sender_name: input.senderName ?? (null as unknown as string),
      _content: input.caption ?? "",
      _message_type: input.kind,
      _media_url: path,
      _connection_id: connectionId,
    },
  );
  if (createError || !messageId) {
    return { ok: false as const, error: createError?.message ?? "Falha ao registrar a mensagem." };
  }

  const fail = async (reason: string) => {
    await supabaseAdmin.rpc("finalize_outbound_message", {
      _message_id: messageId,
      _external_message_id: null as unknown as string,
      _status: "FAILED",
      _reason: reason,
    });
    return { ok: false as const, error: reason, messageId };
  };

  const creds = await loadMegaCredentials(connectionId);
  if (!creds) return fail("Credenciais da instância não configuradas.");

  const url = await signedMediaUrl(path);
  if (!url) return fail("Não consegui gerar o link do arquivo.");

  const sent = await MegaApiService.sendMedia(creds, {
    to: recipient,
    url,
    mediaType: input.kind,
    mimeType: input.mimeType,
    fileName: input.fileName,
    caption: input.caption,
  });
  if (!sent.ok) return fail(sent.error);

  await supabaseAdmin.rpc("finalize_outbound_message", {
    _message_id: messageId,
    _external_message_id: (sent.data?.key?.id ?? sent.data?.messageId ?? null) as unknown as string,
    _status: "SENT",
  });

  await supabaseAdmin.rpc("queue_register_response", {
    _conversation_id: input.conversationId,
    _user_id: input.userId,
  });

  return { ok: true as const, messageId, mediaPath: path };
}

/**
 * Reenvia uma figurinha já recebida pelo WhatsApp, encaminhando a mensagem
 * original (forwardMessage). É o único formato que chega ao destinatário como
 * figurinha nativa — com animação e transparência. Sem os dados originais o
 * envio é recusado: não existe fallback silencioso como imagem estática.
 */
export async function forwardStickerMessage(input: {
  companyId: string;
  conversationId: string;
  userId: string;
  senderName: string | null;
  senderType: "consultant" | "admin";
  sourceMessageId: string;
}) {
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

  const { data: source } = await supabaseAdmin
    .from("messages")
    .select("id, company_id, media_url, message_type")
    .eq("id", input.sourceMessageId)
    .eq("company_id", input.companyId)
    .maybeSingle();
  const { data: payload } = await supabaseAdmin
    .from("message_provider_payloads")
    .select("provider_key, provider_message, is_animated")
    .eq("message_id", input.sourceMessageId)
    .eq("company_id", input.companyId)
    .maybeSingle();

  if (!source || !payload?.provider_key || !payload?.provider_message) {
    return {
      ok: false as const,
      error:
        "Esta figurinha não possui os dados originais necessários para envio nativo. Salve-a novamente ao recebê-la pelo WhatsApp.",
    };
  }

  const connectionId = await resolveConnection({
    companyId: input.companyId,
    conversationId: input.conversationId,
    userId: input.userId,
    metadata: conversation.metadata as Record<string, unknown> | null,
  });
  if (!connectionId) {
    return { ok: false as const, error: "Nenhuma instância de WhatsApp conectada disponível." };
  }

  const { data: messageId, error: createError } = await supabaseAdmin.rpc(
    "create_outbound_message",
    {
      _conversation_id: input.conversationId,
      _company_id: input.companyId,
      _sender_id: input.userId,
      _sender_type: input.senderType,
      _sender_name: input.senderName ?? (null as unknown as string),
      _content: "",
      _message_type: "sticker",
      _media_url: source.media_url ?? (null as unknown as string),
      _connection_id: connectionId,
    },
  );
  if (createError || !messageId) {
    return { ok: false as const, error: createError?.message ?? "Falha ao registrar a figurinha." };
  }

  await supabaseAdmin
    .from("messages")
    .update({
      metadata: { origin: "favorite_forward", is_animated: payload.is_animated },
      mime_type: "image/webp",
    })
    .eq("id", messageId as string);

  const fail = async (reason: string) => {
    await supabaseAdmin.rpc("finalize_outbound_message", {
      _message_id: messageId,
      _external_message_id: null as unknown as string,
      _status: "FAILED",
      _reason: reason,
    });
    return { ok: false as const, error: reason, messageId };
  };

  const creds = await loadMegaCredentials(connectionId);
  if (!creds) return fail("Credenciais da instância não configuradas.");

  const sent = await MegaApiService.forwardMessage(creds, {
    to: recipient,
    key: payload.provider_key,
    message: payload.provider_message,
  });
  if (!sent.ok) return fail(sent.error);

  await supabaseAdmin.rpc("finalize_outbound_message", {
    _message_id: messageId,
    _external_message_id: (sent.data?.key?.id ?? sent.data?.messageId ?? null) as unknown as string,
    _status: "SENT",
  });

  await supabaseAdmin.rpc("queue_register_response", {
    _conversation_id: input.conversationId,
    _user_id: input.userId,
  });

  return { ok: true as const, messageId, mediaPath: source.media_url };
}
