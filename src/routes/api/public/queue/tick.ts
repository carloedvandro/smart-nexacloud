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

async function handle(request: Request): Promise<Response> {
  const secret = process.env["QUEUE_CRON_TOKEN"];
  if (secret) {
    const url = new URL(request.url);
    const provided = request.headers.get("x-cron-token") ?? url.searchParams.get("token");
    if (provided !== secret) {
      return new Response(JSON.stringify({ error: "não autorizado" }), init(401));
    }
  }

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

      void runTick()
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

async function runTick(): Promise<{ processed: number; whatsappProcessed: number }> {

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("queue_tick");
  if (error) {
    console.error("[fila] tick falhou", error.message);
    throw new Error(error.message);
  }

  // Processa eventos recebidos pelo WhatsApp fora da requisição do provedor.
  // A fila tem lease e retentativas, portanto uma execução interrompida volta
  // automaticamente no próximo tick sem perder o áudio do lead.
  const { processPendingWhatsappEvents } = await import("@/lib/whatsapp/event-worker.server");
  const whatsappProcessed = await processPendingWhatsappEvents(12);

  // Avisa no WhatsApp os consultores com oferta pendente ou repassada.
  const { notifyAllQueueOffers } = await import("@/lib/queue/bridge.server");
  await notifyAllQueueOffers();

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

function init(status = 200): ResponseInit {
  return { status, headers: { "content-type": "application/json", "cache-control": "no-store" } };
}
