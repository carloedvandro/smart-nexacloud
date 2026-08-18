/**
 * Avisos de fila no WhatsApp pessoal do consultor.
 *
 * Regra do NexaAtende: existe UM único número conectado à MEGA API — o
 * WhatsApp tronco da empresa. O consultor NÃO conecta o WhatsApp dele à
 * plataforma e NÃO atende pelo telefone: ele apenas recebe o aviso da oferta
 * (enviado pelo tronco) com o link da conversa e responde pelo painel.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadMegaCredentials } from "@/lib/whatsapp/credentials.server";
import { MegaApiService, type MegaCredentials } from "@/lib/whatsapp/mega.server";
import { PhoneNormalizationService } from "@/lib/nexa/phone";
import { getPublicBaseUrl } from "@/lib/nexa/public-url";

const EVENT_OFFER_NOTIFIED = "CONSULTANT_NOTIFIED";
const EVENT_TIMEOUT_NOTIFIED = "CONSULTANT_TIMEOUT_NOTIFIED";

type TrunkContext = { connectionId: string; creds: MegaCredentials; phone: string | null };

/** Instância tronco da empresa (ponto único de entrada e saída). */
async function loadTrunk(companyId: string): Promise<TrunkContext | null> {
  const { data } = await supabaseAdmin
    .from("whatsapp_connections")
    .select("id, phone_number")
    .eq("company_id", companyId)
    .eq("is_trunk", true)
    .maybeSingle();
  if (!data) return null;
  const creds = await loadMegaCredentials(data.id);
  return creds
    ? {
        connectionId: data.id,
        creds,
        phone: PhoneNormalizationService.normalize(data.phone_number),
      }
    : null;
}

async function sendToConsultant(trunk: TrunkContext, phone: string, text: string) {
  const to = PhoneNormalizationService.normalize(phone);
  if (!to) return false;
  // Nunca enviar para o próprio tronco: geraria eco/loop do número consigo mesmo.
  if (trunk.phone && to === trunk.phone) {
    console.warn("[aviso] destino é o próprio número tronco — envio ignorado");
    return false;
  }
  const sent = await MegaApiService.sendText(trunk.creds, to, text);
  if (!sent.ok) console.error("[aviso] falha ao avisar consultor", sent.error);
  return sent.ok;
}


async function claimNotification(
  companyId: string,
  conversationId: string,
  eventType: string,
  attemptId: string,
): Promise<boolean> {
  const { error } = await supabaseAdmin.from("conversation_events").insert({
    company_id: companyId,
    conversation_id: conversationId,
    event_type: eventType,
    metadata: { attempt_id: attemptId },
  });
  if (!error) return true;
  if (error.code === "23505") return false;
  console.error("[aviso] falha ao reservar notificação", error.message);
  return false;
}

async function releaseNotificationClaim(
  conversationId: string,
  eventType: string,
  attemptId: string,
) {
  await supabaseAdmin
    .from("conversation_events")
    .delete()
    .eq("conversation_id", conversationId)
    .eq("event_type", eventType)
    .eq("metadata->>attempt_id", attemptId);
}

async function cancelInvalidTrunkOffer(
  companyId: string,
  conversationId: string,
  attemptId: string,
  consultantId: string,
) {
  const resolvedAt = new Date().toISOString();
  await Promise.all([
    supabaseAdmin
      .from("assignment_attempts")
      .update({ status: "CANCELLED", resolved_at: resolvedAt })
      .eq("id", attemptId)
      .in("status", ["WAITING", "TIMEOUT"]),
    supabaseAdmin
      .from("conversation_assignments")
      .update({
        status: "RELEASED",
        ended_at: resolvedAt,
        reason: "telefone do consultor coincide com o tronco",
      })
      .eq("company_id", companyId)
      .eq("conversation_id", conversationId)
      .eq("consultant_id", consultantId)
      .eq("status", "ACTIVE"),
    supabaseAdmin
      .from("conversations")
      .update({ assigned_user_id: null, status: "WAITING_HUMAN" })
      .eq("id", conversationId)
      .eq("company_id", companyId)
      .eq("assigned_user_id", consultantId),
  ]);
}

function firstName(name: string | null | undefined) {
  return (name ?? "").trim().split(/\s+/)[0] || "consultor(a)";
}

/**
 * O aviso vai sempre para o WhatsApp pessoal cadastrado no perfil do
 * consultor. Instância própria não é requisito para participar do rodízio.
 */
function consultantNotificationPhone(profilePhone: string | null): string | null {
  return PhoneNormalizationService.normalize(profilePhone);
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
    console.error("[aviso] empresa sem instância tronco com credenciais", companyId);
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

    const notificationPhone = consultantNotificationPhone(profile.phone);
    if (!notificationPhone) {
      console.error("[aviso] consultor sem WhatsApp pessoal cadastrado", attempt.consultant_id);
      continue;
    }
    if (trunk.phone && notificationPhone === trunk.phone) {
      console.warn(
        "[aviso] consultor usa o mesmo número do tronco — oferta cancelada",
        attempt.consultant_id,
      );
      await cancelInvalidTrunkOffer(
        companyId,
        attempt.conversation_id,
        attempt.id,
        attempt.consultant_id,
      );
      continue;
    }


    if (attempt.status === "TIMEOUT") {
      const claimed = await claimNotification(
        companyId,
        attempt.conversation_id,
        EVENT_TIMEOUT_NOTIFIED,
        attempt.id,
      );
      if (!claimed) continue;
      const timeoutSent = await sendToConsultant(
        trunk,
        notificationPhone,
        "⌛ O tempo de resposta expirou e este atendimento foi repassado para outro consultor.",
      );
      if (!timeoutSent) {
        await releaseNotificationClaim(
          attempt.conversation_id,
          EVENT_TIMEOUT_NOTIFIED,
          attempt.id,
        );
      }
      continue;
    }

    const claimed = await claimNotification(
      companyId,
      attempt.conversation_id,
      EVENT_OFFER_NOTIFIED,
      attempt.id,
    );
    if (!claimed) continue;

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
      `⏱️ Você tem ${seconds || 60}s para assumir no painel, senão passa para o próximo.`,
      "",
      `🖥️ Abra e responda pelo NexaAtende: ${getPublicBaseUrl()}/conversas?c=${attempt.conversation_id}`,
      "",
      "⚠️ Não responda por aqui: o atendimento acontece somente no painel, e a resposta ao lead sai pelo número da empresa.",
    ]
      .filter((line) => line !== "")
      .join("\n");

    const ok = await sendToConsultant(trunk, notificationPhone, text);
    if (!ok) {
      await releaseNotificationClaim(attempt.conversation_id, EVENT_OFFER_NOTIFIED, attempt.id);
    }
  }
}

/** O número que enviou a mensagem pertence a um colaborador da empresa? */
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
  return match ? { profileId: match.id, fullName: match.full_name } : null;
}

/**
 * O consultor só pode falar com o lead enquanto a oportunidade for dele:
 * ou a conversa está atribuída a ele, ou ele tem uma oferta ainda em aberto
 * (WAITING). Quando a oferta expira e passa para o próximo, o acesso do
 * anterior deixa de valer imediatamente — inclusive pelo link já aberto.
 */
export async function consultantCanHandle(
  companyId: string,
  conversationId: string,
  profileId: string,
): Promise<boolean> {
  const { data: conversation } = await supabaseAdmin
    .from("conversations")
    .select("id, status, assigned_user_id")
    .eq("id", conversationId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!conversation) return false;
  if (["CLOSED", "PAUSED"].includes(conversation.status)) return false;
  if (conversation.assigned_user_id) return conversation.assigned_user_id === profileId;

  const { data: waiting } = await supabaseAdmin
    .from("assignment_attempts")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("consultant_id", profileId)
    .eq("status", "WAITING")
    .limit(1);
  return Boolean(waiting?.length);
}

/**
 * Mensagem recebida no tronco vinda do número pessoal de um colaborador.
 * A plataforma NÃO retransmite mais essa mensagem ao lead: o atendimento é
 * feito no painel. Aqui apenas evitamos que o consultor vire lead e
 * respondemos com o link do sistema. Retorna true quando tratou a mensagem.
 */
export async function handleConsultantInbound(input: {
  companyId: string;
  trunkConnectionId: string;
  phone: string | null;
  text: string | null;
}): Promise<boolean> {
  const { companyId } = input;
  const consultant = await resolveConsultantByPhone(companyId, input.phone);
  if (!consultant) return false;

  const trunk = await loadTrunk(companyId);
  if (!trunk || !input.phone) return true;

  // Conversa em aberto dele (oferta pendente ou já assumida), se houver.
  const { data: waiting } = await supabaseAdmin
    .from("assignment_attempts")
    .select("conversation_id")
    .eq("company_id", companyId)
    .eq("consultant_id", consultant.profileId)
    .eq("status", "WAITING")
    .order("assigned_at", { ascending: false })
    .limit(1);

  const { data: active } = await supabaseAdmin
    .from("conversations")
    .select("id")
    .eq("company_id", companyId)
    .eq("assigned_user_id", consultant.profileId)
    .not("status", "in", "(CLOSED,PAUSED)")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1);

  const conversationId = waiting?.[0]?.conversation_id ?? active?.[0]?.id ?? null;
  const link = conversationId
    ? `${getPublicBaseUrl()}/conversas?c=${conversationId}`
    : `${getPublicBaseUrl()}/conversas`;

  await sendToConsultant(
    trunk,
    input.phone,
    conversationId
      ? `🖥️ O atendimento é feito no painel do NexaAtende — mensagens enviadas por aqui não chegam ao lead.\n\n👉 ${link}`
      : "ℹ️ Você não tem nenhum atendimento ativo no momento. Quando receber uma oferta, atenda pelo painel do NexaAtende.",
  );
  return true;
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
      console.error("[aviso] falha ao notificar empresa", companyId, error);
    }
  }
}
