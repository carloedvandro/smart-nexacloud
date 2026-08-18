import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PlatformCompany = {
  id: string;
  name: string;
  legalName: string | null;
  document: string | null;
  status: string;
  instanceCount: number;
  maxInternalUsers: number;
  maxConsultants: number;
  createdAt: string;
};


export type PlatformInstance = {
  id: string;
  companyId: string;
  companyName: string;
  name: string | null;
  instanceNumber: number | null;
  status: string;
  phoneNumber: string | null;
  assignedUserName: string | null;
  hasCredentials: boolean;
};

export type PlatformOverview = {
  companies: number;
  activeCompanies: number;
  instances: number;
  connectedInstances: number;
  availableInstances: number;
  users: number;
  leadsToday: number;
  openConversations: number;
  messagesToday: number;
  pendingInvites: number;
  recentCompanies: {
    id: string;
    name: string;
    status: string;
    createdAt: string;
    instanceCount: number;
  }[];
};

async function assertPlatformAdmin(supabase: { rpc: (fn: "is_platform_admin") => Promise<{ data: unknown }> }) {
  const { data } = await supabase.rpc("is_platform_admin");
  if (!data) throw new Error("Acesso restrito ao administrador da plataforma.");
}

/** Lista todas as empresas da plataforma (somente super administrador). */
export const listPlatformCompanies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlatformCompany[]> => {
    await assertPlatformAdmin(context.supabase as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: companies, error }, { data: connections }] = await Promise.all([
      supabaseAdmin
        .from("companies")
        .select("id, name, legal_name, document, status, created_at")
        .order("name", { ascending: true }),
      supabaseAdmin.from("whatsapp_connections").select("id, company_id"),
    ]);
    if (error) throw new Error(error.message);

    const counts = new Map<string, number>();
    for (const row of connections ?? []) {
      counts.set(row.company_id, (counts.get(row.company_id) ?? 0) + 1);
    }

    return (companies ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      legalName: row.legal_name,
      document: row.document,
      status: row.status,
      instanceCount: counts.get(row.id) ?? 0,
      createdAt: row.created_at,
    }));
  });

/** Cria uma empresa (reserva) sem exigir que ela já tenha usuários. */
export const createPlatformCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { name: string; legalName?: string; document?: string }) => {
    if (!data.name?.trim()) throw new Error("Informe o nome da empresa.");
    return data;
  })
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context.supabase as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: company, error } = await supabaseAdmin
      .from("companies")
      .insert({
        name: data.name.trim(),
        legal_name: data.legalName?.trim() || null,
        document: data.document?.trim() || null,
      })
      .select("id, name")
      .single();
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("queue_settings").insert({ company_id: company.id });
    await supabaseAdmin.from("business_hours").insert(
      Array.from({ length: 7 }, (_, weekday) => ({
        company_id: company.id,
        weekday,
        start_time: "08:00",
        end_time: "18:00",
        is_active: weekday >= 1 && weekday <= 5,
      })),
    );
    await supabaseAdmin.from("audit_logs").insert({
      company_id: company.id,
      user_id: context.userId,
      action: "CREATE_COMPANY",
      entity_type: "company",
      entity_id: company.id,
    });

    return { id: company.id, name: company.name };
  });

/** Lista todas as instâncias provisionadas na plataforma. */
export const listPlatformInstances = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlatformInstance[]> => {
    await assertPlatformAdmin(context.supabase as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: rows, error }, { data: creds }] = await Promise.all([
      supabaseAdmin
        .from("whatsapp_connections")
        .select(
          "id, company_id, name, instance_number, status, phone_number, company:companies(name), profile:profiles!whatsapp_connections_user_id_fkey(full_name, email)",
        )
        .order("instance_number", { ascending: true }),
      supabaseAdmin.from("whatsapp_credentials").select("connection_id"),
    ]);
    if (error) throw new Error(error.message);
    const withCreds = new Set((creds ?? []).map((row) => row.connection_id));

    return (rows ?? []).map((row) => {
      const company = row.company as { name: string } | null;
      const profile = row.profile as { full_name: string | null; email: string | null } | null;
      return {
        id: row.id,
        companyId: row.company_id,
        companyName: company?.name ?? "—",
        name: row.name,
        instanceNumber: row.instance_number,
        status: row.status,
        phoneNumber: row.phone_number,
        assignedUserName: profile?.full_name ?? profile?.email ?? null,
        hasCredentials: withCreds.has(row.id),
      };
    });
  });

/** Provisiona uma instância contratada para qualquer empresa. */
export const provisionInstanceForCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      companyId: string;
      instanceKey: string;
      name?: string;
      instanceNumber?: number;
      apiToken?: string;
      apiHost?: string;
    }) => {
      if (!data.companyId) throw new Error("Selecione a empresa.");
      if (!data.instanceKey?.trim()) throw new Error("Informe a instance_key.");
      return data;
    },
  )
  .handler(async ({ data, context }) => {
    const { data: id, error } = await context.supabase.rpc("provision_whatsapp_instance", {
      _company_id: data.companyId,
      _instance_key: data.instanceKey.trim(),
      ...(data.name?.trim() ? { _name: data.name.trim() } : {}),
      ...(typeof data.instanceNumber === "number" ? { _instance_number: data.instanceNumber } : {}),
    });
    if (error) throw new Error(error.message);

    const token = data.apiToken?.trim();
    const host = data.apiHost?.trim();
    if (token || host) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error: credError } = await supabaseAdmin
        .from("whatsapp_credentials")
        .update({
          ...(token ? { api_key: token } : {}),
          ...(host ? { api_host: host } : {}),
        })
        .eq("connection_id", id as string);
      if (credError) throw new Error(credError.message);
    }
    return { id: id as string };
  });

/** Atualiza o token/host da MEGA de uma instância já provisionada. */
export const updateInstanceCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { connectionId: string; apiToken?: string; apiHost?: string }) => {
    if (!data.connectionId) throw new Error("Instância inválida.");
    if (!data.apiToken?.trim() && !data.apiHost?.trim())
      throw new Error("Informe o token ou o host.");
    return data;
  })
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context.supabase as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const token = data.apiToken?.trim();
    const host = data.apiHost?.trim();
    const { error } = await supabaseAdmin
      .from("whatsapp_credentials")
      .update({
        ...(token ? { api_key: token } : {}),
        ...(host ? { api_host: host } : {}),
      })
      .eq("connection_id", data.connectionId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Transfere uma instância provisionada de uma empresa para outra (super administrador). */
export const transferInstanceCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { connectionId: string; companyId: string }) => {
    if (!data.connectionId) throw new Error("Instância inválida.");
    if (!data.companyId) throw new Error("Selecione a empresa de destino.");
    return data;
  })
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context.supabase as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: connection, error: readError } = await supabaseAdmin
      .from("whatsapp_connections")
      .select("id, company_id, user_id, is_trunk")
      .eq("id", data.connectionId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!connection) throw new Error("Instância inexistente.");
    if (connection.company_id === data.companyId)
      throw new Error("A instância já pertence a esta empresa.");

    const { count: messageCount } = await supabaseAdmin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("connection_id", data.connectionId);
    if (messageCount && messageCount > 0)
      throw new Error(
        "Esta instância já possui mensagens vinculadas a outra empresa e não pode ser transferida.",
      );

    // Número da instância na empresa de destino e definição de tronco.
    const { data: targetRows } = await supabaseAdmin
      .from("whatsapp_connections")
      .select("instance_number, is_trunk")
      .eq("company_id", data.companyId);
    const nextNumber =
      Math.max(0, ...(targetRows ?? []).map((row) => row.instance_number ?? 0)) + 1;
    const targetHasTrunk = (targetRows ?? []).some((row) => row.is_trunk);

    // Encerra vínculos ativos do colaborador antes de mudar de empresa.
    if (connection.user_id) {
      await supabaseAdmin
        .from("whatsapp_instance_assignments")
        .update({ ended_at: new Date().toISOString(), release_reason: "TRANSFERENCIA_DE_EMPRESA" })
        .eq("connection_id", data.connectionId)
        .is("ended_at", null);
    }

    const { error } = await supabaseAdmin
      .from("whatsapp_connections")
      .update({
        company_id: data.companyId,
        user_id: null,
        assigned_at: null,
        assigned_by: null,
        instance_number: nextNumber,
        is_trunk: !targetHasTrunk,
        status: "AVAILABLE",
      })
      .eq("id", data.connectionId);
    if (error) throw new Error(error.message);

    await supabaseAdmin
      .from("whatsapp_credentials")
      .update({ company_id: data.companyId })
      .eq("connection_id", data.connectionId);

    await supabaseAdmin.from("audit_logs").insert({
      company_id: data.companyId,
      user_id: context.userId,
      action: "TRANSFER_WHATSAPP_INSTANCE",
      entity_type: "whatsapp_connection",
      entity_id: data.connectionId,
      metadata: { from_company_id: connection.company_id, to_company_id: data.companyId },
    });

    return { ok: true };
  });


/**
 * URL CENTRAL do webhook (super administrador).
 * A mesma URL serve todas as instâncias — a MEGA envia a instance_key no payload.
 */
export const getPlatformWebhookUrl = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context.supabase as never);
    const { getPublicBaseUrl } = await import("@/lib/nexa/public-url");
    return { url: `${getPublicBaseUrl()}/api/public/whatsapp/webhook` };
  });

/** Configura o webhook central na MEGA para uma instância (super administrador). */
export const configurePlatformWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { connectionId: string }) => data)
  .handler(async ({ data, context }): Promise<{ ok: boolean; url: string; current: string | null; error?: string }> => {
    await assertPlatformAdmin(context.supabase as never);
    const { getPublicBaseUrl } = await import("@/lib/nexa/public-url");
    const url = `${getPublicBaseUrl()}/api/public/whatsapp/webhook`;

    const { readInstanceWebhook, writeInstanceWebhook } = await import(
      "@/lib/whatsapp/actions.server"
    );
    try {
      const applied = await writeInstanceWebhook(data.connectionId, url);
      if (!applied.ok) {
        return { ok: false, url, current: null, error: applied.error ?? "Falha ao configurar o webhook." };
      }
      const current = await readInstanceWebhook(data.connectionId);
      return { ok: true, url, current: current.url ?? null };
    } catch (error) {
      return {
        ok: false,
        url,
        current: null,
        error: error instanceof Error ? error.message : "Falha ao configurar o webhook.",
      };
    }
  });


export type CompanyMember = {
  id: string;
  fullName: string | null;
  email: string | null;
  roles: string[];
  isActive: boolean;
  availability: string;
  companyId: string | null;
};

export type CompanyInvite = {
  id: string;
  email: string | null;
  role: string;
  status: string;
  createdAt: string;
};

/** Membros e convites de uma empresa (somente super administrador). */
export const listCompanyMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { companyId: string }) => {
    if (!data?.companyId) throw new Error("Empresa inválida.");
    return data;
  })
  .handler(async ({ data, context }): Promise<{ members: CompanyMember[]; invites: CompanyInvite[] }> => {
    await assertPlatformAdmin(context.supabase as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: profiles, error }, { data: invites }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, full_name, email, is_active, availability, company_id")
        .eq("company_id", data.companyId)
        .order("full_name", { ascending: true }),
      supabaseAdmin
        .from("company_invites")
        .select("id, email, role, status, created_at")
        .eq("company_id", data.companyId)
        .order("created_at", { ascending: false }),
    ]);
    if (error) throw new Error(error.message);

    const ids = (profiles ?? []).map((row) => row.id);
    const { data: roleRows } = ids.length
      ? await supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", ids)
      : { data: [] as { user_id: string; role: string }[] };

    const rolesByUser = new Map<string, string[]>();
    for (const row of roleRows ?? []) {
      rolesByUser.set(row.user_id, [...(rolesByUser.get(row.user_id) ?? []), row.role]);
    }

    return {
      members: (profiles ?? []).map((row) => ({
        id: row.id,
        fullName: row.full_name,
        email: row.email,
        roles: rolesByUser.get(row.id) ?? [],
        isActive: row.is_active,
        availability: row.availability,
        companyId: row.company_id,
      })),
      invites: (invites ?? []).map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role,
        status: row.status,
        createdAt: row.created_at,
      })),
    };
  });

/** Cria/convida o administrador (ou consultor) de uma empresa. */
export const inviteCompanyMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { companyId: string; email: string; role?: "ADMIN" | "CONSULTANT" }) => {
    if (!data?.companyId) throw new Error("Empresa inválida.");
    if (!data.email?.trim()) throw new Error("Informe o e-mail.");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("platform_invite_company_member", {
      _company_id: data.companyId,
      _email: data.email.trim(),
      _role: data.role ?? "ADMIN",
    });
    if (error) throw new Error(error.message);
    return result as { linked: boolean; user_id?: string; invite_id?: string };
  });

/** Altera o papel de um membro da empresa. */
export const setCompanyMemberRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { userId: string; companyId: string; role: "ADMIN" | "CONSULTANT" }) => data)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("platform_set_member_role", {
      _user_id: data.userId,
      _company_id: data.companyId,
      _role: data.role,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Remove o vínculo operacional de um usuário com a empresa. */
export const removeCompanyMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { userId: string; companyId: string }) => data)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("platform_remove_company_member", {
      _user_id: data.userId,
      _company_id: data.companyId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Visão geral da plataforma inteira (somente super administrador). */
export const getPlatformOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlatformOverview> => {
    await assertPlatformAdmin(context.supabase as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const iso = startOfDay.toISOString();
    const head = { count: "exact" as const, head: true };

    const [
      companies,
      connections,
      users,
      leadsToday,
      openConversations,
      messagesToday,
      pendingInvites,
      recentCompanies,
    ] = await Promise.all([
      supabaseAdmin.from("companies").select("id, status"),
      supabaseAdmin.from("whatsapp_connections").select("id, status, company_id"),
      supabaseAdmin.from("profiles").select("id", head),
      supabaseAdmin.from("leads").select("id", head).gte("created_at", iso),
      supabaseAdmin
        .from("conversations")
        .select("id", head)
        .not("status", "in", "(CLOSED)"),
      supabaseAdmin.from("messages").select("id", head).gte("created_at", iso),
      supabaseAdmin.from("company_invites").select("id", head).eq("status", "PENDING"),
      supabaseAdmin
        .from("companies")
        .select("id, name, status, created_at")
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    const companyRows = companies.data ?? [];
    const connectionRows = connections.data ?? [];
    const perCompany = new Map<string, number>();
    for (const row of connectionRows) {
      perCompany.set(row.company_id, (perCompany.get(row.company_id) ?? 0) + 1);
    }

    return {
      companies: companyRows.length,
      activeCompanies: companyRows.filter((c) => c.status === "ACTIVE").length,
      instances: connectionRows.length,
      connectedInstances: connectionRows.filter((c) => c.status === "CONNECTED").length,
      availableInstances: connectionRows.filter((c) => c.status === "AVAILABLE").length,
      users: users.count ?? 0,
      leadsToday: leadsToday.count ?? 0,
      openConversations: openConversations.count ?? 0,
      messagesToday: messagesToday.count ?? 0,
      pendingInvites: pendingInvites.count ?? 0,
      recentCompanies: (recentCompanies.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        createdAt: row.created_at,
        instanceCount: perCompany.get(row.id) ?? 0,
      })),
    };
  });
