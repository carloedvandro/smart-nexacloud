import { createFileRoute } from "@tanstack/react-router";

/**
 * Batida do relógio dos Disparos. Endpoint público apenas para agendadores
 * externos (pg_cron); não expõe dado algum e exige o token de cron quando ele
 * estiver configurado. O envio acontece integralmente no backend.
 */
export const Route = createFileRoute("/api/public/broadcast/tick")({
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
      return new Response(JSON.stringify({ error: "não autorizado" }), {
        status: 401,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('{"status":"processing"}\n'));
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode('{"status":"processing"}\n'));
      }, 2_000);

      void import("@/lib/broadcast/worker.server")
        .then((mod) => mod.runBroadcastTick())
        .then((result) => {
          controller.enqueue(encoder.encode(`${JSON.stringify({ ok: true, ...result })}\n`));
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          console.error("[disparos] tick falhou", message);
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
