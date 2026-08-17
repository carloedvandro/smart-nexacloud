import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Apaga TODAS as conversas (e mensagens/eventos relacionados) da empresa atual.
 * Disponível apenas para ADMIN da empresa ou PLATFORM_ADMIN.
 */
export const purgeCompanyConversations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { alsoDeleteLeads?: boolean } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const [{ data: isCompanyAdmin }, { data: isPlatformAdmin }] = await Promise.all([
      supabase.rpc("is_company_admin"),
      supabase.rpc("is_platform_admin"),
    ]);
    if (!isCompanyAdmin && !isPlatformAdmin) throw new Error("Apenas administradores podem limpar conversas.");

    const { data: profile } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", userId)
      .maybeSingle();

    const companyId = profile?.company_id;
    if (!companyId) throw new Error("Empresa não encontrada para este usuário.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { count: conversationCount } = await supabaseAdmin
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId);

    const childTables = [
      "messages",
      "ai_sessions",
      "ai_summaries",
      "assignment_attempts",
      "conversation_assignments",
      "conversation_events",
    ] as const;

    for (const table of childTables) {
      const { error } = await supabaseAdmin.from(table).delete().eq("company_id", companyId);
      if (error) throw new Error(`${table}: ${error.message}`);
    }

    const { error: convError } = await supabaseAdmin
      .from("conversations")
      .delete()
      .eq("company_id", companyId);
    if (convError) throw new Error(convError.message);

    let leadsDeleted = 0;
    if (data.alsoDeleteLeads) {
      for (const table of ["lead_memory", "lead_notes", "privacy_consents"] as const) {
        const { error } = await supabaseAdmin.from(table).delete().eq("company_id", companyId);
        if (error) throw new Error(`${table}: ${error.message}`);
      }
      const { count, error } = await supabaseAdmin
        .from("leads")
        .delete({ count: "exact" })
        .eq("company_id", companyId);
      if (error) throw new Error(error.message);
      leadsDeleted = count ?? 0;
    }

    await supabaseAdmin.from("audit_logs").insert({
      company_id: companyId,
      user_id: userId,
      action: "PURGE_CONVERSATIONS",
      entity_type: "conversations",
      metadata: { conversations: conversationCount ?? 0, leads_deleted: leadsDeleted },
    });

    return { conversationsDeleted: conversationCount ?? 0, leadsDeleted };
  });
