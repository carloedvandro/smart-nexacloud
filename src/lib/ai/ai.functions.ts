import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type KnowledgeItem = {
  id: string;
  title: string;
  category: string;
  content: string;
  status: string;
  updatedAt: string;
};

export type AiConfig = {
  enabled: boolean;
  agentName: string;
  companyName: string;
  extraInstructions: string;
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

export type KnowledgeScope = {
  companyId: string;
  companyName: string;
  isPlatformAdmin: boolean;
  companies: { id: string; name: string }[];
};

/**
 * Resolve a empresa alvo: administradores de empresa ficam presos à própria
 * empresa; o super administrador pode escolher qualquer empresa.
 */
async function resolveScope(
  context: { supabase: any; userId: string },
  companyId?: string | null,
): Promise<{ companyId: string; db: any; isPlatformAdmin: boolean }> {
  const { data: isPlatformAdmin } = await context.supabase.rpc("is_platform_admin");
  if (isPlatformAdmin) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const target = companyId ?? (await currentCompany(context).catch(() => null));
    if (!target) {
      const { data: first } = await supabaseAdmin
        .from("companies")
        .select("id")
        .order("name", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!first?.id) throw new Error("Nenhuma empresa cadastrada.");
      return { companyId: first.id as string, db: supabaseAdmin, isPlatformAdmin: true };
    }
    return { companyId: target, db: supabaseAdmin, isPlatformAdmin: true };
  }

  const own = await currentCompany(context);
  if (companyId && companyId !== own) throw new Error("Acesso restrito à sua empresa.");
  return { companyId: own, db: context.supabase, isPlatformAdmin: false };
}

/** Empresas disponíveis para o usuário atual na base de conhecimento. */
export const getKnowledgeScope = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<KnowledgeScope> => {
    const { companyId, db, isPlatformAdmin } = await resolveScope(context, null);
    if (isPlatformAdmin) {
      const { data } = await db.from("companies").select("id, name").order("name", { ascending: true });
      const companies = (data ?? []).map((c: { id: string; name: string }) => ({ id: c.id, name: c.name }));
      return {
        companyId,
        companyName: companies.find((c: { id: string }) => c.id === companyId)?.name ?? "",
        isPlatformAdmin: true,
        companies,
      };
    }
    const { data } = await db.from("companies").select("id, name").eq("id", companyId).maybeSingle();
    return {
      companyId,
      companyName: data?.name ?? "",
      isPlatformAdmin: false,
      companies: data ? [{ id: data.id, name: data.name }] : [],
    };
  });

export const listKnowledge = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data?: { companyId?: string | null }) => data ?? {})
  .handler(async ({ data: input, context }): Promise<KnowledgeItem[]> => {
    const { companyId, db } = await resolveScope(context, input?.companyId ?? null);
    const { data, error } = await db
      .from("knowledge_base")
      .select("id, title, category, content, status, updated_at")
      .eq("company_id", companyId)
      .order("status", { ascending: true })
      .order("title", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row: any) => ({
      id: row.id,
      title: row.title,
      category: row.category as string,
      content: row.content,
      status: row.status as string,
      updatedAt: row.updated_at,
    }));
  });

export const saveKnowledge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      id?: string;
      companyId?: string | null;
      title: string;
      category: string;
      content: string;
      status: string;
    }) => {
      if (!data.title?.trim()) throw new Error("Informe o título.");
      if (!data.content?.trim()) throw new Error("Informe o conteúdo.");
      return data;
    },
  )
  .handler(async ({ data, context }) => {
    const { companyId, db } = await resolveScope(context, data.companyId ?? null);
    const payload = {
      company_id: companyId,
      title: data.title.trim(),
      category: data.category as never,
      content: data.content.trim(),
      status: data.status as never,
      created_by: context.userId,
    };

    if (data.id) {
      const { error } = await db
        .from("knowledge_base")
        .update(payload)
        .eq("id", data.id)
        .eq("company_id", companyId);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }

    const { data: row, error } = await db
      .from("knowledge_base")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id as string };
  });

export const deleteKnowledge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; companyId?: string | null }) => data)
  .handler(async ({ data, context }) => {
    const { companyId, db } = await resolveScope(context, data.companyId ?? null);
    const { error } = await db
      .from("knowledge_base")
      .delete()
      .eq("id", data.id)
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getAiConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data?: { companyId?: string | null }) => data ?? {})
  .handler(async ({ data: input, context }): Promise<AiConfig> => {
    const { companyId, db } = await resolveScope(context, input?.companyId ?? null);
    const { data } = await db
      .from("system_settings")
      .select("value")
      .eq("company_id", companyId)
      .eq("key", "ai")
      .maybeSingle();
    const value = (data?.value ?? {}) as Partial<AiConfig>;
    return {
      enabled: Boolean(value.enabled),
      agentName: value.agentName ?? "Ana",
      companyName: value.companyName ?? "",
      extraInstructions: value.extraInstructions ?? "",
    };
  });

export const saveAiConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: AiConfig & { companyId?: string | null }) => data)
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_company_admin");
    const { data: isPlatformAdmin } = await context.supabase.rpc("is_platform_admin");
    if (!isAdmin && !isPlatformAdmin) throw new Error("Somente administradores.");
    const { companyId, db } = await resolveScope(context, data.companyId ?? null);

    const value = {
      enabled: Boolean(data.enabled),
      agentName: data.agentName.trim() || "Ana",
      companyName: data.companyName.trim(),
      extraInstructions: data.extraInstructions.trim(),
    };

    const { data: existing } = await db
      .from("system_settings")
      .select("id")
      .eq("company_id", companyId)
      .eq("key", "ai")
      .maybeSingle();

    const { error } = existing
      ? await db.from("system_settings").update({ value }).eq("id", existing.id)
      : await db
          .from("system_settings")
          .insert({ company_id: companyId, key: "ai", value });
    if (error) throw new Error(error.message);
    return value;
  });

/**
 * Diagnóstico: executa a IA na conversa em aberto mais recente da empresa e
 * devolve o motivo exato caso ela não responda.
 */
export const testAiReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data?: { companyId?: string | null }) => data ?? {})
  .handler(async ({ data: input, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_company_admin");
    const { data: isPlatformAdmin } = await context.supabase.rpc("is_platform_admin");
    if (!isAdmin && !isPlatformAdmin) throw new Error("Somente administradores.");
    const { companyId } = await resolveScope(context, input?.companyId ?? null);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { respondWithAI, loadAiSettings } = await import("@/lib/ai/agent.server");

    const settings = await loadAiSettings(companyId);
    if (!settings.enabled) {
      return { status: "skipped", reason: "A IA está desligada nesta empresa." };
    }

    const { data: conversation } = await supabaseAdmin
      .from("conversations")
      .select("id, lead_id, metadata, status, assigned_user_id")
      .eq("company_id", companyId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (!conversation) return { status: "skipped", reason: "Nenhuma conversa encontrada." };

    const metadata = (conversation.metadata ?? {}) as { connection_id?: string };
    let connectionId = metadata.connection_id ?? null;
    if (!connectionId) {
      const { data: connection } = await supabaseAdmin
        .from("whatsapp_connections")
        .select("id")
        .eq("company_id", companyId)
        .order("instance_number", { ascending: true })
        .limit(1)
        .maybeSingle();
      connectionId = connection?.id ?? null;
    }
    if (!connectionId) return { status: "skipped", reason: "Nenhuma instância disponível." };

    const result = await respondWithAI({
      companyId,
      conversationId: conversation.id,
      leadId: conversation.lead_id ?? null,
      connectionId,
    });
    return { status: result.status, reason: result.reason ?? "" };
  });
