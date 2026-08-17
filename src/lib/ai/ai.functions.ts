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

export const listKnowledge = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<KnowledgeItem[]> => {
    const { data, error } = await context.supabase
      .from("knowledge_base")
      .select("id, title, category, content, status, updated_at")
      .order("status", { ascending: true })
      .order("title", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({
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
    (data: { id?: string; title: string; category: string; content: string; status: string }) => {
      if (!data.title?.trim()) throw new Error("Informe o título.");
      if (!data.content?.trim()) throw new Error("Informe o conteúdo.");
      return data;
    },
  )
  .handler(async ({ data, context }) => {
    const companyId = await currentCompany(context);
    const payload = {
      company_id: companyId,
      title: data.title.trim(),
      category: data.category as never,
      content: data.content.trim(),
      status: data.status as never,
      created_by: context.userId,
    };

    if (data.id) {
      const { error } = await context.supabase
        .from("knowledge_base")
        .update(payload)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }

    const { data: row, error } = await context.supabase
      .from("knowledge_base")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id as string };
  });

export const deleteKnowledge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("knowledge_base").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getAiConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AiConfig> => {
    const companyId = await currentCompany(context);
    const { data } = await context.supabase
      .from("system_settings")
      .select("value")
      .eq("company_id", companyId)
      .eq("key", "ai")
      .maybeSingle();
    const value = (data?.value ?? {}) as Partial<AiConfig>;
    return {
      enabled: Boolean(value.enabled),
      agentName: value.agentName ?? "Assistente",
      companyName: value.companyName ?? "",
      extraInstructions: value.extraInstructions ?? "",
    };
  });

export const saveAiConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: AiConfig) => data)
  .handler(async ({ data, context }) => {
    const companyId = await currentCompany(context);
    const { data: isAdmin } = await context.supabase.rpc("is_company_admin");
    const { data: isPlatformAdmin } = await context.supabase.rpc("is_platform_admin");
    if (!isAdmin && !isPlatformAdmin) throw new Error("Somente administradores.");

    const value = {
      enabled: Boolean(data.enabled),
      agentName: data.agentName.trim() || "Assistente",
      companyName: data.companyName.trim(),
      extraInstructions: data.extraInstructions.trim(),
    };

    const { data: existing } = await context.supabase
      .from("system_settings")
      .select("id")
      .eq("company_id", companyId)
      .eq("key", "ai")
      .maybeSingle();

    const { error } = existing
      ? await context.supabase.from("system_settings").update({ value }).eq("id", existing.id)
      : await context.supabase
          .from("system_settings")
          .insert({ company_id: companyId, key: "ai", value });
    if (error) throw new Error(error.message);
    return value;
  });
