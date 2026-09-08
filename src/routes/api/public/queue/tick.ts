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
      const batch = await processPendingWhatsappEvents(20);
      whatsappProcessed += batch;
      if (batch === 0) break;
    }
    // O disparo do trigger também esfria conversas paradas: com movimento no
    // WhatsApp, o painel volta a mostrar "Aguardando consultor" em ~10s após a
    // última troca, sem depender do cron de 30s.
    await coolDownIdleHumanRequests().catch((e) => console.error("[fila] esfriamento falhou", e));
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

/** Respiro após o lead terminar de consumir a última mensagem antes de "esfriar". */
const COLD_AFTER_MS = 10_000;
/** Última mensagem é do lead e a IA ainda não respondeu: tolerância antes de esfriar. */
const PENDING_REPLY_MS = 90_000;

type RecentMessage = {
  conversation_id: string;
  sender_type: string;
  message_type: string;
  content: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

/**
 * Quanto tempo o lead leva para consumir a última mensagem da IA:
 * áudio = duração real enviada pelo provedor; texto = ritmo de leitura
 * (~3 palavras/s no celular); mídia sem texto = estimativa fixa.
 */
function estimateConsumptionSeconds(message: {
  message_type: string;
  content: string | null;
  metadata: Record<string, unknown> | null;
}): number {
  if (message.message_type === "audio") {
    const raw = message.metadata?.["audio_seconds"];
    const seconds = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) + 5 : 45;
  }
  if (message.message_type === "text") {
    const words = ((message.content ?? "").trim().match(/\S+/g) ?? []).length;
    return Math.min(120, Math.max(8, Math.ceil(words / 3)));
  }
  return 15;
}

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

  const qualifyingSet = new Set((qualifying ?? []).map((l) => l.id));
  const candidateConvs = conversations.filter((c) => qualifyingSet.has(c.lead_id as string));
  if (candidateConvs.length === 0) return;

  // Última mensagem de cada conversa e última enviada ao lead (IA/consultor):
  // o limiar de esfriamento depende do tempo que o lead leva para consumir o
  // que recebeu — áudio dura o que dura, texto se lê em ~3 palavras/s.
  const { data: recentMessages } = await supabaseAdmin
    .from("messages")
    .select("conversation_id, sender_type, message_type, content, metadata, created_at")
    .in(
      "conversation_id",
      candidateConvs.map((c) => c.id),
    )
    .order("created_at", { ascending: false })
    .limit(400);

  const lastByConv = new Map<string, RecentMessage>();
  const lastAiByConv = new Map<string, RecentMessage>();
  for (const message of (recentMessages ?? []) as RecentMessage[]) {
    if (!lastByConv.has(message.conversation_id)) lastByConv.set(message.conversation_id, message);
    if (
      ["ai", "consultant"].includes(message.sender_type) &&
      !lastAiByConv.has(message.conversation_id)
    ) {
      lastAiByConv.set(message.conversation_id, message);
    }
  }

  const coldConvIds: string[] = [];
  const coldLeadIds: string[] = [];
  for (const conversation of candidateConvs) {
    const last = lastByConv.get(conversation.id);
    const lastAi = lastAiByConv.get(conversation.id);
    if (!last) continue;

    const idleMs = Date.now() - new Date(last.created_at).getTime();

    // A Ana ainda não respondeu à última mensagem do lead: ela está gerando a
    // resposta — só esfria se a IA demorar demais (falha silenciosa).
    if (!lastAi || new Date(lastAi.created_at) < new Date(last.created_at)) {
      if (idleMs > PENDING_REPLY_MS) {
        coldConvIds.push(conversation.id);
        coldLeadIds.push(conversation.lead_id as string);
      }
      continue;
    }

    // Lead consumindo (lendo/ouvindo): esfria só após o tempo estimado da
    // mensagem + respiro. Áudio de 1 min = ~75s; texto curto = ~18s.
    const thresholdMs = estimateConsumptionSeconds(lastAi) * 1_000 + COLD_AFTER_MS;
    if (idleMs > thresholdMs) {
      coldConvIds.push(conversation.id);
      coldLeadIds.push(conversation.lead_id as string);
    }
  }

  if (coldLeadIds.length === 0) return;

  await supabaseAdmin.from("leads").update({ status: "WAITING_HUMAN" }).in("id", coldLeadIds);
  await supabaseAdmin
    .from("conversations")
    .update({ status: "WAITING_HUMAN" })
    .in("id", coldConvIds);
}

function init(status = 200): ResponseInit {
  return { status, headers: { "content-type": "application/json", "cache-control": "no-store" } };
}
