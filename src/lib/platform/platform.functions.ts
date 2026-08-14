import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PlatformCompany = {
  id: string;
  name: string;
  legalName: string | null;
  document: string | null;
  status: string;
  instanceCount: number;
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


/**
 * URL CENTRAL do webhook (super administrador).
 * A mesma URL serve todas as instâncias — a MEGA envia a instance_key no payload.
 */
export const getPlatformWebhookUrl = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context.supabase as never);
    const { getRequest } = await import("@tanstack/react-start/server");
    const origin = new URL(getRequest().url).origin;
    return { url: `${origin}/api/public/whatsapp/webhook` };
  });

/** Configura o webhook central na MEGA para uma instância (super administrador). */
export const configurePlatformWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { connectionId: string }) => data)
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context.supabase as never);
    const { getRequest } = await import("@tanstack/react-start/server");
    const url = `${new URL(getRequest().url).origin}/api/public/whatsapp/webhook`;

    const { readInstanceWebhook, writeInstanceWebhook } = await import(
      "@/lib/whatsapp/actions.server"
    );
    const applied = await writeInstanceWebhook(data.connectionId, url);
    if (!applied.ok) throw new Error(applied.error ?? "Falha ao configurar o webhook.");
    const current = await readInstanceWebhook(data.connectionId);
    return { ok: true, url, current: current.url ?? null };
  });
