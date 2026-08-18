import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type CompanyLicense = {
  companyId: string;
  maxInternalUsers: number;
  maxConsultants: number;
  users: number;
  consultants: number;
  admins: number;
  pendingInvites: number;
};

function parse(raw: unknown): CompanyLicense | null {
  const value = raw as Record<string, unknown> | null;
  if (!value?.["company_id"]) return null;
  return {
    companyId: String(value["company_id"]),
    maxInternalUsers: Number(value["max_internal_users"] ?? 8),
    maxConsultants: Number(value["max_consultants"] ?? 7),
    users: Number(value["users"] ?? 0),
    consultants: Number(value["consultants"] ?? 0),
    admins: Number(value["admins"] ?? 0),
    pendingInvites: Number(value["pending_invites"] ?? 0),
  };
}

/** Uso da licença da empresa — leitura para administradores da empresa e da plataforma. */
export const getCompanyLicense = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data?: { companyId?: string }) => data ?? {})
  .handler(async ({ data, context }): Promise<CompanyLicense | null> => {
    const { data: raw, error } = await context.supabase.rpc("company_license_usage", {
      ...(data.companyId ? { _company: data.companyId } : {}),
    });
    if (error) throw new Error(error.message);
    return parse(raw);
  });

/** Ajusta os limites contratados de uma empresa — somente administrador da plataforma. */
export const setCompanyLicenseLimits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { companyId: string; maxInternalUsers: number; maxConsultants: number }) => {
    if (!data.companyId) throw new Error("Empresa inválida.");
    if (data.maxInternalUsers < 1) throw new Error("O total de usuários deve ser ao menos 1.");
    if (data.maxConsultants < 0) throw new Error("Limite de consultores inválido.");
    if (data.maxConsultants > data.maxInternalUsers) {
      throw new Error("O limite de consultores não pode exceder o total de usuários.");
    }
    return data;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("platform_set_company_limits", {
      _company_id: data.companyId,
      _max_internal_users: data.maxInternalUsers,
      _max_consultants: data.maxConsultants,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
