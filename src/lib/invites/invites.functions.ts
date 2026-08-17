import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sendTemplateEmail } from "@/lib/email-templates/send-email";
import { buildInviteUrl } from "@/lib/nexa/public-url";

type SendInviteInput = { email: string; companyId?: string };

export type SendInviteResult = { sent: boolean; reason?: string };

/**
 * Envia por e-mail o convite pendente mais recente do endereço informado.
 * O convite precisa já existir (criado pelas RPCs de convite).
 */
export const sendCompanyInviteEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: SendInviteInput) => {
    const email = data?.email?.trim().toLowerCase();
    if (!email) throw new Error("Informe o e-mail do convidado.");
    return { email, companyId: data.companyId };
  })
  .handler(async ({ data, context }): Promise<SendInviteResult> => {
    let query = context.supabase
      .from("company_invites")
      .select("id, token, role, expires_at, company_id, companies(name)")
      .eq("email", data.email)
      .eq("status", "PENDING")
      .order("created_at", { ascending: false })
      .limit(1);

    if (data.companyId) query = query.eq("company_id", data.companyId);

    const { data: invite, error } = await query.maybeSingle();
    if (error) return { sent: false, reason: error.message };
    if (!invite?.token) return { sent: false, reason: "Convite pendente não encontrado." };

    const companyName =
      (invite as unknown as { companies?: { name?: string } }).companies?.name ?? undefined;
    const roleLabel = invite.role === "ADMIN" ? "administrador" : "consultor";
    const expiresAt = invite.expires_at
      ? new Date(invite.expires_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
      : undefined;

    try {
      const result = await sendTemplateEmail("company-invite", data.email, {
        idempotencyKey: `company-invite-${invite.id}`,
        templateData: {
          companyName,
          roleLabel,
          expiresAt,
          inviteUrl: buildInviteUrl(invite.token),
        },
      });
      if (!result.sent) {
        return { sent: false, reason: "Destinatário bloqueado para envios (suppression)." };
      }
      return { sent: true };
    } catch (err) {
      return { sent: false, reason: err instanceof Error ? err.message : String(err) };
    }
  });
