/**
 * Notificações push (Web Push / VAPID) para consultores e administradores.
 * Funciona no Android (navegador) e no iOS 16.4+ quando o NexaAtende está
 * adicionado à tela de início.
 */
import { buildPushPayload, type PushSubscription } from "@block65/webcrypto-web-push";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type PushNotification = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  requireInteraction?: boolean;
};

type Row = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

function vapidKeys() {
  const subject = process.env["VAPID_SUBJECT"];
  const publicKey = process.env["VAPID_PUBLIC_KEY"];
  const privateKey = process.env["VAPID_PRIVATE_KEY"];
  if (!subject || !publicKey || !privateKey) return null;
  return { subject, publicKey, privateKey };
}

export function getVapidPublicKey(): string | null {
  return process.env["VAPID_PUBLIC_KEY"] ?? null;
}

async function deliver(row: Row, notification: PushNotification, vapid: NonNullable<ReturnType<typeof vapidKeys>>) {
  const subscription: PushSubscription = {
    endpoint: row.endpoint,
    expirationTime: null,
    keys: { p256dh: row.p256dh, auth: row.auth },
  };

  try {
    const payload = await buildPushPayload(
      { data: JSON.stringify(notification), options: { ttl: 600, urgency: "high" } },
      subscription,
      vapid,
    );
    const res = await fetch(row.endpoint, payload);
    if (res.ok || res.status === 201 || res.status === 202) {
      await supabaseAdmin
        .from("push_subscriptions")
        .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
        .eq("id", row.id);
      return true;
    }
    if (res.status === 404 || res.status === 410) {
      // Dispositivo removeu a permissão: apagamos o registro.
      await supabaseAdmin.from("push_subscriptions").delete().eq("id", row.id);
      return false;
    }
    console.error("[push] falha ao entregar", res.status, (await res.text()).slice(0, 300));
    await supabaseAdmin
      .from("push_subscriptions")
      .update({ failure_count: 1 })
      .eq("id", row.id);
    return false;
  } catch (error) {
    console.error("[push] erro ao entregar", error instanceof Error ? error.message : error);
    return false;
  }
}

/** Envia um aviso para todos os dispositivos dos usuários informados. */
export async function sendPushToUsers(
  userIds: Array<string | null | undefined>,
  notification: PushNotification,
): Promise<number> {
  const vapid = vapidKeys();
  if (!vapid) {
    console.warn("[push] chaves VAPID ausentes — aviso não enviado");
    return 0;
  }
  const ids = Array.from(new Set(userIds.filter((id): id is string => Boolean(id))));
  if (!ids.length) return 0;

  const { data } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", ids);

  const rows = (data ?? []) as Row[];
  if (!rows.length) return 0;

  const results = await Promise.all(rows.map((row) => deliver(row, notification, vapid)));
  return results.filter(Boolean).length;
}

/** Todos os usuários ativos da empresa (para avisos sem dono definido). */
async function companyUserIds(companyId: string, exclude?: string | null) {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("company_id", companyId);
  return (data ?? [])
    .map((row) => row.id as string)
    .filter((id) => id !== exclude);
}

function preview(text: string | null | undefined, fallback: string) {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, 140) : fallback;
}

/** Mensagem nova do cliente numa conversa. */
export async function notifyInboundMessage(input: {
  companyId: string;
  conversationId: string;
  content?: string | null;
  messageType?: string | null;
}): Promise<void> {
  const { companyId, conversationId } = input;
  const { data: conversation } = await supabaseAdmin
    .from("conversations")
    .select("id, status, assigned_user_id, lead:leads(name, whatsapp)")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversation) return;

  const lead = (conversation.lead ?? null) as { name: string | null; whatsapp: string | null } | null;
  const leadName = lead?.name?.trim() || lead?.whatsapp || "Novo contato";
  const fallbackByType: Record<string, string> = {
    audio: "🎤 Áudio recebido",
    image: "🖼️ Imagem recebida",
    sticker: "Figurinha recebida",
    video: "🎬 Vídeo recebido",
    document: "📎 Documento recebido",
  };
  const body = preview(input.content, fallbackByType[input.messageType ?? "text"] ?? "Nova mensagem");
  const url = `/conversas?c=${conversationId}`;

  const owner = conversation.assigned_user_id as string | null;
  if (owner) {
    await sendPushToUsers([owner], {
      title: `💬 ${leadName}`,
      body,
      url,
      tag: `conv-${conversationId}`,
    });
    return;
  }

  if (conversation.status === "WAITING_HUMAN") {
    await sendPushToUsers(await companyUserIds(companyId), {
      title: `🔔 Lead aguardando: ${leadName}`,
      body,
      url,
      tag: `conv-${conversationId}`,
      requireInteraction: true,
    });
  }
}

/** Lead atribuído (ou oferecido no rodízio) a um consultor. */
export async function notifyLeadAssigned(input: {
  userId: string;
  leadName: string;
  conversationId: string;
  detail?: string;
  offer?: boolean;
}): Promise<void> {
  await sendPushToUsers([input.userId], {
    title: input.offer ? `⏱️ Novo atendimento para você` : `🔔 Lead atribuído a você`,
    body: input.detail ? `${input.leadName} — ${input.detail}` : input.leadName,
    url: `/conversas?c=${input.conversationId}`,
    tag: `assign-${input.conversationId}`,
    requireInteraction: true,
  });
}

/** Ninguém assumiu: lead abandonado / SLA estourado. */
export async function notifyLeadAbandoned(input: {
  companyId: string;
  conversationId: string;
  leadName: string;
}): Promise<void> {
  await sendPushToUsers(await companyUserIds(input.companyId), {
    title: `⚠️ Lead sem atendimento: ${input.leadName}`,
    body: "O tempo de resposta expirou e ninguém assumiu. Toque para abrir.",
    url: `/conversas?c=${input.conversationId}`,
    tag: `abandon-${input.conversationId}`,
    requireInteraction: true,
  });
}
