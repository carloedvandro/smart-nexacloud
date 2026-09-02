import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { ConversationStatus, LeadStatus } from "@/lib/nexa/domain";
import { assignConversationWithNotice, assignLeadWithService } from "@/lib/queue/assign.functions";
import { sendWhatsAppMessage } from "@/lib/whatsapp/whatsapp.functions";

type Tables = Database["public"]["Tables"];
export type LeadRow = Tables["leads"]["Row"];
export type ConversationRow = Tables["conversations"]["Row"];
export type MessageRow = Tables["messages"]["Row"];
export type LeadMemoryRow = Tables["lead_memory"]["Row"];
export type LeadNoteRow = Tables["lead_notes"]["Row"];
export type LeadSource = Database["public"]["Enums"]["lead_source"];
export type SenderType = Database["public"]["Enums"]["sender_type"];

export type ConversationListItem = ConversationRow & {
  lead: Pick<LeadRow, "id" | "name" | "phone" | "whatsapp" | "status" | "source"> | null;
  consultant: { id: string; full_name: string | null; email: string | null } | null;
};

function assertOk<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

/* ---------------------------------- Leads --------------------------------- */

export async function listLeads(params: {
  companyId: string;
  search?: string;
  status?: LeadStatus | "ALL";
  source?: string;
  assignedTo?: string;
  page?: number;
  pageSize: number;
}) {
  const page = params.page ?? 0;
  let query = supabase
    .from("leads")
    .select("*", { count: "exact" })
    .eq("company_id", params.companyId)
    .order("last_interaction_at", { ascending: false, nullsFirst: false })
    .range(page * params.pageSize, page * params.pageSize + params.pageSize - 1);

  if (params.status && params.status !== "ALL") query = query.eq("status", params.status);
  if (params.source && params.source !== "ALL") query = query.eq("source", params.source as LeadSource);
  if (params.assignedTo && params.assignedTo !== "ALL") {
    query = params.assignedTo === "NONE"
      ? query.is("assigned_user_id", null)
      : query.eq("assigned_user_id", params.assignedTo);
  }
  if (params.search?.trim()) {
    const raw = params.search.trim();
    const term = `%${raw}%`;
    const digits = raw.replace(/\D/g, "");
    // "Número oculto pelo WhatsApp" é um rótulo de exibição (LID).
    // Buscar por essas palavras deve trazer SOMENTE os leads sem número real.
    const normalized = raw
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    const hiddenWords = ["oculto", "ocultos", "oculta", "ocultas", "lid", "sem numero", "numero oculto"];
    const isHiddenSearch = normalized.length >= 4 && hiddenWords.some((w) => w.startsWith(normalized) || normalized.includes(w));

    if (isHiddenSearch) {
      query = query.or("whatsapp.ilike.%@lid%,phone.ilike.%@lid%");
    } else {
      const filters = [`name.ilike.${term}`, `email.ilike.${term}`];
      if (digits) {
        // busca por parte do número (com ou sem formatação salva no banco)
        const loose = `%${digits.split("").join("%")}%`;
        filters.push(
          `whatsapp.ilike.%${digits}%`,
          `phone.ilike.%${digits}%`,
          `whatsapp.ilike.${loose}`,
          `phone.ilike.${loose}`,
        );
      } else {
        filters.push(`city.ilike.${term}`);
      }
      query = query.or(filters.join(","));
    }
  }


  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as LeadRow[], total: count ?? 0 };
}

export async function getLead(leadId: string) {
  return assertOk(await supabase.from("leads").select("*").eq("id", leadId).maybeSingle());
}

export async function upsertLead(input: {
  name?: string;
  phone?: string;
  email?: string;
  city?: string;
  state?: string;
  source?: LeadSource;
  assignedUserId?: string | null;
}) {
  const args: Record<string, unknown> = { _source: input.source ?? "outro" };
  if (input.name) args["_name"] = input.name;
  if (input.phone) args["_phone"] = input.phone;
  if (input.email) args["_email"] = input.email;
  if (input.city) args["_city"] = input.city;
  if (input.state) args["_state"] = input.state;
  if (input.assignedUserId) args["_assigned_user_id"] = input.assignedUserId;

  const { data, error } = await supabase.rpc(
    "upsert_lead",
    args as unknown as { _source: LeadSource },
  );
  if (error) throw new Error(error.message);
  return data as string;
}

/** Nome cadastrado manualmente pelo administrador/consultor (usado também pela IA). */
export async function setLeadName(leadId: string, name: string) {
  const trimmed = name.trim();
  const { error } = await supabase
    .from("leads")
    .update({ name: trimmed || null })
    .eq("id", leadId);
  if (error) throw new Error(error.message);
}

export async function setLeadStatus(leadId: string, status: LeadStatus) {
  const { error } = await supabase.rpc("set_lead_status", { _lead_id: leadId, _status: status });
  if (error) throw new Error(error.message);
}

/** Muda a etapa do lead e sincroniza a situação da conversa aberta. */
export async function setLeadStage(leadId: string, status: LeadStatus) {
  const { error } = await supabase.rpc("set_lead_stage", { _lead_id: leadId, _status: status });
  if (error) throw new Error(error.message);
}

export async function assignLead(leadId: string, consultantId: string | null) {
  const { error } = await supabase.rpc("assign_lead", {
    _lead_id: leadId,
    _consultant_id: consultantId as string,
  });
  if (error) throw new Error(error.message);
}

/**
 * Atribui o lead e já coloca o atendimento em andamento (lead + conversa +
 * aviso no WhatsApp pessoal do consultor).
 */
export async function assignLeadAndService(leadId: string, consultantId: string | null) {
  return assignLeadWithService({ data: { leadId, consultantId } });
}


/* ------------------------------ Memória e notas ----------------------------- */

export async function listLeadMemory(leadId: string) {
  return (assertOk(
    await supabase.from("lead_memory").select("*").eq("lead_id", leadId).order("key"),
  ) ?? []) as LeadMemoryRow[];
}

export async function upsertLeadMemory(input: {
  leadId: string;
  key: string;
  value: string;
  source?: SenderType;
}) {
  const { error } = await supabase.rpc("upsert_lead_memory", {
    _lead_id: input.leadId,
    _key: input.key,
    _value: input.value,
    _source: input.source ?? "consultant",
  });
  if (error) throw new Error(error.message);
}

export async function listLeadNotes(leadId: string) {
  return (assertOk(
    await supabase
      .from("lead_notes")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false }),
  ) ?? []) as LeadNoteRow[];
}

export async function addLeadNote(input: { companyId: string; leadId: string; content: string }) {
  const { data: user } = await supabase.auth.getUser();
  const { error } = await supabase.from("lead_notes").insert({
    company_id: input.companyId,
    lead_id: input.leadId,
    author_id: user.user?.id ?? null,
    content: input.content,
  });
  if (error) throw new Error(error.message);
}

/* -------------------------------- Conversas -------------------------------- */

const CONVERSATION_SELECT =
  "*, lead:leads(id, name, phone, whatsapp, status, source), consultant:profiles!conversations_assigned_user_id_fkey(id, full_name, email)";

export async function listConversations(params: {
  companyId: string;
  statuses?: ConversationStatus[];
  assignedTo?: string | null;
  search?: string;
}) {
  let query = supabase
    .from("conversations")
    .select(CONVERSATION_SELECT)
    .eq("company_id", params.companyId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(100);

  if (params.statuses?.length) query = query.in("status", params.statuses);
  if (params.assignedTo) query = query.eq("assigned_user_id", params.assignedTo);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  let rows = (data ?? []) as unknown as ConversationListItem[];
  if (params.search?.trim()) {
    const term = params.search.trim().toLowerCase();
    const digits = params.search.replace(/\D/g, "");
    rows = rows.filter(
      (c) =>
        (c.lead?.name ?? "").toLowerCase().includes(term) ||
        (digits ? (c.lead?.whatsapp ?? "").includes(digits) : false),
    );
  }
  return rows;
}

/**
 * Leads abandonados: conversas na fila, sem consultor responsável, que já
 * passaram pelo rodízio (houve tentativas) e não têm nenhuma oferta em aberto.
 * Qualquer consultor da empresa pode assumir uma dessas conversas.
 */
export async function listAbandonedConversations(params: { companyId: string; search?: string }) {
  const rows = await listConversations({
    companyId: params.companyId,
    statuses: ["WAITING_HUMAN", "QUEUED"],
    search: params.search ?? "",
  });
  const candidates = rows.filter((c) => !c.assigned_user_id);
  if (candidates.length === 0) return [];

  const { data, error } = await supabase
    .from("assignment_attempts")
    .select("conversation_id, status")
    .in(
      "conversation_id",
      candidates.map((c) => c.id),
    );
  if (error) throw new Error(error.message);

  const total = new Map<string, number>();
  const waiting = new Set<string>();
  for (const a of data ?? []) {
    total.set(a.conversation_id, (total.get(a.conversation_id) ?? 0) + 1);
    if (a.status === "WAITING") waiting.add(a.conversation_id);
  }
  return candidates.filter((c) => (total.get(c.id) ?? 0) > 0 && !waiting.has(c.id));
}


export async function getConversation(conversationId: string) {
  return assertOk(
    await supabase.from("conversations").select(CONVERSATION_SELECT).eq("id", conversationId).maybeSingle(),
  ) as unknown as ConversationListItem | null;
}

export async function listMessages(conversationId: string, limit = 200) {
  const rows = (assertOk(
    await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(limit),
  ) ?? []) as MessageRow[];
  return rows.reverse();
}

export async function getOrCreateConversation(leadId: string) {
  const { data, error } = await supabase.rpc("get_or_create_conversation", {
    _lead_id: leadId,
    _channel: "whatsapp",
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/**
 * Envia mensagem ao cliente. O envio real acontece no backend (MEGA API):
 * a mensagem é registrada com status PENDING e atualizada para SENT/FAILED.
 */
export async function sendMessage(input: {
  conversationId: string;
  content: string;
  senderType?: Extract<SenderType, "consultant" | "admin">;
}) {
  await sendWhatsAppMessage({
    data: { conversationId: input.conversationId, content: input.content },
  });
}

export async function assignConversation(conversationId: string, consultantId: string | null) {
  return assignConversationWithNotice({ data: { conversationId, consultantId } });
}

export async function setConversationStatus(conversationId: string, status: ConversationStatus) {
  const { error } = await supabase.rpc("set_conversation_status", {
    _conversation_id: conversationId,
    _status: status,
  });
  if (error) throw new Error(error.message);
}

export async function markConversationRead(conversationId: string) {
  await supabase.rpc("mark_conversation_read", { _conversation_id: conversationId });
}

export async function listConversationEvents(conversationId: string) {
  return (assertOk(
    await supabase
      .from("conversation_events")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(50),
  ) ?? []) as Tables["conversation_events"]["Row"][];
}

export async function listLeadConversations(leadId: string) {
  return (assertOk(
    await supabase
      .from("conversations")
      .select("*")
      .eq("lead_id", leadId)
      .order("started_at", { ascending: false }),
  ) ?? []) as ConversationRow[];
}

/** Avaliação de atendimento (1 a 5 estrelas) registrada para a conversa. */
export async function getConversationRating(conversationId: string) {
  const { data, error } = await supabase
    .from("service_ratings")
    .select("rating, rated_at, asked_at")
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as { rating: number | null; rated_at: string | null; asked_at: string } | null;
}


/* ------------------------------- Consultores ------------------------------- */

export async function listConsultants(companyId: string) {
  const data = assertOk(
    await supabase
      .from("profiles")
      .select("id, full_name, email, availability, is_active")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("full_name"),
  );
  return (Array.isArray(data) ? data : []) as {
    id: string;
    full_name: string | null;
    email: string | null;
    availability: Database["public"]["Enums"]["availability_status"];
    is_active: boolean;
  }[];
}
