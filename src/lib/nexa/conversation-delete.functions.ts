import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Exclui UMA conversa (e registros relacionados) mediante confirmação com
 * nome + senha pessoal de administrador. A ação fica registrada no log.
 */
export const deleteConversationAsAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { conversationId: string; name: string; password: string; reason?: string }) => {
    if (!input?.conversationId) throw new Error("Conversa inválida");
    if (!input.name?.trim()) throw new Error("Informe o seu nome de administrador");
    if (!input.password) throw new Error("Informe a sua senha de administrador");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const [{ data: isCompanyAdmin }, { data: isPlatformAdmin }] = await Promise.all([
      supabase.rpc("is_company_admin"),
      supabase.rpc("is_platform_admin"),
    ]);
    if (!isCompanyAdmin && !isPlatformAdmin) {
      throw new Error("Apenas administradores podem excluir conversas.");
    }

    const { data: credential } = await supabase
      .from("admin_delete_credentials")
      .select("display_name")
      .eq("user_id", userId)
      .maybeSingle();

    if (!credential) {
      throw new Error(
        "Você ainda não cadastrou uma senha de exclusão. Vá em Configurações › Criar senha de administrador.",
      );
    }
    if (credential.display_name.trim().toLowerCase() !== data.name.trim().toLowerCase()) {
      throw new Error(`Nome incorreto. Use exatamente o nome cadastrado: "${credential.display_name}".`);
    }

    const { data: verified, error: verifyError } = await supabase.rpc("verify_admin_delete_credential", {
      _display_name: credential.display_name,
      _password: data.password,
    });
    if (verifyError) throw new Error(verifyError.message);
    if (!verified) {
      throw new Error("Senha de administrador incorreta. Confira em Configurações › Criar senha de administrador.");
    }


    const { data: conversation, error: convError } = await supabase
      .from("conversations")
      .select("id, company_id, lead_id, channel")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (convError) throw new Error(convError.message);
    if (!conversation) throw new Error("Conversa não encontrada ou sem permissão.");

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, email, company_id")
      .eq("id", userId)
      .maybeSingle();

    if (!isPlatformAdmin && profile?.company_id !== conversation.company_id) {
      throw new Error("Esta conversa pertence a outra empresa.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: lead } = conversation.lead_id
      ? await supabaseAdmin
          .from("leads")
          .select("id, name, phone, whatsapp")
          .eq("id", conversation.lead_id)
          .maybeSingle()
      : { data: null };

    const { count: messagesCount } = await supabaseAdmin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversation.id);

    const { data: messageIds } = await supabaseAdmin
      .from("messages")
      .select("id")
      .eq("conversation_id", conversation.id);

    if (messageIds?.length) {
      const { error } = await supabaseAdmin
        .from("message_provider_payloads")
        .delete()
        .in("message_id", messageIds.map((m) => m.id));
      if (error) throw new Error(`message_provider_payloads: ${error.message}`);
    }

    const childTables = [
      "messages",
      "ai_sessions",
      "ai_summaries",
      "assignment_attempts",
      "conversation_assignments",
      "conversation_events",
      "service_ratings",
    ] as const;

    for (const table of childTables) {
      const { error } = await supabaseAdmin.from(table).delete().eq("conversation_id", conversation.id);
      if (error) throw new Error(`${table}: ${error.message}`);
    }

    const { error: deleteError } = await supabaseAdmin
      .from("conversations")
      .delete()
      .eq("id", conversation.id);
    if (deleteError) throw new Error(deleteError.message);

    const deletedByName = profile?.full_name ?? profile?.email ?? null;

    await supabaseAdmin.from("conversation_deletion_logs").insert({
      company_id: conversation.company_id,
      conversation_id: conversation.id,
      lead_id: lead?.id ?? null,
      lead_name: lead?.name ?? null,
      lead_phone: lead?.whatsapp ?? lead?.phone ?? null,
      channel: conversation.channel,
      messages_deleted: messagesCount ?? 0,
      deleted_by: userId,
      deleted_by_name: deletedByName,
      confirmed_name: data.name.trim(),
      reason: data.reason?.trim() || null,
    });

    await supabaseAdmin.from("audit_logs").insert({
      company_id: conversation.company_id,
      user_id: userId,
      action: "DELETE_CONVERSATION",
      entity_type: "conversations",
      entity_id: conversation.id,
      metadata: { messages_deleted: messagesCount ?? 0, lead_id: lead?.id ?? null },
    });

    return { deleted: true, messagesDeleted: messagesCount ?? 0 };
  });
