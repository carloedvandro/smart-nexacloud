/**
 * Avaliação de atendimento (1 a 5 estrelas).
 *
 * Regra do NexaAtende: quando um lead passa por todo o rodízio e ninguém
 * assume (lead abandonado), o tronco envia uma pergunta ao cliente pedindo
 * uma nota de 1 a 5 pela experiência até ali. A resposta do lead é capturada
 * na entrada do webhook e gravada em `service_ratings`.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadTrunk } from "@/lib/queue/bridge.server";
import { MegaApiService } from "@/lib/whatsapp/mega.server";
import { WhatsAppIdentifierService } from "@/lib/whatsapp/jid";

const ASK_TEXT =
  "😔 Percebemos que sua espera está mais longa do que gostaríamos.\n\n" +
  "De 1 a 5 estrelas, como você avalia nosso atendimento até aqui?\n\n" +
  "1 ⭐ · 2 ⭐⭐ · 3 ⭐⭐⭐ · 4 ⭐⭐⭐⭐ · 5 ⭐⭐⭐⭐⭐\n" +
  "Responda apenas com o número.";

/** Janela em que a resposta do lead ainda é lida como nota. */
const ANSWER_WINDOW_MS = 24 * 60 * 60 * 1000;

async function sendToLead(companyId: string, conversationId: string, text: string) {
  const trunk = await loadTrunk(companyId);
  if (!trunk) return false;

  const { data: conversation } = await supabaseAdmin
    .from("conversations")
    .select("channel_id, lead:leads(whatsapp)")
    .eq("id", conversationId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!conversation) return false;

  const destination =
    (conversation.lead as { whatsapp: string | null } | null)?.whatsapp ?? conversation.channel_id;
  const recipient = WhatsAppIdentifierService.toRecipient(destination);
  if (!recipient) return false;

  const sent = await MegaApiService.sendText(trunk.creds, recipient, text);
  if (!sent.ok) {
    console.error("[avaliação] falha ao enviar", sent.error);
    return false;
  }

  await supabaseAdmin.rpc("post_message", {
    _conversation_id: conversationId,
    _sender_type: "system",
    _content: text,
    _message_type: "text",
    _sender_name: "NexaAtende",
  });
  return true;
}

/**
 * Envia a pergunta de avaliação para leads que acabaram de virar abandonados
 * (rodízio encerrado, sem responsável e sem oferta em aberto).
 */
export async function requestAbandonedRatings(companyId: string): Promise<number> {
  const since = new Date(Date.now() - 60 * 60_000).toISOString();

  const { data: candidates } = await supabaseAdmin
    .from("conversations")
    .select("id, lead_id, status, assigned_user_id, last_message_at, started_at")
    .eq("company_id", companyId)
    .is("assigned_user_id", null)
    .in("status", ["WAITING_HUMAN", "QUEUED"])
    .gte("last_message_at", since)
    .limit(20);

  const rows = candidates ?? [];
  if (rows.length === 0) return 0;

  const ids = rows.map((c) => c.id);
  const [{ data: attempts }, { data: existing }] = await Promise.all([
    supabaseAdmin.from("assignment_attempts").select("conversation_id, status").in("conversation_id", ids),
    supabaseAdmin.from("service_ratings").select("conversation_id").in("conversation_id", ids),
  ]);

  const tried = new Set((attempts ?? []).map((a) => a.conversation_id));
  const waiting = new Set(
    (attempts ?? []).filter((a) => a.status === "WAITING").map((a) => a.conversation_id),
  );
  const asked = new Set((existing ?? []).map((r) => r.conversation_id));

  let sent = 0;
  for (const conversation of rows) {
    if (!tried.has(conversation.id) || waiting.has(conversation.id)) continue;
    if (asked.has(conversation.id)) continue;

    // Reserva antes de enviar: a chave única evita pergunta duplicada quando
    // dois eventos disparam o mesmo ciclo ao mesmo tempo.
    const { error } = await supabaseAdmin.from("service_ratings").insert({
      company_id: companyId,
      conversation_id: conversation.id,
      lead_id: conversation.lead_id,
      reason: "ABANDONED",
    });
    if (error) continue;

    const ok = await sendToLead(companyId, conversation.id, ASK_TEXT);
    if (!ok) {
      await supabaseAdmin.from("service_ratings").delete().eq("conversation_id", conversation.id);
      continue;
    }
    sent += 1;
  }
  return sent;
}

/** Lê uma nota de 1 a 5 no texto do lead (número ou estrelas). */
export function parseRating(text: string | null): number | null {
  if (!text) return null;
  const clean = text.trim();
  const stars = (clean.match(/⭐|★/g) ?? []).length;
  if (stars >= 1 && stars <= 5) return stars;
  const match = clean.match(/^\s*([1-5])\s*(estrela|estrelas|⭐|★)?\s*[.!]?\s*$/i);
  return match?.[1] ? Number(match[1]) : null;
}

/**
 * Grava a nota quando o lead responde à pergunta de avaliação.
 * Retorna true quando a mensagem foi tratada como avaliação (a IA não deve
 * responder nesse caso).
 */
export async function captureRatingReply(input: {
  companyId: string;
  conversationId: string;
  text: string | null;
}): Promise<boolean> {
  const { data: pending } = await supabaseAdmin
    .from("service_ratings")
    .select("id, asked_at, rating")
    .eq("company_id", input.companyId)
    .eq("conversation_id", input.conversationId)
    .maybeSingle();

  if (!pending || pending.rating !== null) return false;
  if (Date.now() - new Date(pending.asked_at).getTime() > ANSWER_WINDOW_MS) return false;

  const rating = parseRating(input.text);
  if (rating === null) return false;

  await supabaseAdmin
    .from("service_ratings")
    .update({ rating, rated_at: new Date().toISOString(), comment: input.text })
    .eq("id", pending.id);

  await sendToLead(
    input.companyId,
    input.conversationId,
    rating >= 4
      ? `Obrigado pela nota ${"⭐".repeat(rating)}! Um consultor vai continuar seu atendimento em instantes.`
      : `Obrigado pelo retorno (${"⭐".repeat(rating)}). Sentimos muito pela demora — já sinalizamos ao time e um consultor vai te atender.`,
  );

  await supabaseAdmin.from("conversation_events").insert({
    company_id: input.companyId,
    conversation_id: input.conversationId,
    event_type: "SERVICE_RATED",
    metadata: { rating },
  });

  return true;
}
