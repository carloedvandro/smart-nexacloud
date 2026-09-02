/**
 * Retomada da IA depois que o rodízio termina sem nenhum consultor assumir.
 *
 * Regra do NexaAtende: o lead nunca pode ficar sem resposta. Quando a fila se
 * esgota, o banco devolve a conversa para a IA (evento AI_RESUMED) e aqui a IA
 * avisa o cliente que ninguém pôde atender agora e oferece novamente a
 * transferência para um atendente humano.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadTrunk } from "@/lib/queue/bridge.server";
import { WhatsAppIdentifierService } from "@/lib/whatsapp/jid";
import { MegaApiService } from "@/lib/whatsapp/mega.server";
import { loadAiSettings } from "@/lib/ai/agent.server";

const RESUME_EVENT = "AI_RESUMED";
const NOTIFIED_EVENT = "AI_RESUME_NOTIFIED";
const QUEUE_REASON = "rodízio esgotado";
const WINDOW_MS = 30 * 60_000;

function buildText(agentName: string, leadName: string | null): string {
  const hello = leadName ? `${leadName.split(/\s+/)[0]}, ` : "";
  return (
    `${hello}desculpe a demora! Nossos consultores estão todos em atendimento agora, ` +
    `então eu, ${agentName}, sigo com você por aqui. ` +
    "Posso te ajudar com a sua dúvida ou prefere que eu direcione para um atendente humano assim que liberar?"
  );
}

/** Avisa os clientes cujas conversas voltaram para a IA sem terem sido atendidos. */
export async function notifyAiResumedConversations(): Promise<number> {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();

  const { data: events } = await supabaseAdmin
    .from("conversation_events")
    .select("id, company_id, conversation_id, metadata, created_at")
    .eq("event_type", RESUME_EVENT)
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(50);

  let sentCount = 0;

  for (const event of events ?? []) {
    const reason = String((event.metadata as { reason?: string } | null)?.reason ?? "");
    if (!reason.includes(QUEUE_REASON)) continue;

    const { count: already } = await supabaseAdmin
      .from("conversation_events")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", event.conversation_id)
      .eq("event_type", NOTIFIED_EVENT)
      .gte("created_at", since);
    if ((already ?? 0) > 0) continue;

    // Reserva antes de enviar: evita mensagem duplicada em ticks concorrentes.
    const { error: claimError } = await supabaseAdmin.from("conversation_events").insert({
      company_id: event.company_id,
      conversation_id: event.conversation_id,
      event_type: NOTIFIED_EVENT,
      metadata: { resume_event_id: event.id },
    });
    if (claimError) continue;

    try {
      const settings = await loadAiSettings(event.company_id);
      if (!settings.enabled) continue;

      const { data: conversation } = await supabaseAdmin
        .from("conversations")
        .select("id, status, channel_id, lead:leads(name, whatsapp, phone)")
        .eq("id", event.conversation_id)
        .maybeSingle();
      if (!conversation || conversation.status !== "AI_ACTIVE") continue;

      const lead = conversation.lead as { name?: string | null; whatsapp?: string | null; phone?: string | null } | null;
      const recipient = WhatsAppIdentifierService.toRecipient(
        lead?.whatsapp ?? conversation.channel_id ?? lead?.phone ?? null,
      );
      const trunk = await loadTrunk(event.company_id);
      if (!recipient || !trunk) continue;

      const text = buildText(settings.agentName, lead?.name ?? null);

      const { data: messageId } = await supabaseAdmin.rpc("create_outbound_message", {
        _conversation_id: event.conversation_id,
        _company_id: event.company_id,
        _sender_id: null as unknown as string,
        _sender_type: "ai",
        _sender_name: "IA",
        _content: text,
        _message_type: "text",
        _connection_id: trunk.connectionId,
      });

      const sent = await MegaApiService.sendText(trunk.creds, recipient, text);

      if (messageId) {
        await supabaseAdmin.rpc("finalize_outbound_message", {
          _message_id: messageId as unknown as string,
          _external_message_id: (sent.ok
            ? (sent.data?.key?.id ?? sent.data?.messageId ?? null)
            : null) as unknown as string,
          _status: sent.ok ? "SENT" : "FAILED",
          ...(sent.ok ? {} : { _reason: sent.error }),
        });
      }
      if (sent.ok) sentCount += 1;
      else console.error("[ia] falha ao avisar retomada", sent.error);
    } catch (error) {
      console.error("[ia] erro ao retomar conversa", event.conversation_id, error);
    }
  }

  return sentCount;
}
