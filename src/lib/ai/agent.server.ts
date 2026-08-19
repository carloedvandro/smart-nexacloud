/**
 * Agente de IA do NexaAtende.
 * Responde leads no WhatsApp usando SOMENTE a base de conhecimento da empresa
 * e transfere para atendimento humano quando não houver informação confiável.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadMegaCredentials } from "@/lib/whatsapp/credentials.server";
import { MegaApiService } from "@/lib/whatsapp/mega.server";
import { WhatsAppIdentifierService } from "@/lib/whatsapp/jid";
import { signedMediaUrl } from "@/lib/whatsapp/media.server";
import { synthesizeReplyAudio } from "@/lib/ai/tts.server";

const MODEL = "google/gemini-2.5-flash";
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const HANDOFF_TOKEN = "[TRANSFERIR_HUMANO]";
const HISTORY_LIMIT = 14;

export type AiSettings = {
  enabled: boolean;
  agentName: string;
  companyName: string;
  extraInstructions: string;
};

const DEFAULT_SETTINGS: AiSettings = {
  enabled: false,
  agentName: "Assistente",
  companyName: "nossa assessoria",
  extraInstructions: "",
};

export async function loadAiSettings(companyId: string): Promise<AiSettings> {
  const { data } = await supabaseAdmin
    .from("system_settings")
    .select("value")
    .eq("company_id", companyId)
    .eq("key", "ai")
    .maybeSingle();

  const value = (data?.value ?? {}) as Partial<AiSettings>;
  return {
    enabled: Boolean(value.enabled),
    agentName: value.agentName?.trim() || DEFAULT_SETTINGS.agentName,
    companyName: value.companyName?.trim() || DEFAULT_SETTINGS.companyName,
    extraInstructions: value.extraInstructions?.trim() || "",
  };
}

async function loadKnowledge(companyId: string) {
  const { data } = await supabaseAdmin
    .from("knowledge_base")
    .select("title, category, content")
    .eq("company_id", companyId)
    .eq("status", "ACTIVE")
    .order("category", { ascending: true })
    .limit(60);
  return data ?? [];
}

const SAO_PAULO_TZ = "America/Sao_Paulo";

function buildSystemPrompt(settings: AiSettings, knowledge: { title: string; category: string; content: string }[]) {
  const base = knowledge.length
    ? knowledge.map((k) => `### ${k.title} (${k.category})\n${k.content}`).join("\n\n")
    : "(base de conhecimento vazia)";

  // Horário oficial do atendimento: São Paulo (America/Sao_Paulo).
  const now = new Date();
  const dateTime = now.toLocaleString("pt-BR", {
    timeZone: SAO_PAULO_TZ,
    dateStyle: "full",
    timeStyle: "short",
  });
  const hour = Number(
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: SAO_PAULO_TZ,
      hour: "2-digit",
      hour12: false,
    }).format(now),
  );
  const greeting = hour < 12 ? "bom dia" : hour < 18 ? "boa tarde" : "boa noite";

  return [
    `Você é ${settings.agentName}, atendente virtual de ${settings.companyName}, uma assessoria que ajuda pessoas a conseguirem o salário-maternidade (auxílio-maternidade).`,
    `CONTEXTO TEMPORAL: agora é ${dateTime} no horário de Brasília (São Paulo). A saudação correta neste momento é "${greeting}". Nunca use outra saudação de período do dia e nunca cite datas/horários diferentes deste.`,
    "Fale português do Brasil, em tom humano, acolhedor e objetivo. Mensagens curtas (até 3 frases ou uma lista curta), estilo WhatsApp, sem markdown pesado.",
    "Objetivo: entender a situação da pessoa (se é MEI, autônoma, rural, desempregada, CLT, se o parto/adoção já aconteceu e quando), explicar o benefício e agendar o atendimento com um consultor humano.",
    "- Depois de responder à dúvida ou concluir a qualificação, pergunte de forma natural se a pessoa ainda tem alguma dúvida ou se deseja falar com um atendente humano. Não repita essa pergunta em todas as mensagens.",
    "REGRAS ABSOLUTAS:",
    "- Nunca invente valores, prazos, regras, documentos ou promessas de aprovação.",
    "- Use apenas a BASE DE CONHECIMENTO abaixo. Se a resposta não estiver nela, ou se o lead pedir humano, reclamar, falar de pagamento/contrato/dados sensíveis, responda de forma breve e acrescente no FINAL da mensagem o marcador " +
      HANDOFF_TOKEN,
    "- Nunca garanta que o benefício será concedido; quem decide é o INSS.",
    "- Nunca peça senha do gov.br, cartão ou dados bancários.",
    settings.extraInstructions ? `Instruções da empresa: ${settings.extraInstructions}` : "",
    "",
    "BASE DE CONHECIMENTO:",
    base,
  ]
    .filter(Boolean)
    .join("\n");
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

async function callGateway(messages: ChatMessage[]): Promise<string | null> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) {
    console.error("[ia] LOVABLE_API_KEY ausente");
    return null;
  }

  try {
    const response = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: MODEL, messages, temperature: 0.3, max_tokens: 400 }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      console.error("[ia] gateway respondeu", response.status, await response.text());
      return null;
    }
    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return payload.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (error) {
    console.error("[ia] falha ao chamar o gateway", error);
    return null;
  }
}

async function handoff(companyId: string, conversationId: string, reason: string): Promise<boolean> {
  const { error: sessionError } = await supabaseAdmin
    .from("ai_sessions")
    .update({ status: "HANDOFF", ended_at: new Date().toISOString(), handoff_reason: reason })
    .eq("conversation_id", conversationId)
    .eq("status", "ACTIVE");
  if (sessionError) console.error("[ia] falha ao encerrar sessão na transferência", sessionError.message);

  // Entra na fila: o motor escolhe o consultor e inicia a contagem do SLA.
  const { error } = await supabaseAdmin.rpc("enqueue_conversation", {
    _conversation_id: conversationId,
    _reason: reason,
  });
  if (error) {
    console.error("[fila] falha ao enfileirar", error.message);
    await supabaseAdmin
      .from("conversations")
      .update({ status: "WAITING_HUMAN" })
      .eq("id", conversationId)
      .eq("company_id", companyId);
    return false;
  }

  // A notificação não depende do próximo webhook ou do relógio da fila.
  const { notifyQueueOffers } = await import("@/lib/queue/bridge.server");
  await notifyQueueOffers(companyId);
  return true;
}

/**
 * Gera e envia a resposta da IA para uma mensagem recebida.
 * Nunca lança: qualquer falha resulta em transferência para humano.
 */
export async function respondWithAI(input: {
  companyId: string;
  conversationId: string;
  leadId: string | null;
  connectionId: string;
}): Promise<{ status: "skipped" | "replied" | "handoff"; reason?: string }> {
  const { companyId, conversationId, connectionId } = input;

  const log = (...args: unknown[]) => console.info("[ia]", conversationId, ...args);

  const settings = await loadAiSettings(companyId);
  if (!settings.enabled) {
    log("skip: ia desativada");
    return { status: "skipped", reason: "ia desativada" };
  }

  const { data: conversation } = await supabaseAdmin
    .from("conversations")
    .select("id, status, assigned_user_id, channel_id, lead:leads(whatsapp)")
    .eq("id", conversationId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!conversation) {
    log("skip: conversa inexistente");
    return { status: "skipped", reason: "conversa inexistente" };
  }
  if (["CLOSED", "PAUSED"].includes(conversation.status)) {
    log("skip: status", conversation.status);
    return { status: "skipped", reason: `status ${conversation.status}` };
  }

  // Um humano só "assume" a conversa quando de fato responde. Enquanto isso
  // (inclusive em conversas antigas atribuídas mas sem resposta) a IA continua
  // atendendo, mantendo o contexto do histórico.
  const { count: humanReplies } = await supabaseAdmin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .in("sender_type", ["consultant", "admin"]);
  if ((humanReplies ?? 0) > 0) {
    log("skip: consultor já respondeu nesta conversa");
    return { status: "skipped", reason: "conversa com consultor" };
  }

  const { count: pendingOffers } = await supabaseAdmin
    .from("assignment_attempts")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("status", "WAITING");
  if ((pendingOffers ?? 0) > 0) {
    log("skip: oferta de fila aguardando consultor");
    return { status: "skipped", reason: "conversa com consultor" };
  }


  const { data: history } = await supabaseAdmin
    .from("messages")
    .select("sender_type, content, message_type, transcription")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  const ordered = (history ?? []).slice().reverse();
  const lastCustomer = ordered.filter((m) => m.sender_type === "customer").at(-1);
  if (!lastCustomer) {
    log("skip: sem mensagem do lead");
    return { status: "skipped", reason: "sem mensagem do lead" };
  }

  // Depois que a IA já transferiu esta conversa, novas mensagens do cliente
  // aguardam o humano. Isso evita que a IA retome o atendimento quando não há
  // consultor elegível no momento e a conversa permanece na fila.
  const { count: completedHandoffs } = await supabaseAdmin
    .from("ai_sessions")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("status", "HANDOFF");
  if ((completedHandoffs ?? 0) > 0) {
    log("skip: transferência humana já solicitada");
    return { status: "skipped", reason: "conversa com consultor" };
  }

  const customerText = ((lastCustomer.transcription || lastCustomer.content) ?? "").trim();
  const explicitHumanRequest =
    /\b(consultor(?:a)?|atendente|atendimento humano|pessoa|humano)\b/i.test(customerText) &&
    /\b(falar|transferir|transfere|transferência|passar|chamar|quero|gostaria|pode|preciso)\b/i.test(
      customerText,
    );

  // Áudio/imagem/documento sem texto: a IA não interpreta, vai direto para humano.
  const unreadableMedia =
    lastCustomer.message_type !== "text" && !lastCustomer.content && !lastCustomer.transcription;
  if (unreadableMedia) {
    await handoff(companyId, conversationId, "mídia recebida sem texto");
    return { status: "handoff", reason: "mídia" };
  }

  const knowledge = await loadKnowledge(companyId);
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(settings, knowledge) },
    ...ordered
      .filter((m) => (m.content ?? m.transcription ?? "").trim())
      .map<ChatMessage>((m) => ({
        role: m.sender_type === "customer" ? "user" : "assistant",
        content: (m.content ?? m.transcription ?? "").trim(),
      })),
  ];

  const { data: openSession } = await supabaseAdmin
    .from("ai_sessions")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("status", "ACTIVE")
    .maybeSingle();

  if (!openSession) {
    await supabaseAdmin.from("ai_sessions").insert({
      company_id: companyId,
      conversation_id: conversationId,
      ...(input.leadId ? { lead_id: input.leadId } : {}),
      model: MODEL,
      status: "ACTIVE",
    });
  }


  log("chamando o modelo", { mensagens: messages.length, conhecimento: knowledge.length });
  // Pedido inequívoco de humano não fica sujeito à interpretação do modelo.
  const raw = explicitHumanRequest
    ? `Claro! Vou transferir você agora para um consultor humano. ${HANDOFF_TOKEN}`
    : await callGateway(messages);
  if (!raw) {
    await handoff(companyId, conversationId, "falha na geração da resposta");
    return { status: "handoff", reason: "gateway" };
  }

  const needsHuman = explicitHumanRequest || raw.includes(HANDOFF_TOKEN);
  const text = raw.replaceAll(HANDOFF_TOKEN, "").trim();

  if (text) {
    const destination =
      (conversation.lead as { whatsapp: string | null } | null)?.whatsapp ?? conversation.channel_id;
    const recipient = WhatsAppIdentifierService.toRecipient(destination);
    const creds = recipient ? await loadMegaCredentials(connectionId) : null;

    log("enviando resposta", { destino: recipient, temCredenciais: Boolean(creds) });
    if (recipient && creds) {
      // Cliente mandou áudio? A IA responde por voz (feminina, sotaque paulista).
      const wantsVoice = ["audio", "ptt", "voice"].includes(
        String(lastCustomer.message_type ?? "").toLowerCase(),
      );
      const voice = wantsVoice
        ? await synthesizeReplyAudio({ companyId, connectionId, text })
        : null;
      const voiceUrl = voice ? await signedMediaUrl(voice.path) : null;
      const useVoice = Boolean(voice && voiceUrl);

      const { data: messageId } = await supabaseAdmin.rpc("create_outbound_message", {
        _conversation_id: conversationId,
        _company_id: companyId,
        _sender_id: null as unknown as string,
        _sender_type: "ai",
        _sender_name: "IA",
        _content: text,
        _message_type: useVoice ? "audio" : "text",
        ...(useVoice ? { _media_url: voice!.path } : {}),
        _connection_id: connectionId,
      });

      const sent = useVoice
        ? await MegaApiService.sendMedia(creds, {
            to: recipient,
            url: voiceUrl!,
            mediaType: "audio",
            mimeType: voice!.mimeType,
            fileName: `resposta-${Date.now()}.mp3`,
          })
        : await MegaApiService.sendText(creds, recipient, text);

      if (messageId) {
        await supabaseAdmin.rpc("finalize_outbound_message", {
          _message_id: messageId,
          _external_message_id: (sent.ok
            ? (sent.data?.key?.id ?? sent.data?.messageId ?? null)
            : null) as unknown as string,
          _status: sent.ok ? "SENT" : "FAILED",
          ...(sent.ok ? {} : { _reason: sent.error }),
        });
      }
      if (!sent.ok) {
        log("falha no envio", sent.error);
        await handoff(companyId, conversationId, `falha no envio: ${sent.error}`);
        return { status: "handoff", reason: "envio" };
      }
    } else {
      await handoff(companyId, conversationId, "instância sem credenciais ou destino inválido");
      return { status: "handoff", reason: "instância" };
    }
  }

  if (needsHuman) {
    await handoff(companyId, conversationId, "IA solicitou atendimento humano");
    return { status: "handoff", reason: "regra da IA" };
  }

  await supabaseAdmin
    .from("conversations")
    .update({ status: "AI_ACTIVE", assigned_user_id: null })
    .eq("id", conversationId)
    .eq("company_id", companyId);

  log("respondido com sucesso");
  return { status: "replied" };
}
