import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ConversationAccess = {
  allowed: boolean;
  reason: "OK" | "EXPIRED" | "CLOSED" | "NOT_FOUND";
  message: string | null;
};

/**
 * Verifica se o usuário ainda pode atender a conversa aberta pelo link.
 * Admin sempre pode; consultor só enquanto a conversa for dele ou a oferta
 * do rodízio continuar em aberto (WAITING). Depois disso o link expira.
 */
export const getConversationAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { conversationId: string }) => {
    if (!data?.conversationId) throw new Error("Conversa inválida.");
    return data;
  })
  .handler(async ({ data, context }): Promise<ConversationAccess> => {
    const { checkConversationAccess } = await import("@/lib/queue/access.server");
    return checkConversationAccess(context.supabase, context.userId, data.conversationId);
  });
