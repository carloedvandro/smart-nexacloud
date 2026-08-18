import type { SupabaseClient } from "@supabase/supabase-js";

import { consultantCanHandle } from "@/lib/queue/bridge.server";

export type ConversationAccess = {
  allowed: boolean;
  reason: "OK" | "EXPIRED" | "CLOSED" | "NOT_FOUND";
  message: string | null;
};

/**
 * Regra única de acesso ao atendimento, usada tanto pelo link/sistema quanto
 * pelo envio de mensagem. Mantém o mesmo critério já aplicado no WhatsApp:
 * a oportunidade vale enquanto a conversa é do consultor ou a oferta está
 * aguardando resposta dele. Expirou (foi repassada), o link deixa de valer.
 */
export async function checkConversationAccess(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string,
  conversationId: string,
): Promise<ConversationAccess> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("company_id")
    .eq("id", userId)
    .maybeSingle();
  if (!profile?.company_id) return { allowed: false, reason: "NOT_FOUND", message: "Usuário sem empresa." };

  const { data: isAdmin } = await supabase.rpc("is_company_admin");
  const { data: isPlatform } = await supabase.rpc("is_platform_admin");
  if (isAdmin || isPlatform) return { allowed: true, reason: "OK", message: null };

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, status")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversation) return { allowed: false, reason: "NOT_FOUND", message: "Conversa não encontrada." };

  const can = await consultantCanHandle(profile.company_id, conversationId, userId);
  if (can) return { allowed: true, reason: "OK", message: null };

  if (conversation.status === "CLOSED" || conversation.status === "PAUSED") {
    return { allowed: false, reason: "CLOSED", message: "Este atendimento está encerrado." };
  }
  return {
    allowed: false,
    reason: "EXPIRED",
    message: "Este link expirou: a oportunidade foi repassada a outro consultor.",
  };
}
