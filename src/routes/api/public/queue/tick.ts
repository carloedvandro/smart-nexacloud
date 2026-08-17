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

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("queue_tick");
  if (error) {
    console.error("[fila] tick falhou", error.message);
    return new Response(JSON.stringify({ ok: false }), init(500));
  }
  return new Response(JSON.stringify({ ok: true, processed: Number(data ?? 0) }), init());
}

function init(status = 200): ResponseInit {
  return { status, headers: { "content-type": "application/json", "cache-control": "no-store" } };
}
