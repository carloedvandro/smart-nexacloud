import { createFileRoute } from "@tanstack/react-router";

/**
 * Webhook CENTRAL da MEGA API (uma única URL para todas as instâncias).
 * A conexão é identificada pela `instance_key` enviada no payload — nunca por
 * company_id vindo do cliente. Eventos de grupo e status@broadcast são
 * ignorados dentro do processamento (ingest.server.ts).
 * Sempre responde 200 rapidamente para evitar reenvio em loop do provedor.
 */
export const Route = createFileRoute("/api/public/whatsapp/webhook")({
  server: {
    handlers: {
      GET: () => new Response(JSON.stringify({ ok: true }), jsonInit()),
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { extractInstanceKey } = await import("@/lib/whatsapp/instance-key");

        let payload: Record<string, unknown>;
        try {
          payload = (await request.json()) as Record<string, unknown>;
        } catch {
          return new Response(JSON.stringify({ error: "payload inválido" }), jsonInit(400));
        }

        const instanceKey = extractInstanceKey(payload);
        if (!instanceKey) {
          return new Response(
            JSON.stringify({ ok: true, ignored: "instance_key ausente" }),
            jsonInit(),
          );
        }

        const { data: credential } = await supabaseAdmin
          .from("whatsapp_credentials")
          .select("connection_id, company_id")
          .eq("instance_key", instanceKey)
          .maybeSingle();

        if (!credential) {
          console.warn("[whatsapp] instance_key desconhecida no webhook central");
          return new Response(
            JSON.stringify({ ok: true, ignored: "instância não reconhecida" }),
            jsonInit(),
          );
        }

        const externalEventId = extractEventId(payload);

        // Idempotência: índice único (connection_id, external_event_id).
        const { error: eventError } = await supabaseAdmin
          .from("whatsapp_events")
          .insert({
            company_id: credential.company_id,
            connection_id: credential.connection_id,
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

        // O trabalho pesado roda pela fila persistente. Responder agora evita
        // que a MEGA encerre o webhook e mate transcrição/TTS com HTTP 499.
        return new Response(JSON.stringify({ ok: true, queued: true }), jsonInit());
      },
    },
  },
});

function jsonInit(status = 200): ResponseInit {
  return { status, headers: { "content-type": "application/json" } };
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
