import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Atribui (ou libera) a conversa e avisa no WhatsApp pessoal do consultor:
 * o novo responsável recebe o link do atendimento e o consultor anterior é
 * informado de que a conversa saiu com ele.
 */
export const assignConversationWithNotice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { conversationId: string; consultantId: string | null }) => data)
  .handler(async ({ data, context }) => {
    const { data: conversation, error: readError } = await context.supabase
      .from("conversations")
      .select("id, company_id, assigned_user_id")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!conversation) throw new Error("Conversa não encontrada.");

    const previousUserId = conversation.assigned_user_id as string | null;

    const { error } = await context.supabase.rpc("assign_conversation", {
      _conversation_id: data.conversationId,
      _consultant_id: data.consultantId as string,
    });
    if (error) throw new Error(error.message);

    let notification: { notified: boolean; reason?: string } = { notified: false };
    try {
      const { notifyManualAssignment } = await import("@/lib/queue/assign-notify.server");
      notification = await notifyManualAssignment({
        companyId: conversation.company_id as string,
        conversationId: data.conversationId,
        previousUserId,
        newUserId: data.consultantId,
        actorId: context.userId,
      });
    } catch (notifyError) {
      console.error("[atribuição] falha ao avisar no WhatsApp", notifyError);
      notification = {
        notified: false,
        reason: "A atribuição foi salva, mas ocorreu uma falha ao enviar o aviso pelo WhatsApp.",
      };
    }

    return { ok: true, notification };
  });

/**
 * Atribui o lead ao consultor e coloca o atendimento em andamento:
 * responsável do lead, etapa do funil, conversa aberta e aviso no WhatsApp.
 */
export const assignLeadWithService = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { leadId: string; consultantId: string | null }) => data)
  .handler(async ({ data, context }) => {
    const { data: lead, error: leadError } = await context.supabase
      .from("leads")
      .select("id, company_id, assigned_user_id")
      .eq("id", data.leadId)
      .maybeSingle();
    if (leadError) throw new Error(leadError.message);
    if (!lead) throw new Error("Lead não encontrado.");

    const { data: conversationId, error } = await context.supabase.rpc("assign_lead_and_service", {
      _lead_id: data.leadId,
      _consultant_id: data.consultantId as string,
    });
    if (error) throw new Error(error.message);

    let notification: { notified: boolean; reason?: string } = { notified: false };
    if (conversationId) {
      try {
        const { notifyManualAssignment } = await import("@/lib/queue/assign-notify.server");
        notification = await notifyManualAssignment({
          companyId: lead.company_id as string,
          conversationId: conversationId as string,
          previousUserId: (lead.assigned_user_id as string | null) ?? null,
          newUserId: data.consultantId,
          actorId: context.userId,
        });
      } catch (notifyError) {
        console.error("[atribuição de lead] falha ao avisar no WhatsApp", notifyError);
        notification = {
          notified: false,
          reason: "A atribuição foi salva, mas ocorreu uma falha ao enviar o aviso pelo WhatsApp.",
        };
      }
    }

    return { ok: true, conversationId: (conversationId as string | null) ?? null, notification };
  });
