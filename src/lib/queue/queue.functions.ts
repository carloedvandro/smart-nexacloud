import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type QueueSettings = {
  distributionMode: "ROUND_ROBIN" | "LEAST_BUSY" | "MANUAL";
  slaSeconds: number;
  onlyOnline: boolean;
  businessHoursEnabled: boolean;
  maxConcurrentPerConsultant: number;
};

export type QueueAttempt = {
  id: string;
  conversationId: string;
  leadName: string | null;
  consultantId: string | null;
  consultantName: string | null;
  status: "WAITING" | "RESPONDED" | "TIMEOUT" | "CANCELLED";
  assignedAt: string;
  deadlineAt: string;
  respondedAt: string | null;
};

export type QueueWaiting = {
  conversationId: string;
  leadName: string | null;
  status: string;
  lastMessageAt: string | null;
  startedAt: string;
};

export type QueueConsultant = {
  id: string;
  name: string;
  availability: string;
  load: number;
  limit: number;
};

export type QueueOverview = {
  settings: QueueSettings;
  waiting: QueueWaiting[];
  attempts: QueueAttempt[];
  consultants: QueueConsultant[];
};

const DEFAULTS: QueueSettings = {
  distributionMode: "ROUND_ROBIN",
  slaSeconds: 60,
  onlyOnline: true,
  businessHoursEnabled: false,
  maxConcurrentPerConsultant: 5,
};

async function currentCompany(context: { supabase: any; userId: string }): Promise<string> {
  const { data } = await context.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", context.userId)
    .maybeSingle();
  if (!data?.company_id) throw new Error("Usuário sem empresa vinculada.");
  return data.company_id as string;
}

/** Visão completa da fila: configuração, aguardando, tentativas e carga por consultor. */
export const getQueueOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<QueueOverview> => {
    const companyId = await currentCompany(context);

    // Expira ofertas vencidas antes de mostrar o estado.
    await context.supabase.rpc("queue_tick");

    const [{ data: cfg }, { data: waitingRows }, { data: attemptRows }, { data: profiles }] =
      await Promise.all([
        context.supabase
          .from("queue_settings")
          .select(
            "distribution_mode, sla_seconds, only_online, business_hours_enabled, max_concurrent_per_consultant",
          )
          .eq("company_id", companyId)
          .maybeSingle(),
        context.supabase
          .from("conversations")
          .select("id, status, started_at, last_message_at, lead:leads(name, whatsapp)")
          .in("status", ["WAITING_HUMAN", "QUEUED"])
          .order("started_at", { ascending: true })
          .limit(50),
        context.supabase
          .from("assignment_attempts")
          .select(
            "id, conversation_id, consultant_id, status, assigned_at, deadline_at, responded_at, consultant:profiles!assignment_attempts_consultant_id_fkey(full_name, email), conversation:conversations(lead:leads(name, whatsapp))",
          )
          .order("assigned_at", { ascending: false })
          .limit(30),
        context.supabase
          .from("profiles")
          .select("id, full_name, email, availability, metadata")
          .eq("company_id", companyId)
          .eq("is_active", true),
      ]);

    const settings: QueueSettings = cfg
      ? {
          distributionMode: cfg.distribution_mode,
          slaSeconds: cfg.sla_seconds,
          onlyOnline: cfg.only_online,
          businessHoursEnabled: cfg.business_hours_enabled,
          maxConcurrentPerConsultant: cfg.max_concurrent_per_consultant,
        }
      : DEFAULTS;

    const { data: loadRows } = await context.supabase
      .from("conversations")
      .select("assigned_user_id")
      .in("status", ["ASSIGNED", "HUMAN_ACTIVE", "WAITING_CUSTOMER"]);
    const load = new Map<string, number>();
    for (const row of loadRows ?? []) {
      if (row.assigned_user_id) load.set(row.assigned_user_id, (load.get(row.assigned_user_id) ?? 0) + 1);
    }

    return {
      settings,
      waiting: (waitingRows ?? []).map((row: any) => ({
        conversationId: row.id,
        leadName: row.lead?.name ?? row.lead?.whatsapp ?? null,
        status: row.status,
        lastMessageAt: row.last_message_at,
        startedAt: row.started_at,
      })),
      attempts: (attemptRows ?? []).map((row: any) => ({
        id: row.id,
        conversationId: row.conversation_id,
        leadName: row.conversation?.lead?.name ?? row.conversation?.lead?.whatsapp ?? null,
        consultantId: row.consultant_id,
        consultantName: row.consultant?.full_name ?? row.consultant?.email ?? null,
        status: row.status,
        assignedAt: row.assigned_at,
        deadlineAt: row.deadline_at,
        respondedAt: row.responded_at,
      })),
      consultants: (profiles ?? []).map((row: any) => ({
        id: row.id,
        name: row.full_name ?? row.email ?? "Sem nome",
        availability: row.availability,
        load: load.get(row.id) ?? 0,
        limit: Math.max(1, Number(row.metadata?.max_concurrent) || settings.maxConcurrentPerConsultant),
      })),
    };
  });

/** Salva a configuração da fila (somente administrador da empresa). */
export const saveQueueSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: QueueSettings) => {
    if (data.slaSeconds < 10 || data.slaSeconds > 3600) throw new Error("SLA entre 10 e 3600 segundos.");
    if (data.maxConcurrentPerConsultant < 1) throw new Error("Limite mínimo de 1 atendimento.");
    return data;
  })
  .handler(async ({ data, context }) => {
    const companyId = await currentCompany(context);
    const { data: isAdmin } = await context.supabase.rpc("is_company_admin");
    if (!isAdmin) throw new Error("Apenas administradores podem alterar a fila.");

    const { error } = await context.supabase.from("queue_settings").upsert(
      {
        company_id: companyId,
        distribution_mode: data.distributionMode,
        sla_seconds: data.slaSeconds,
        only_online: data.onlyOnline,
        business_hours_enabled: data.businessHoursEnabled,
        max_concurrent_per_consultant: data.maxConcurrentPerConsultant,
      },
      { onConflict: "company_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Coloca a conversa na fila manualmente (ex.: devolver do consultor para o rodízio). */
export const enqueueConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { conversationId: string; reason?: string }) => data)
  .handler(async ({ data, context }) => {
    const { data: consultant, error } = await context.supabase.rpc("enqueue_conversation", {
      _conversation_id: data.conversationId,
      _reason: data.reason ?? "envio manual para a fila",
    });
    if (error) throw new Error(error.message);
    return { consultantId: (consultant as string | null) ?? null };
  });

/** Força a passagem da oferta atual para o próximo consultor. */
export const skipQueueOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { conversationId: string }) => data)
  .handler(async ({ data, context }) => {
    const { data: consultant, error } = await context.supabase.rpc("queue_assign_next", {
      _conversation_id: data.conversationId,
    });
    if (error) throw new Error(error.message);
    return { consultantId: (consultant as string | null) ?? null };
  });

/** Executa a expiração de prazos manualmente. */
export const runQueueTick = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("queue_tick");
    if (error) throw new Error(error.message);
    return { processed: Number(data ?? 0) };
  });
