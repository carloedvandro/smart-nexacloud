import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { processWebhookEvent } from "@/lib/whatsapp/ingest.server";

type ClaimedEvent = {
  id: string;
  company_id: string | null;
  connection_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
};

/**
 * Eventos antigos não podem ser reprocessados: o WhatsApp/MEGA reenvia e a fila
 * pode acumular. Reproduzir um áudio de uma hora atrás duplica a conversa no
 * painel e faz a IA responder mensagens já vencidas.
 */
const STALE_EVENT_MS = 5 * 60_000;

/** Momento em que a mensagem foi criada no WhatsApp (segundos ou ms). */
function eventTimestampMs(payload: Record<string, unknown>): number | null {
  const data = (payload["data"] as Record<string, unknown> | undefined) ?? payload;
  for (const source of [payload, data]) {
    for (const key of ["messageTimestamp", "timestamp", "t", "date_time"]) {
      const raw = source[key];
      const value = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
      if (Number.isFinite(value) && value > 0) return value > 1e12 ? value : value * 1_000;
    }
  }
  return null;
}

/**
 * Chave da conversa dentro do lote. Mensagens da MESMA conversa continuam em
 * ordem (uma após a outra); conversas diferentes correm em paralelo, para que
 * um áudio demorado (transcrição + IA + voz) não segure as outras mensagens.
 */
function conversationKey(event: ClaimedEvent): string {
  return `${event.connection_id ?? "-"}:${extractRemoteJid(event.payload) ?? event.id}`;
}

async function runEvent(event: ClaimedEvent): Promise<boolean> {
  if (!event.company_id || !event.connection_id) {
    await finishEvent(event, "evento sem empresa ou conexão");
    return false;
  }

  const sentAt = eventTimestampMs(event.payload);
  if (sentAt && Date.now() - sentAt > STALE_EVENT_MS) {
    await finishEvent(event, "evento expirado (mensagem antiga, não reprocessada)");
    return false;
  }

  try {
    const outcome = await processWebhookEvent({
      companyId: event.company_id,
      connectionId: event.connection_id,
      payload: event.payload,
    });
    if (outcome.status === "error") {
      await retryEvent(event, outcome.reason ?? "erro no processamento");
      return false;
    }
    await finishEvent(event, null);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[whatsapp-worker] evento falhou", { id: event.id, message });
    await retryEvent(event, message);
    return false;
  }
}

/** Processa a fila persistente sem depender da conexão HTTP do webhook. */
export async function processPendingWhatsappEvents(limit = 10): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc("claim_whatsapp_events", { _limit: limit });
  if (error) {
    console.error("[whatsapp-worker] falha ao reservar eventos", error.message);
    return 0;
  }

  const events = (data ?? []) as ClaimedEvent[];
  if (!events.length) return 0;

  const groups = new Map<string, ClaimedEvent[]>();
  for (const event of events) {
    const key = conversationKey(event);
    const list = groups.get(key);
    if (list) list.push(event);
    else groups.set(key, [event]);
  }

  const results = await Promise.all(
    [...groups.values()].map(async (group) => {
      let done = 0;
      for (const event of group) {
        if (await runEvent(event)) done += 1;
      }
      return done;
    }),
  );
  return results.reduce((total, value) => total + value, 0);
}

async function finishEvent(event: ClaimedEvent, error: string | null): Promise<void> {
  await supabaseAdmin
    .from("whatsapp_events")
    .update({ processed_at: new Date().toISOString(), processing_started_at: null, error })
    .eq("id", event.id);
}

async function retryEvent(event: ClaimedEvent, message: string): Promise<void> {
  await supabaseAdmin
    .from("whatsapp_events")
    .update({
      processing_started_at: null,
      error: message.slice(0, 1_000),
      ...(event.attempts >= 5 ? { processed_at: new Date().toISOString() } : {}),
    })
    .eq("id", event.id);
}