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
// Contexto longo: o atendimento costuma passar de 14 mensagens (qualificação,
// transferência, retomada). Com pouco histórico a IA repetia perguntas já feitas.
const HISTORY_LIMIT = 60;

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
    `Você é ${settings.agentName}, atendente virtual de ${settings.companyName}, uma corretora especializada na venda de planos de saúde e odontológicos para empresas (planos empresariais/PME), famílias e pessoa física, além de planos coletivos por adesão.`,
    `CONTEXTO TEMPORAL: agora é ${dateTime} no horário de Brasília (São Paulo). A saudação correta neste momento é "${greeting}". Nunca use outra saudação de período do dia e nunca cite datas/horários diferentes deste.`,
    "Fale português do Brasil, em tom humano, acolhedor e objetivo. Responda com no máximo 240 caracteres e até 3 frases curtas, estilo WhatsApp, sem markdown pesado.",
    "ÁUDIO: você ouve e entende áudios do cliente (eles chegam transcritos, marcados como \"(áudio enviado pelo cliente)\"). Você responde em áudio APENAS quando o cliente falou por áudio; se ele escreveu, responda por escrito. Se ele disser que não consegue ouvir/abrir áudios, que prefere texto, ou se for outro robô/IA que só lê texto, responda sempre por escrito e de forma completa e clara, sem depender de voz. NUNCA diga que é uma inteligência artificial que não consegue ouvir ou enviar áudios.",
    "FORMATO DA RESPOSTA: escreva SOMENTE a fala natural, como uma pessoa falaria no WhatsApp. É proibido começar (ou incluir) qualquer rótulo, narração ou anotação como \"(resposta em áudio)\", \"[áudio]\", \"Áudio:\", asteriscos de ação ou descrição do que você está fazendo. Comece direto pela saudação ou pela resposta.",
    "Se a mensagem do cliente for confusa, vazia ou só um sinal como \"?\", peça gentilmente que ele repita ou explique melhor a dúvida — nunca invente que houve um problema técnico.",
    "Objetivo: qualificar o interessado (plano para pessoa física/família, empresa com CNPJ ou por adesão; quantas vidas; idades; cidade/estado; se já tem plano hoje; acomodação e preferência de operadora/hospital) e agendar a cotação com um consultor humano.",
    "- Depois de responder à dúvida ou concluir a qualificação, pergunte de forma natural se a pessoa ainda tem alguma dúvida ou se deseja falar com um consultor humano. Não repita essa pergunta em todas as mensagens.",
    "REGRAS ABSOLUTAS:",
    "- Nunca invente valores, prazos, carências, coberturas, rede credenciada, documentos ou condições comerciais.",
    "- Use apenas a BASE DE CONHECIMENTO abaixo. Se a resposta não estiver nela, ou se o lead pedir humano, reclamar, falar de pagamento/contrato/dados sensíveis, responda de forma breve e acrescente no FINAL da mensagem o marcador " +
      HANDOFF_TOKEN,
    "- Nunca feche valor final nem garanta aceitação da proposta: preço e aprovação dependem da operadora e da cotação feita pelo consultor.",
    "- Nunca peça senha, dados de cartão ou dados bancários.",

    settings.extraInstructions ? `Instruções da empresa: ${settings.extraInstructions}` : "",
    "",
    "BASE DE CONHECIMENTO:",
    base,
  ]
    .filter(Boolean)
    .join("\n");
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * Remove anotações de narração que o modelo às vezes coloca no início
 * (ex.: "(resposta em áudio)", "[áudio]", "Resposta em áudio:").
 * Elas soam robóticas quando lidas em voz alta.
 */
function stripNarration(value: string): string {
  let text = value.trim();
  const patterns = [
    /^\s*[([{][^)\]}]{0,60}[)\]}]\s*[:\-–]?\s*/i,
    /^\s*(resposta|mensagem|áudio|audio|transcri(ç|c)ão)\s+(em|de|por)\s+(á|a)udio\s*[:\-–]?\s*/i,
    /^\s*(á|a)udio\s*[:\-–]\s*/i,
    /^\s*\*[^*]{0,60}\*\s*/,
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of patterns) {
      const next = text.replace(pattern, "");
      if (next !== text) {
        text = next.trim();
        changed = true;
      }
    }
  }
  return text.trim();
}

/** Normaliza para comparação: sem acentos, minúsculo. */
function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const GENERIC_COMPANY_WORDS = new Set([
  "ltda",
  "me",
  "eireli",
  "sa",
  "s",
  "a",
  "de",
  "da",
  "do",
  "dos",
  "das",
  "e",
  "corretora",
  "seguros",
  "seguro",
  "assessoria",
  "consultoria",
  "planos",
  "plano",
  "saude",
  "empresa",
  "grupo",
]);

/**
 * Marcadores que identificam um consultor interno no nome do lead.
 * Ex.: empresa "APSP Corretora" -> "apsp"; empresa "Nexa Atende" -> "nexa", "atende", "na".
 */
function companyMarkers(...names: (string | null | undefined)[]): string[] {
  const markers = new Set<string>();
  for (const raw of names) {
    const name = (raw ?? "").trim();
    if (!name) continue;
    const words = normalizeText(name)
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 2 && !GENERIC_COMPANY_WORDS.has(w));
    for (const word of words) markers.add(word);
    if (words.length >= 2) markers.add(words.map((w) => w[0]).join(""));
  }
  return [...markers].filter((m) => m.length >= 2);
}

/** O administrador marca o consultor escrevendo o nome da empresa junto ao nome. */
function isConsultantLead(leadName: string | null | undefined, markers: string[]): boolean {
  const name = normalizeText((leadName ?? "").trim());
  if (!name) return false;
  const tokens = name.split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.length < 2) return false;
  return markers.some((marker) => tokens.includes(marker));
}

/** Nome de tratamento do consultor: remove o marcador da empresa ("Cacá APSP" -> "Cacá"). */
function consultantFirstName(registeredName: string, markers: string[]): string {
  const parts = registeredName.trim().split(/\s+/).filter((p) => !markers.includes(normalizeText(p)));
  return (parts[0] ?? registeredName.trim().split(/\s+/)[0] ?? "colega").trim();
}

function buildConsultantPrompt(
  settings: AiSettings,
  knowledge: { title: string; category: string; content: string }[],
  consultant: { registeredName: string; firstName: string; phone: string | null },
) {
  const base = knowledge.length
    ? knowledge.map((k) => `### ${k.title} (${k.category})\n${k.content}`).join("\n\n")
    : "(base de conhecimento vazia)";
  return [
    `Você é ${settings.agentName}, assistente INTERNA de ${settings.companyName}.`,
    "FICHA DO INTERLOCUTOR (consultada agora no banco de dados do CRM — é a verdade oficial):",
    `- Nome cadastrado: ${consultant.registeredName}`,
    `- Tratar por: ${consultant.firstName}`,
    `- Papel: CONSULTOR interno de ${settings.companyName} (não é cliente nem lead)`,
    consultant.phone ? `- Contato: ${consultant.phone}` : "",
    `IDENTIDADE: você SABE com quem está falando. Se ${consultant.firstName} perguntar "sabe quem eu sou?", responda com convicção usando a ficha acima (ex.: "Claro, ${consultant.firstName}! Você é consultor da ${settings.companyName}."). É PROIBIDO dizer que não consegue reconhecer usuários, que não tem acesso a dados ou que é apenas uma IA sem memória.`,
    `Trate-o como colega de equipe: cumprimente de forma direta e profissional (ex.: "Olá, ${consultant.firstName}! Em que posso ajudar?") e responda objetivamente às dúvidas dele.`,
    "Ele pode perguntar sobre produtos, operadoras, regras, processos internos, argumentos de venda, objeções e procedimentos. Use toda a base de conhecimento para ajudar, especialmente consultores novos.",
    "Nunca qualifique-o como lead, nunca pergunte quantas vidas ele quer contratar e nunca ofereça transferir para um consultor humano — ele já é um consultor.",
    "NUNCA use o marcador de transferência. Você mesma resolve a dúvida; se a informação não estiver na base, diga com clareza que não consta na base e oriente-o a confirmar com a coordenação.",
    "Responda em português do Brasil, direto ao ponto, estilo WhatsApp, podendo usar até 600 caracteres quando a dúvida exigir detalhe.",
    settings.extraInstructions ? `Instruções da empresa: ${settings.extraInstructions}` : "",
    "",
    "BASE DE CONHECIMENTO:",
    base,
  ]
    .filter(Boolean)
    .join("\n");
}

type GatewayResult =
  | { kind: "ok"; text: string }
  | { kind: "retryable" | "terminal"; message: string };


function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return 1_000 * 2 ** attempt + Math.floor(Math.random() * 500);
}

async function readStreamText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      for (const line of event.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const payload = JSON.parse(data) as {
            choices?: { delta?: { content?: string }; message?: { content?: string } }[];
          };
          text += payload.choices?.[0]?.delta?.content ?? payload.choices?.[0]?.message?.content ?? "";
        } catch {
          // Eventos auxiliares do stream não contêm texto e podem ser ignorados.
        }
      }
    }
    if (done) break;
  }
  return text.trim();
}

async function callGateway(messages: ChatMessage[]): Promise<GatewayResult> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) {
    console.error("[ia] LOVABLE_API_KEY ausente");
    return { kind: "terminal", message: "LOVABLE_API_KEY ausente" };
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(GATEWAY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Lovable-API-Key": apiKey,
          "X-Lovable-AIG-SDK": "fetch",
        },
        body: JSON.stringify({
          model: MODEL,
          messages,
          temperature: 0.3,
          // O modelo usa parte desse limite internamente para raciocínio. Com
          // 400 tokens ele podia encerrar em MAX_TOKENS antes de emitir texto.
          max_tokens: 1_200,
          stream: true,
        }),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        const message = detail || `Gateway respondeu ${response.status}`;
        console.error("[ia] gateway respondeu", response.status, message.slice(0, 500));
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
          continue;
        }
        return { kind: retryable ? "retryable" : "terminal", message };
      }

      const text = await readStreamText(response);
      if (text) return { kind: "ok", text };
      return { kind: "retryable", message: "Gateway concluiu sem texto de resposta" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[ia] falha ao chamar o gateway", message);
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay(new Response(), attempt)));
        continue;
      }
      return { kind: "retryable", message };
    }
  }

  return { kind: "retryable", message: "Falha temporária na geração" };
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
    .select("id, status, assigned_user_id, channel_id, lead_id, lead:leads(whatsapp, name, phone)")
    .eq("id", conversationId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!conversation) {
    log("skip: conversa inexistente");
    return { status: "skipped", reason: "conversa inexistente" };
  }

  // Pessoa interna: reconhecida pelo nome marcado com a empresa (ex.: "Cacá APSP")
  // OU pelo telefone cadastrado na equipe (perfis e números conectados da empresa).
  // Nesse caso a IA vira assistente interna: não qualifica, não transfere e nunca
  // manda a conversa para o rodízio da fila.
  const [{ data: company }, { data: staffProfiles }, { data: staffConnections }] = await Promise.all([
    supabaseAdmin.from("companies").select("name").eq("id", companyId).maybeSingle(),
    supabaseAdmin.from("profiles").select("full_name, phone").eq("company_id", companyId),
    supabaseAdmin.from("whatsapp_connections").select("phone_number").eq("company_id", companyId),
  ]);
  const markers = companyMarkers(company?.name, settings.companyName);
  const leadRegisteredName = ((conversation.lead as { name?: string | null } | null)?.name ?? "").trim();
  const leadWhatsapp = ((conversation.lead as { whatsapp?: string | null } | null)?.whatsapp ?? "").trim();
  const leadPhone = ((conversation.lead as { phone?: string | null } | null)?.phone ?? "").trim();
  const digits = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "");
  const leadDigits = [digits(leadPhone), leadWhatsapp.includes("@lid") ? "" : digits(leadWhatsapp)].filter(
    (d) => d.length >= 10,
  );
  const staffNumbers = new Set(
    [
      ...(staffProfiles ?? []).map((p) => digits(p.phone)),
      ...(staffConnections ?? []).map((c) => digits(c.phone_number)),
    ].filter((d) => d.length >= 10),
  );
  const matchedProfile = (staffProfiles ?? []).find((p) =>
    leadDigits.some((d) => digits(p.phone) && digits(p.phone) === d),
  );
  const isStaffPhone = leadDigits.some((d) => staffNumbers.has(d));
  const isConsultantChat = isConsultantLead(leadRegisteredName, markers) || isStaffPhone;
  const consultantName = consultantFirstName(
    leadRegisteredName || (matchedProfile?.full_name ?? ""),
    markers,
  );
  const consultantPhone = leadWhatsapp && !leadWhatsapp.includes("@lid") ? leadWhatsapp : leadPhone || null;
  if (isConsultantChat) log("modo consultor interno", leadRegisteredName, { porTelefone: isStaffPhone });

  // Conversa encerrada volta a atender o consultor interno (suporte contínuo);
  // pausada continua respeitando a pausa manual.
  const blockingStatus = isConsultantChat ? ["PAUSED"] : ["CLOSED", "PAUSED"];
  if (blockingStatus.includes(conversation.status)) {
    log("skip: status", conversation.status);
    return { status: "skipped", reason: `status ${conversation.status}` };
  }



  // Quando a conversa é devolvida para a IA (arrastar para "Em qualificação (IA)"
  // no Kanban ou rodízio esgotado), tudo que aconteceu antes desse momento
  // — respostas humanas e transferências anteriores — deixa de bloquear a IA.
  const { data: lastResume } = await supabaseAdmin
    .from("conversation_events")
    .select("created_at")
    .eq("conversation_id", conversationId)
    .eq("event_type", "AI_RESUMED")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const resumedAt = lastResume?.created_at ? new Date(lastResume.created_at).getTime() : 0;
  if (resumedAt) log("retomada da IA em", lastResume?.created_at);

  // Um humano só "assume" a conversa quando de fato responde. Enquanto isso
  // (inclusive em conversas antigas atribuídas mas sem resposta) a IA continua
  // atendendo, mantendo o contexto do histórico.
  const { data: possibleHumanReplies } = await supabaseAdmin
    .from("messages")
    .select("id, sender_id, sender_type, content, message_type, created_at, metadata")
    .eq("conversation_id", conversationId)
    .in("sender_type", ["consultant", "admin"]);
  const deviceReplies = (possibleHumanReplies ?? []).filter(
    (message) =>
      !message.sender_id &&
      message.sender_type === "consultant" &&
      (message.metadata as { origin?: string } | null)?.origin === "device",
  );
  const { data: aiReplies } = deviceReplies.length
    ? await supabaseAdmin
        .from("messages")
        .select("content, message_type, created_at")
        .eq("conversation_id", conversationId)
        .eq("sender_type", "ai")
    : { data: [] };
  // A "tomada" humana vale enquanto o atendimento está em andamento. Depois de
  // muitas horas sem qualquer resposta humana, uma nova mensagem do cliente
  // inicia um novo atendimento e a IA volta a responder.
  const HUMAN_TAKEOVER_TTL_MS = 12 * 60 * 60 * 1_000;
  const humanReplies = (possibleHumanReplies ?? []).filter((message) => {
    if (new Date(message.created_at).getTime() <= resumedAt) return false;
    if (message.sender_id || message.sender_type === "admin") return true;
    const fromDevice = (message.metadata as { origin?: string } | null)?.origin === "device";
    if (!fromDevice) return true;
    // Compatibilidade com respostas antigas: antes de corrigirmos a corrida,
    // o eco da IA podia chegar primeiro e ser gravado como consultor do aparelho.
    // Se existe a resposta da IA do mesmo formato no mesmo instante, é eco.
    return !(aiReplies ?? []).some((ai) => {
      const closeInTime = Math.abs(new Date(ai.created_at).getTime() - new Date(message.created_at).getTime()) <= 120_000;
      const samePayload =
        ai.message_type === message.message_type &&
        (message.message_type !== "text" || (ai.content ?? "").trim() === (message.content ?? "").trim());
      return closeInTime && samePayload;
    });
  });
  const lastHumanReplyAt = humanReplies.reduce(
    (latest, message) => Math.max(latest, new Date(message.created_at).getTime()),
    0,
  );
  if (!isConsultantChat && lastHumanReplyAt && Date.now() - lastHumanReplyAt < HUMAN_TAKEOVER_TTL_MS) {
    log("skip: consultor já respondeu nesta conversa");
    return { status: "skipped", reason: "conversa com consultor" };
  }


  const { count: pendingOffers } = await supabaseAdmin
    .from("assignment_attempts")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("status", "WAITING");
  if (!isConsultantChat && (pendingOffers ?? 0) > 0) {
    log("skip: oferta de fila aguardando consultor");
    return { status: "skipped", reason: "conversa com consultor" };
  }


  const { data: history } = await supabaseAdmin
    .from("messages")
    .select("sender_type, sender_name, content, message_type, transcription, created_at")
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
  const { data: completedHandoffs } = await supabaseAdmin
    .from("ai_sessions")
    .select("handoff_reason, ended_at, created_at")
    .eq("conversation_id", conversationId)
    .eq("status", "HANDOFF");
  const hasIntentionalHandoff = (completedHandoffs ?? []).some((session) => {
    const at = new Date(session.ended_at ?? session.created_at).getTime();
    if (at <= resumedAt) return false;
    const reason = session.handoff_reason?.toLowerCase() ?? "";
    return !reason.includes("falha na geração") && !reason.includes("falha permanente da ia");
  });
  if (!isConsultantChat && hasIntentionalHandoff) {
    log("skip: transferência humana já solicitada");
    return { status: "skipped", reason: "conversa com consultor" };
  }

  const customerText = ((lastCustomer.transcription || lastCustomer.content) ?? "").trim();

  // A modalidade da resposta espelha a do cliente: só respondemos em voz quando
  // ele mandou áudio e nada indica que do outro lado não é possível ouvir
  // (pessoa sem fone, ambiente, ou outro robô/IA que só lê texto).
  const AUDIO_TYPES = ["audio", "ptt", "voice"];
  const lastCustomerIsAudio = AUDIO_TYPES.includes(String(lastCustomer.message_type ?? "").toLowerCase());
  // A retomada manual inicia um novo ciclo de atendimento. Textos antigos que
  // pareciam vir de outro robô não podem bloquear novamente esta nova conversa.
  const customerTexts = ordered
    .filter(
      (m) =>
        m.sender_type === "customer" &&
        (!resumedAt || new Date(m.created_at).getTime() > resumedAt),
    )
    .map((m) => ((m.transcription || m.content) ?? "").toLowerCase());
  // Preferência de modalidade vale para a mensagem atual. Uma frase antiga
  // pedindo texto não deve impedir para sempre respostas aos novos áudios.
  const textOnlyRequest = [customerText.toLowerCase()].some((t) =>
    /(n(ã|a)o\s+(consigo|posso|d(á|a)|dá pra|posso)?\s*(ouvir|escutar|abrir|ouvir\s+áudio))|(n(ã|a)o\s+entendo\s+(á|a)udio)|(n(ã|a)o\s+(recebo|leio|processo)\s+(á|a)udio)|((manda|envie|escreva|prefiro|pode ser|responda|fale)\s+(por\s+)?(escrito|texto|mensagem escrita))|(sem\s+(á|a)udio)|(odeio\s+(á|a)udio)|(sou\s+(uma\s+)?(ia|intelig(ê|e)ncia artificial|assistente virtual|rob(ô|o)))|(n(ã|a)o\s+consigo\s+(processar|interpretar)\s+(á|a)udio)/i.test(
      t,
    ),
  );
  const preferAudio = lastCustomerIsAudio && !textOnlyRequest;

  const explicitHumanRequest =
    !isConsultantChat &&
    /\b(consultor(?:a)?|atendente|atendimento humano|pessoa|humano)\b/i.test(customerText) &&
    /\b(falar|transferir|transfere|transferência|passar|chamar|quero|gostaria|pode|preciso)\b/i.test(
      customerText,
    );

  // Anti-loop: outro robô/IA do outro lado responderia para sempre. Paramos
  // assim que o interlocutor se identifica como automático, ou quando a troca
  // fica longa demais para um atendimento humano real.
  const counterpartIsBot = customerTexts.some((t) =>
    /(sou\s+(uma\s+)?(ia|intelig(ê|e)ncia\s+artificial|assistente\s+virtual|bot|rob(ô|o)|chatbot|assistente\s+automátic))|(atendente\s+virtual)|(mensagem\s+autom(á|a)tica)|(resposta\s+autom(á|a)tica)|(sistema\s+autom(a|á)tico)|(este\s+(número|canal)\s+n(ã|a)o\s+recebe)|(as\s+an\s+ai|i am an ai|as an ai language model)/i.test(
      t,
    ),
  );
  // Trocas muito rápidas e ininterruptas indicam robô do outro lado: um humano
  // não mantém dezenas de idas e vindas em segundos.
  let aiReplyCountQuery = supabaseAdmin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("sender_type", "ai");
  if (lastResume?.created_at) {
    aiReplyCountQuery = aiReplyCountQuery.gt("created_at", lastResume.created_at);
  }
  const { count: totalAiReplies } = await aiReplyCountQuery;
  const LOOP_LIMIT = 25;
  if (counterpartIsBot || (totalAiReplies ?? 0) >= LOOP_LIMIT) {

    const reason = counterpartIsBot
      ? "interlocutor automatizado (outra IA/robô)"
      : "limite de mensagens automáticas atingido";
    log("skip: parando respostas automáticas —", reason);
    await supabaseAdmin
      .from("ai_sessions")
      .update({ status: "HANDOFF", ended_at: new Date().toISOString(), handoff_reason: reason })
      .eq("conversation_id", conversationId)
      .eq("status", "ACTIVE");
    await supabaseAdmin
      .from("conversations")
      .update({ status: "WAITING_HUMAN" })
      .eq("id", conversationId)
      .eq("company_id", companyId);
    return { status: "skipped", reason };
  }


  // Áudio/imagem/documento sem texto: a IA não interpreta, vai direto para humano.
  const unreadableMedia =
    lastCustomer.message_type !== "text" && !lastCustomer.content && !lastCustomer.transcription;
  if (unreadableMedia) {
    if (isConsultantChat) {
      log("skip: consultor enviou mídia sem texto");
      // Reason padronizada: impede que a ingestão coloque a conversa no rodízio.
      return { status: "skipped", reason: "conversa com consultor" };
    }
    await handoff(companyId, conversationId, "mídia recebida sem texto");
    return { status: "handoff", reason: "mídia" };
  }

  const knowledge = await loadKnowledge(companyId);

  // Nome: o cadastrado no CRM (pelo administrador) tem prioridade; o nome do
  // WhatsApp serve para conferência quando divergir (número pode ter trocado de dono).
  const crmName = ((conversation.lead as { name?: string | null } | null)?.name ?? "").trim();
  const whatsappName = (lastCustomer.sender_name ?? "").trim();
  const sameName =
    crmName && whatsappName && crmName.toLowerCase() === whatsappName.toLowerCase();
  const nameContext = crmName
    ? sameName || !whatsappName
      ? `CONTATO: o lead se chama ${crmName}. Cumprimente-o pelo nome de forma natural (ex.: "Olá, ${crmName}!") sem repetir o nome em todas as mensagens.`
      : `CONTATO: no cadastro este contato é ${crmName}, mas o WhatsApp mostra o nome "${whatsappName}". Antes de continuar, confirme gentilmente: pergunte se deve chamá-lo de ${crmName} ou de ${whatsappName}, explicando que no cadastro consta ${crmName}. Depois use o nome confirmado.`
    : whatsappName
      ? `CONTATO: o WhatsApp mostra o nome "${whatsappName}", mas ele não está confirmado. Pode usá-lo com naturalidade e, se fizer sentido, confirme o nome correto uma única vez.`
      : "CONTATO: ainda não sabemos o nome do lead. Pergunte o nome dele logo no início do atendimento, uma única vez.";

  // Fatos já confirmados pelo lead (cidade, idades, plano atual, etc.).
  // Evita que a IA volte a perguntar algo que já foi respondido antes.

  const leadIdForMemory = (conversation as { lead_id?: string | null }).lead_id ?? input.leadId ?? null;
  const { data: leadFacts } = leadIdForMemory
    ? await supabaseAdmin
        .from("lead_memory")
        .select("key, value")
        .eq("lead_id", leadIdForMemory)
        .limit(40)
    : { data: [] };
  const factsContext = (leadFacts ?? [])
    .filter((f) => (f.value ?? "").trim())
    .map((f) => `- ${f.key}: ${f.value}`)
    .join("\n");

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: isConsultantChat
        ? buildConsultantPrompt(settings, knowledge, {
            registeredName: leadRegisteredName || matchedProfile?.full_name || consultantName,
            firstName: consultantName,
            phone: consultantPhone,
          })
        : buildSystemPrompt(settings, knowledge),
    },
    ...(isConsultantChat ? [] : [{ role: "system" as const, content: nameContext }]),
    {
      role: "system" as const,
      content: [
        "CONTINUIDADE DO ATENDIMENTO: o histórico abaixo é a MESMA conversa, mesmo que tenha havido transferência ou pausa.",
        "Nunca volte a perguntar algo que o cliente já respondeu (cidade, estado, idades, número de vidas, plano atual, tipo de plano, operadora preferida). Se já souber, apenas confirme rapidamente e siga em frente.",
        "Se o cliente mudar de assunto (ex.: passar de plano de saúde para odontológico), reaproveite os dados já informados em vez de recomeçar a qualificação.",
        factsContext ? `FATOS JÁ REGISTRADOS SOBRE ESTE CLIENTE:\n${factsContext}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    },
    ...ordered
      .filter((m) => ((m.transcription || m.content) ?? "").trim())
      .map<ChatMessage>((m) => {
        const body = ((m.transcription || m.content) ?? "").trim();
        const isAudio = ["audio", "ptt", "voice"].includes(String(m.message_type ?? "").toLowerCase());
        return {
          role: m.sender_type === "customer" ? "user" : "assistant",
          content:
            isAudio && m.sender_type === "customer" ? `(áudio enviado pelo cliente) ${body}` : body,
        };
      }),
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
  const generation: GatewayResult = explicitHumanRequest
    ? { kind: "ok", text: `Claro! Vou transferir você agora para um consultor humano. ${HANDOFF_TOKEN}` }
    : await callGateway(messages);
  if (generation.kind !== "ok") {
    log("geração não concluída", { tipo: generation.kind, erro: generation.message.slice(0, 300) });
    if (generation.kind === "terminal" && !isConsultantChat) {
      await handoff(companyId, conversationId, `falha permanente da IA: ${generation.message.slice(0, 300)}`);
      return { status: "handoff", reason: "gateway" };
    }
    // Uma indisponibilidade transitória jamais encerra a sessão: a próxima
    // mensagem do cliente deve poder acionar a IA normalmente.
    return { status: "skipped", reason: "falha temporária da IA" };
  }
  const raw = generation.text;

  const needsHuman = !isConsultantChat && (explicitHumanRequest || raw.includes(HANDOFF_TOKEN));
  const text = stripNarration(raw.replaceAll(HANDOFF_TOKEN, ""));

  if (text) {
    const destination =
      (conversation.lead as { whatsapp: string | null } | null)?.whatsapp ?? conversation.channel_id;
    const recipient = WhatsAppIdentifierService.toRecipient(destination);
    const creds = recipient ? await loadMegaCredentials(connectionId) : null;

    log("enviando resposta", { destino: recipient, temCredenciais: Boolean(creds) });
    if (recipient && creds) {
      // Espelhamos a modalidade do cliente: voz só quando ele falou por áudio e
      // não sinalizou que não consegue ouvir. Caso contrário, resposta escrita.
      const voice = preferAudio
        ? await synthesizeReplyAudio({ companyId, connectionId, text })
        : null;
      const voiceUrl = voice ? await signedMediaUrl(voice.path) : null;
      const asAudio = Boolean(voice && voiceUrl);
      if (preferAudio && !asAudio) log("cliente falou por áudio, mas a voz não ficou pronta; enviando texto");



      // Reservamos a mensagem ANTES do envio. A MEGA pode disparar o eco do
      // WhatsApp ainda durante a chamada de envio; sem esta reserva, esse eco
      // era gravado como resposta de consultor e bloqueava a IA para sempre.
      const { data: messageId, error: createMessageError } = await supabaseAdmin.rpc("create_outbound_message", {
        _conversation_id: conversationId,
        _company_id: companyId,
        _sender_id: null as unknown as string,
        _sender_type: "ai",
        _sender_name: "IA",
        _content: text,
        _message_type: asAudio ? "audio" : "text",
        ...(voice ? { _media_url: voice.path } : {}),
        _connection_id: connectionId,
      });

      if (createMessageError) {
        log("falha ao reservar resposta antes do envio", createMessageError.message);
      }

      log("voz pronta; iniciando entrega no WhatsApp", { formato: asAudio ? "audio" : "text" });
      let sent = voice && voiceUrl
        ? await MegaApiService.sendMedia(creds, {
            to: recipient,
            url: voiceUrl,
            mediaType: "audio",
            mimeType: voice.mimeType,
            fileName: `resposta-${Date.now()}.mp3`,
          })
        : await MegaApiService.sendText(creds, recipient, text);

      // O lead nunca pode ficar sem resposta por causa do áudio.
      if (asAudio && !sent.ok) {
        log("áudio recusado pelo WhatsApp; enviando texto", sent.error);
        sent = await MegaApiService.sendText(creds, recipient, text);
        if (messageId) {
          await supabaseAdmin
            .from("messages")
            .update({ message_type: "text", media_url: null })
            .eq("id", messageId);
        }
      }

      log("entrega concluída", { ok: sent.ok, formato: asAudio ? "audio" : "text" });

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

  // O Kanban precisa refletir a realidade: quem está atendendo agora é a IA.
  const leadId = input.leadId ?? (conversation as { lead_id?: string | null }).lead_id ?? null;
  if (leadId) {
    await supabaseAdmin
      .from("leads")
      .update({ status: "AI_QUALIFYING" })
      .eq("id", leadId)
      .eq("company_id", companyId)
      .in("status", ["NEW", "WAITING_HUMAN", "WAITING_CUSTOMER", "IN_SERVICE"]);
  }

  log("respondido com sucesso");
  return { status: "replied" };
}
