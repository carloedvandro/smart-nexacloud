/**
 * Ponte WhatsApp <-> Sistema para consultores.
 *
 * Regra do NexaAtende: o lead NUNCA fala com o número pessoal do consultor.
 * Toda a conversa passa pelo número tronco da empresa e fica registrada no
 * sistema. O consultor recebe a oferta e as mensagens do lead no WhatsApp dele
 * (via tronco) e tudo o que ele responder é retransmitido para o lead.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadMegaCredentials } from "@/lib/whatsapp/credentials.server";
import { MegaApiService, type MegaCredentials } from "@/lib/whatsapp/mega.server";
import { PhoneNormalizationService } from "@/lib/nexa/phone";
import { getPublicBaseUrl } from "@/lib/nexa/public-url";

const EVENT_OFFER_NOTIFIED = "CONSULTANT_NOTIFIED";
const EVENT_TIMEOUT_NOTIFIED = "CONSULTANT_TIMEOUT_NOTIFIED";
const END_COMMANDS = ["#encerrar", "#fim", "#finalizar"];

type TrunkContext = { connectionId: string; creds: MegaCredentials };

/** Instância tronco da empresa (ponto único de saída para consultores). */
async function loadTrunk(companyId: string): Promise<TrunkContext | null> {
  const { data } = await supabaseAdmin
    .from("whatsapp_connections")
    .select("id")
    .eq("company_id", companyId)
    .eq("is_trunk", true)
    .maybeSingle();
  if (!data) return null;
  const creds = await loadMegaCredentials(data.id);
  return creds ? { connectionId: data.id, creds } : null;
}

async function sendToConsultant(trunk: TrunkContext, phone: string, text: string) {
  const to = PhoneNormalizationService.normalize(phone);
  if (!to) return false;
  const sent = await MegaApiService.sendText(trunk.creds, to, text);
  if (!sent.ok) console.error("[ponte] falha ao avisar consultor", sent.error);
  return sent.ok;
}

async function alreadyLogged(conversationId: string, eventType: string, attemptId: string) {
  const { count } = await supabaseAdmin
    .from("conversation_events")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("event_type", eventType)
    .eq("metadata->>attempt_id", attemptId);
  return (count ?? 0) > 0;
}

async function logEvent(
  companyId: string,
  conversationId: string,
  eventType: string,
  attemptId: string,
) {
  await supabaseAdmin.from("conversation_events").insert({
    company_id: companyId,
    conversation_id: conversationId,
    event_type: eventType,
    metadata: { attempt_id: attemptId },
  });
}

function firstName(name: string | null | undefined) {
  return (name ?? "").trim().split(/\s+/)[0] || "consultor(a)";
}

/**
 * O número operacional do consultor é, preferencialmente, o WhatsApp conectado
 * à instância que foi vinculada a ele. O telefone do perfil fica como fallback
 * para empresas que usam uma instância apenas para avisos.
 */
async function consultantNotificationPhone(
  companyId: string,
  consultantId: string,
  profilePhone: string | null,
): Promise<string | null> {
  const { data: connection } = await supabaseAdmin
    .from("whatsapp_connections")
    .select("phone_number")
    .eq("company_id", companyId)
    .eq("user_id", consultantId)
    .eq("status", "CONNECTED")
    .eq("is_trunk", false)
    .not("phone_number", "is", null)
    .order("instance_number", { ascending: true })
    .limit(1)
    .maybeSingle();

  return connection?.phone_number ?? profilePhone;
}

/**
 * Avisa no WhatsApp os consultores com oferta de fila aguardando resposta e
 * comunica quando uma oferta expirou e foi repassada.
 */
export async function notifyQueueOffers(companyId: string): Promise<void> {
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();

  const { data: attempts } = await supabaseAdmin
    .from("assignment_attempts")
    .select("id, conversation_id, consultant_id, status, deadline_at")
    .eq("company_id", companyId)
    .in("status", ["WAITING", "TIMEOUT"])
    .gte("assigned_at", cutoff)
    .order("assigned_at", { ascending: true })
    .limit(20);

  if (!attempts?.length) return;

  const trunk = await loadTrunk(companyId);
  if (!trunk) {
    console.error("[ponte] empresa sem instância tronco com credenciais", companyId);
    return;
  }

  for (const attempt of attempts) {
    if (!attempt.consultant_id) continue;

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name, phone")
      .eq("id", attempt.consultant_id)
      .maybeSingle();
    if (!profile) continue;

    const notificationPhone = await consultantNotificationPhone(
      companyId,
      attempt.consultant_id,
      profile.phone,
    );
    if (!notificationPhone) {
      console.error("[ponte] consultor sem WhatsApp vinculado", attempt.consultant_id);
      continue;
    }

    if (attempt.status === "TIMEOUT") {
      if (await alreadyLogged(attempt.conversation_id, EVENT_TIMEOUT_NOTIFIED, attempt.id)) continue;
      const timeoutSent = await sendToConsultant(
        trunk,
        notificationPhone,
        "⌛ O tempo de resposta expirou e este atendimento foi repassado para outro consultor.",
      );
      if (timeoutSent) {
        await logEvent(companyId, attempt.conversation_id, EVENT_TIMEOUT_NOTIFIED, attempt.id);
      }
      continue;
    }

    if (await alreadyLogged(attempt.conversation_id, EVENT_OFFER_NOTIFIED, attempt.id)) continue;

    const { data: conversation } = await supabaseAdmin
      .from("conversations")
      .select("id, summary, lead:leads(name, whatsapp, city, state)")
      .eq("id", attempt.conversation_id)
      .maybeSingle();
    const lead = (conversation?.lead ?? null) as {
      name: string | null;
      whatsapp: string | null;
      city: string | null;
      state: string | null;
    } | null;

    const { data: lastMessages } = await supabaseAdmin
      .from("messages")
      .select("content, transcription, sender_type")
      .eq("conversation_id", attempt.conversation_id)
      .eq("sender_type", "customer")
      .order("created_at", { ascending: false })
      .limit(1);
    const lastText = (lastMessages?.[0]?.content ?? lastMessages?.[0]?.transcription ?? "").trim();

    const seconds = Math.max(
      0,
      Math.round((new Date(attempt.deadline_at).getTime() - Date.now()) / 1000),
    );

    const text = [
      `🔔 Novo atendimento para você, ${firstName(profile.full_name)}!`,
      "",
      `👤 Lead: ${lead?.name?.trim() || "sem nome"}`,
      lead?.city ? `📍 ${lead.city}${lead.state ? `/${lead.state}` : ""}` : "",
      lastText ? `💬 "${lastText.slice(0, 220)}"` : "",
      "",
      `⏱️ Você tem ${seconds || 60}s para assumir, senão passa para o próximo.`,
      "",
      "👉 Responda AQUI mesmo nesta conversa: tudo o que você escrever é enviado ao lead pelo número da empresa (ele não vê seu número).",
      `🖥️ Ou abra no sistema: ${getPublicBaseUrl()}/conversas?c=${attempt.conversation_id}`,
      "",
      "Digite #encerrar para finalizar o atendimento.",
    ]
      .filter((line) => line !== "")
      .join("\n");

    const ok = await sendToConsultant(trunk, notificationPhone, text);
    if (ok) await logEvent(companyId, attempt.conversation_id, EVENT_OFFER_NOTIFIED, attempt.id);
  }
}

export type ConsultantTarget = {
  profileId: string;
  fullName: string | null;
  conversationId: string;
  companyId: string;
};

/** O número que enviou a mensagem pertence a um consultor da empresa? */
export async function resolveConsultantByPhone(
  companyId: string,
  phone: string | null,
): Promise<{ profileId: string; fullName: string | null } | null> {
  const normalized = PhoneNormalizationService.normalize(phone);
  if (!normalized) return null;

  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, phone, is_active")
    .eq("company_id", companyId)
    .not("phone", "is", null);

  const match = (data ?? []).find(
    (p) => p.is_active && PhoneNormalizationService.normalize(p.phone) === normalized,
  );
  if (match) return { profileId: match.id, fullName: match.full_name };

  const { data: connections } = await supabaseAdmin
    .from("whatsapp_connections")
    .select("user_id, phone_number, profile:profiles!whatsapp_connections_user_id_fkey(full_name, is_active)")
    .eq("company_id", companyId)
    .eq("status", "CONNECTED")
    .not("user_id", "is", null)
    .not("phone_number", "is", null);

  const connectionMatch = (connections ?? []).find(
    (connection) => PhoneNormalizationService.normalize(connection.phone_number) === normalized,
  );
  const connectionProfile = connectionMatch?.profile as {
    full_name: string | null;
    is_active: boolean;
  } | null;
  if (!connectionMatch?.user_id || !connectionProfile?.is_active) return null;
  return { profileId: connectionMatch.user_id, fullName: connectionProfile.full_name };
}

/** Conversa que o consultor está atendendo (oferta pendente ou já assumida). */
async function findConsultantConversation(
  companyId: string,
  profileId: string,
): Promise<string | null> {
  const { data: waiting } = await supabaseAdmin
    .from("assignment_attempts")
    .select("conversation_id")
    .eq("company_id", companyId)
    .eq("consultant_id", profileId)
    .eq("status", "WAITING")
    .order("assigned_at", { ascending: false })
    .limit(1);
  if (waiting?.[0]) return waiting[0].conversation_id;

  const { data: active } = await supabaseAdmin
    .from("conversations")
    .select("id")
    .eq("company_id", companyId)
    .eq("assigned_user_id", profileId)
    .not("status", "in", "(CLOSED,PAUSED)")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1);
  return active?.[0]?.id ?? null;
}

/** Instância pela qual o lead entrou (mantém a "grudação" de canal). */
async function conversationConnectionId(
  conversationId: string,
  fallback: string,
): Promise<string> {
  const { data } = await supabaseAdmin
    .from("messages")
    .select("connection_id")
    .eq("conversation_id", conversationId)
    .not("connection_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  return data?.[0]?.connection_id ?? fallback;
}

/**
 * Mensagem recebida de um consultor: retransmite para o lead pelo número da
 * empresa e registra tudo no sistema. Retorna true quando tratou a mensagem.
 */
export async function handleConsultantInbound(input: {
  companyId: string;
  trunkConnectionId: string;
  phone: string | null;
  text: string | null;
}): Promise<boolean> {
  const { companyId, trunkConnectionId } = input;
  const consultant = await resolveConsultantByPhone(companyId, input.phone);
  if (!consultant) return false;

  const trunk = await loadTrunk(companyId);
  const reply = async (message: string) => {
    if (trunk && input.phone) await sendToConsultant(trunk, input.phone, message);
  };

  const text = (input.text ?? "").trim();
  const conversationId = await findConsultantConversation(companyId, consultant.profileId);

  if (!conversationId) {
    await reply("ℹ️ Você não tem nenhum atendimento ativo no momento.");
    return true;
  }

  if (!text) {
    await reply("ℹ️ Por enquanto só consigo repassar mensagens de texto ao lead.");
    return true;
  }

  if (END_COMMANDS.includes(text.toLowerCase())) {
    await supabaseAdmin.rpc("set_conversation_status", {
      _conversation_id: conversationId,
      _status: "CLOSED",
    });
    await reply("✅ Atendimento encerrado. Obrigado!");
    return true;
  }

  const { data: conversation } = await supabaseAdmin
    .from("conversations")
    .select("channel_id, lead:leads(whatsapp)")
    .eq("id", conversationId)
    .maybeSingle();
  const destination =
    (conversation?.lead as { whatsapp: string | null } | null)?.whatsapp ??
    conversation?.channel_id ??
    null;
  const recipient = destination
    ? destination.includes("@")
      ? destination
      : PhoneNormalizationService.normalize(destination)
    : null;

  const connectionId = await conversationConnectionId(conversationId, trunkConnectionId);
  const creds = await loadMegaCredentials(connectionId);

  if (!recipient || !creds) {
    await reply("⚠️ Não consegui enviar sua mensagem ao lead. Use o sistema NexaAtende.");
    return true;
  }

  const { data: messageId } = await supabaseAdmin.rpc("create_outbound_message", {
    _conversation_id: conversationId,
    _company_id: companyId,
    _sender_id: consultant.profileId,
    _sender_type: "consultant",
    _sender_name: consultant.fullName ?? "Consultor",
    _content: text,
    _message_type: "text",
    _connection_id: connectionId,
  });

  const sent = await MegaApiService.sendText(creds, recipient, text);
  if (messageId) {
    await supabaseAdmin.rpc("finalize_outbound_message", {
      _message_id: messageId,
      _external_message_id: (sent.ok
        ? (sent.data?.key?.id ?? sent.data?.messageId ?? null)
        : null) as unknown as string,
      _status: sent.ok ? "SENT" : "FAILED",
      ...(sent.ok ? {} : { _reason: sent.error }),
    });
  }
  if (!sent.ok) {
    await reply(`⚠️ Falha ao entregar sua mensagem ao lead: ${sent.error}`);
    return true;
  }

  // Só encerra o rodízio depois que a primeira mensagem foi realmente entregue
  // à API do WhatsApp. Uma falha de envio não pode prender o lead ao consultor.
  const { error: responseError } = await supabaseAdmin.rpc("queue_register_response", {
    _conversation_id: conversationId,
    _user_id: consultant.profileId,
  });
  if (responseError) {
    console.error("[ponte] mensagem entregue, mas aceite da fila falhou", responseError.message);
  }
  return true;
}

/** Espelha no WhatsApp do consultor a mensagem que o lead enviou. */
export async function mirrorLeadMessageToConsultant(input: {
  companyId: string;
  conversationId: string;
  text: string | null;
  messageType: string;
}): Promise<void> {
  const { data: conversation } = await supabaseAdmin
    .from("conversations")
    .select("assigned_user_id, status, lead:leads(name)")
    .eq("id", input.conversationId)
    .maybeSingle();
  if (!conversation?.assigned_user_id) return;
  if (["CLOSED", "PAUSED"].includes(conversation.status)) return;

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("phone")
    .eq("id", conversation.assigned_user_id)
    .maybeSingle();

  const notificationPhone = await consultantNotificationPhone(
    input.companyId,
    conversation.assigned_user_id,
    profile?.phone ?? null,
  );
  if (!notificationPhone) return;

  const trunk = await loadTrunk(input.companyId);
  if (!trunk) return;

  const leadName = (conversation.lead as { name: string | null } | null)?.name?.trim() || "Lead";
  const body = (input.text ?? "").trim() || `[${input.messageType}] veja no sistema NexaAtende`;
  await sendToConsultant(trunk, notificationPhone, `💬 ${leadName}: ${body}`);
}

/** Notifica ofertas pendentes de todas as empresas (usado pelo relógio da fila). */
export async function notifyAllQueueOffers(): Promise<void> {
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data } = await supabaseAdmin
    .from("assignment_attempts")
    .select("company_id")
    .in("status", ["WAITING", "TIMEOUT"])
    .gte("assigned_at", cutoff)
    .limit(200);

  const companies = [...new Set((data ?? []).map((row) => row.company_id))];
  for (const companyId of companies) {
    try {
      await notifyQueueOffers(companyId);
    } catch (error) {
      console.error("[ponte] falha ao notificar empresa", companyId, error);
    }
  }
}
