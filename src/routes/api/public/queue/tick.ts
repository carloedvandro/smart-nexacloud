import { createFileRoute } from "@tanstack/react-router";

/**
 * Batida do relógio da fila: expira ofertas vencidas (SLA) e repassa a conversa
 * para o próximo consultor. Endpoint público apenas para agendadores externos;
 * não expõe dado algum e exige o token de cron quando ele estiver configurado.
 */
export const Route = createFileRoute("/api/public/queue/tick")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});

type TickScope = "full" | "whatsapp";

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const secret = process.env["QUEUE_CRON_TOKEN"];
  if (secret) {
    const provided = request.headers.get("x-cron-token") ?? url.searchParams.get("token");
    if (provided !== secret) {
      return new Response(JSON.stringify({ error: "não autorizado" }), init(401));
    }
  }

  // O trigger do banco chama este endpoint a cada evento recebido do WhatsApp
  // só para escoar a fila de eventos; o restante (SLA, avisos, avaliações)
  // continua no cron completo.
  const scope: TickScope = url.searchParams.get("scope") === "whatsapp" ? "whatsapp" : "full";

  // O processamento de áudio pode levar mais que o limite de inatividade da
  // infraestrutura HTTP. Devolver um stream imediatamente e emitir batimentos
  // mantém a execução viva até transcrição, LLM, TTS, storage e MEGA terminarem.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('{"status":"processing"}\n'));
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode('{"status":"processing"}\n'));
      }, 2_000);

      void runTick(scope)
        .then((result) => {
          controller.enqueue(encoder.encode(`${JSON.stringify({ ok: true, ...result })}\n`));
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          console.error("[fila] execução do tick falhou", message);
          controller.enqueue(encoder.encode(`${JSON.stringify({ ok: false, error: message })}\n`));
        })
        .finally(() => {
          clearInterval(heartbeat);
          controller.close();
        });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

async function runTick(
  scope: TickScope,
): Promise<{ processed: number; whatsappProcessed: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { processPendingWhatsappEvents } = await import("@/lib/whatsapp/event-worker.server");

  // Escopo do trigger: só escoa a fila de eventos do WhatsApp. Reprocessa em
  // lotes até esvaziar para uma rajada de mensagens não esperar o cron.
  if (scope === "whatsapp") {
    let whatsappProcessed = 0;
    for (let round = 0; round < 5; round++) {
      const batch = await processPendingWhatsappEvents(12);
      whatsappProcessed += batch;
      if (batch === 0) break;
    }
    return { processed: 0, whatsappProcessed };
  }

  const { data, error } = await supabaseAdmin.rpc("queue_tick");
  if (error) {
    console.error("[fila] tick falhou", error.message);
    throw new Error(error.message);
  }

  // Processa eventos recebidos pelo WhatsApp fora da requisição do provedor.
  // A fila tem lease e retentativas, portanto uma execução interrompida volta
  // automaticamente no próximo tick sem perder o áudio do lead.
  const whatsappProcessed = await processPendingWhatsappEvents(12);

  // Avisa no WhatsApp os consultores com oferta pendente ou repassada.
  const { notifyAllQueueOffers } = await import("@/lib/queue/bridge.server");
  await notifyAllQueueOffers();

  // Rodízio esgotado: a IA retoma e avisa o cliente que ninguém pôde atender.
  const { notifyAiResumedConversations } = await import("@/lib/ai/resume.server");
  await notifyAiResumedConversations().catch((e) => console.error("[ia] retomada falhou", e));

  // Pedido de humano em aberto: enquanto a IA troca mensagens com o lead, o
  // painel mostra "IA atendendo". Quando a conversa esfria (sem mensagens por
  // alguns minutos), volta a mostrar "Aguardando consultor" — é o sinal para o
  // administrador puxar o atendimento. A IA continua pronta para retomar assim
  // que o cliente mandar a próxima mensagem.
  await coolDownIdleHumanRequests().catch((e) => console.error("[fila] esfriamento falhou", e));

  // Pede avaliação nos leads que ficaram abandonados após o rodízio.
  const { data: companies } = await supabaseAdmin
    .from("conversations")
    .select("company_id")
    .is("assigned_user_id", null)
    .in("status", ["WAITING_HUMAN", "QUEUED"])
    .gte("last_message_at", new Date(Date.now() - 60 * 60_000).toISOString())
    .limit(200);
  const { requestAbandonedRatings } = await import("@/lib/rating/rating.server");
  for (const companyId of [...new Set((companies ?? []).map((c) => c.company_id))]) {
    await requestAbandonedRatings(companyId).catch((e) =>
      console.error("[avaliação] falha", companyId, e),
    );
  }

  return { processed: Number(data ?? 0), whatsappProcessed };
}

/** Sem mensagens por este tempo, a conversa "esfria" e o painel volta a mostrar "Aguardando consultor". */
const COLD_AFTER_MS = 3 * 60_000;

async function coolDownIdleHumanRequests(): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: activeConvs } = await supabaseAdmin
    .from("conversations")
    .select("id, lead_id")
    .eq("status", "AI_ACTIVE")
    .is("assigned_user_id", null)
    .not("lead_id", "is", null)
    .lt("last_message_at", new Date(Date.now() - COLD_AFTER_MS).toISOString())
    .limit(100);

  const conversations = activeConvs ?? [];
  if (conversations.length === 0) return;

  const { data: exhausted } = await supabaseAdmin
    .from("conversation_events")
    .select("conversation_id")
    .eq("event_type", "QUEUE_NO_CONSULTANT")
    .in(
      "conversation_id",
      conversations.map((c) => c.id),
    )
    .gte("created_at", new Date(Date.now() - 24 * 60 * 60_000).toISOString());

  const exhaustedSet = new Set((exhausted ?? []).map((e) => e.conversation_id));
  const leadIds = conversations
    .filter((c) => exhaustedSet.has(c.id))
    .map((c) => c.lead_id as string);
  if (leadIds.length === 0) return;

  const { data: qualifying } = await supabaseAdmin
    .from("leads")
    .select("id")
    .in("id", leadIds)
    .eq("status", "AI_QUALIFYING");

  const coldLeadIds = (qualifying ?? []).map((l) => l.id);
  if (coldLeadIds.length === 0) return;

  const coldConvIds = conversations
    .filter((c) => coldLeadIds.includes(c.lead_id as string))
    .map((c) => c.id);

  await supabaseAdmin.from("leads").update({ status: "WAITING_HUMAN" }).in("id", coldLeadIds);
  await supabaseAdmin
    .from("conversations")
    .update({ status: "WAITING_HUMAN" })
    .in("id", coldConvIds);
}

function init(status = 200): ResponseInit {
  return { status, headers: { "content-type": "application/json", "cache-control": "no-store" } };
}
