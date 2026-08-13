import { createFileRoute } from "@tanstack/react-router";

/**
 * Webhook público da MEGA API.
 * A URL contém um token exclusivo por instância — é ele que identifica a
 * conexão e a empresa. Nenhum dado é aceito sem token válido.
 * Sempre responde 200 rapidamente: o provedor não deve reenviar em loop.
 */
export const Route = createFileRoute("/api/public/whatsapp/webhook/$token")({
  server: {
    handlers: {
      GET: () => new Response(JSON.stringify({ ok: true }), jsonInit()),
      POST: async ({ request, params }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { processWebhookEvent } = await import("@/lib/whatsapp/ingest.server");

        const token = params.token;
        if (!isUuid(token)) {
          return new Response(JSON.stringify({ error: "token inválido" }), jsonInit(401));
        }

        const { data: connection } = await supabaseAdmin
          .from("whatsapp_connections")
          .select("id, company_id, status")
          .eq("webhook_token", token)
          .maybeSingle();

        if (!connection) {
          return new Response(JSON.stringify({ error: "token inválido" }), jsonInit(401));
        }

        let payload: Record<string, unknown>;
        try {
          payload = (await request.json()) as Record<string, unknown>;
        } catch {
          return new Response(JSON.stringify({ error: "payload inválido" }), jsonInit(400));
        }

        const externalEventId = extractEventId(payload);

        // Idempotência: o índice único (connection_id, external_event_id) barra repetições.
        const { data: eventRow, error: eventError } = await supabaseAdmin
          .from("whatsapp_events")
          .insert({
            company_id: connection.company_id,
            connection_id: connection.id,
            provider: "mega",
            event_type: String(payload["event"] ?? payload["type"] ?? "unknown"),
            external_event_id: externalEventId,
            payload: payload as never,
          })
          .select("id")
          .maybeSingle();

        if (eventError) {
          if (eventError.code === "23505") {
            return new Response(JSON.stringify({ ok: true, duplicate: true }), jsonInit());
          }
          console.error("[whatsapp] falha ao registrar evento", eventError.message);
          return new Response(JSON.stringify({ ok: true, stored: false }), jsonInit());
        }

        const outcome = await processWebhookEvent({
          connectionId: connection.id,
          companyId: connection.company_id,
          payload,
        });

        if (eventRow?.id) {
          await supabaseAdmin
            .from("whatsapp_events")
            .update({
              processed_at: new Date().toISOString(),
              error: outcome.status === "error" ? (outcome.reason ?? "erro") : null,
            })
            .eq("id", eventRow.id);
        }

        return new Response(JSON.stringify({ ok: true, ...outcome }), jsonInit());
      },
    },
  },
});

function jsonInit(status = 200): ResponseInit {
  return { status, headers: { "content-type": "application/json" } };
}

function isUuid(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
}

function extractEventId(payload: Record<string, unknown>): string | null {
  const data = (payload["data"] as Record<string, unknown> | undefined) ?? payload;
  const key = data["key"] as Record<string, unknown> | undefined;
  const candidates = [key?.["id"], data["id"], payload["id"], payload["messageId"]];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return `${String(payload["event"] ?? payload["type"] ?? "evt")}:${candidate.trim()}`;
    }
  }
  return null;
}
