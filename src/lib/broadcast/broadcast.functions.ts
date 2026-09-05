/**
 * Módulo Disparos — funções de servidor.
 * Toda operação exige administrador da empresa (ou administrador da plataforma);
 * a RLS do banco repete a mesma regra, então esconder botões nunca é a proteção.
 */
import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PhoneNormalizationService } from "@/lib/nexa/phone";

type Ctx = { supabase: any; userId: string };

async function requireAdmin(context: Ctx): Promise<{ companyId: string; userName: string | null }> {
  const [{ data: isAdmin }, { data: isPlatformAdmin }] = await Promise.all([
    context.supabase.rpc("is_company_admin"),
    context.supabase.rpc("is_platform_admin"),
  ]);
  if (!isAdmin && !isPlatformAdmin) {
    throw new Error("Somente administradores podem usar o módulo de Disparos.");
  }
  const { data: profile } = await context.supabase
    .from("profiles")
    .select("company_id, full_name, email")
    .eq("id", context.userId)
    .maybeSingle();
  if (!profile?.company_id) throw new Error("Usuário sem empresa.");
  return { companyId: profile.company_id as string, userName: profile.full_name ?? profile.email ?? null };
}

async function log(
  context: Ctx,
  companyId: string,
  userName: string | null,
  action: string,
  campaignId: string | null,
  metadata: Record<string, unknown> = {},
) {
  await context.supabase.from("broadcast_logs").insert({
    company_id: companyId,
    campaign_id: campaignId,
    user_id: context.userId,
    user_name: userName,
    action,
    metadata,
  });
}

const DEFAULT_SETTINGS = {
  messages_per_minute: 5,
  min_interval_seconds: 10,
  max_interval_seconds: 25,
  hourly_limit: 120,
  daily_limit: 200,
  window_start: "08:00",
  window_end: "20:00",
  timezone: "America/Sao_Paulo",
  max_consecutive_failures: 5,
  auto_resume: true,
  emergency_stop: false,
};

/* ------------------------------------------------------------------ */
/* Configurações                                                       */
/* ------------------------------------------------------------------ */

export const getBroadcastSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { companyId } = await requireAdmin(context as unknown as Ctx);
    const { data } = await context.supabase
      .from("broadcast_settings")
      .select("*")
      .eq("company_id", companyId)
      .maybeSingle();
    return { ...DEFAULT_SETTINGS, ...(data ?? {}), company_id: companyId };
  });

export const saveBroadcastSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: Partial<typeof DEFAULT_SETTINGS>) => data)
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { companyId, userName } = await requireAdmin(ctx);
    const { error } = await ctx.supabase
      .from("broadcast_settings")
      .upsert({ ...DEFAULT_SETTINGS, ...data, company_id: companyId }, { onConflict: "company_id" });
    if (error) throw new Error(error.message);
    await log(ctx, companyId, userName, "SETTINGS_UPDATED", null, data as Record<string, unknown>);
    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* Instâncias                                                          */
/* ------------------------------------------------------------------ */

export const listBroadcastInstances = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    await requireAdmin(ctx);
    const { data, error } = await ctx.supabase
      .from("whatsapp_connections")
      .select(
        "id, name, instance_number, is_trunk, connection_type, status, phone_number, qr_code, last_connected_at",
      )
      .order("is_trunk", { ascending: false })
      .order("instance_number", { ascending: true });
    if (error) throw new Error(error.message);

    const ids = (data ?? []).map((row: { id: string }) => row.id);
    const stats: Record<string, { sent: number; failed: number; campaigns: number }> = {};
    if (ids.length) {
      const { data: queue } = await ctx.supabase
        .from("broadcast_queue")
        .select("instance_id, status")
        .in("instance_id", ids);
      for (const row of queue ?? []) {
        const key = row.instance_id as string;
        stats[key] = stats[key] ?? { sent: 0, failed: 0, campaigns: 0 };
        if (row.status === "SENT") stats[key].sent += 1;
        if (row.status === "FAILED") stats[key].failed += 1;
      }
      const { data: camps } = await ctx.supabase
        .from("broadcast_campaigns")
        .select("instance_id")
        .in("instance_id", ids);
      for (const row of camps ?? []) {
        const key = row.instance_id as string;
        stats[key] = stats[key] ?? { sent: 0, failed: 0, campaigns: 0 };
        stats[key].campaigns += 1;
      }
    }

    return (data ?? []).map((row: Record<string, unknown>) => ({
      id: row["id"] as string,
      name: (row["name"] as string | null) ?? null,
      instanceNumber: (row["instance_number"] as number | null) ?? null,
      isTrunk: Boolean(row["is_trunk"]),
      connectionType: row["connection_type"] as "TRUNK" | "BROADCAST",
      status: row["status"] as string,
      phoneNumber: (row["phone_number"] as string | null) ?? null,
      qrCode: (row["qr_code"] as string | null) ?? null,
      lastConnectedAt: (row["last_connected_at"] as string | null) ?? null,
      sent: stats[row["id"] as string]?.sent ?? 0,
      failed: stats[row["id"] as string]?.failed ?? 0,
      campaigns: stats[row["id"] as string]?.campaigns ?? 0,
    }));
  });

/** Marca/desmarca uma conexão como instância de disparo. Tronco nunca pode. */
export const setInstanceConnectionType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { connectionId: string; type: "TRUNK" | "BROADCAST" }) => data)
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { companyId, userName } = await requireAdmin(ctx);

    const { data: conn } = await ctx.supabase
      .from("whatsapp_connections")
      .select("id, is_trunk")
      .eq("id", data.connectionId)
      .maybeSingle();
    if (!conn) throw new Error("Instância inexistente.");
    if (conn.is_trunk && data.type === "BROADCAST") {
      throw new Error("A instância tronco é de uso exclusivo do atendimento.");
    }

    const { error } = await ctx.supabase
      .from("whatsapp_connections")
      .update({ connection_type: data.type })
      .eq("id", data.connectionId);
    if (error) throw new Error(error.message);

    await log(ctx, companyId, userName, "INSTANCE_TYPE_CHANGED", null, {
      instancia: data.connectionId,
      tipo: data.type,
    });
    return { ok: true };
  });

export const connectBroadcastInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { connectionId: string }) => data)
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await requireAdmin(ctx);
    const { data: conn } = await ctx.supabase
      .from("whatsapp_connections")
      .select("id, connection_type")
      .eq("id", data.connectionId)
      .maybeSingle();
    if (!conn) throw new Error("Instância inexistente.");
    if (conn.connection_type !== "BROADCAST") throw new Error("Esta instância não é de disparo.");
    const { requestQrCode } = await import("@/lib/whatsapp/actions.server");
    return requestQrCode(data.connectionId);
  });

export const refreshBroadcastInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { connectionId: string }) => data)
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await requireAdmin(ctx);
    const { data: conn } = await ctx.supabase
      .from("whatsapp_connections")
      .select("id")
      .eq("id", data.connectionId)
      .maybeSingle();
    if (!conn) throw new Error("Instância inexistente.");
    const { syncInstanceStatus } = await import("@/lib/whatsapp/actions.server");
    return syncInstanceStatus(data.connectionId);
  });

export const disconnectBroadcastInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { connectionId: string }) => data)
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { companyId, userName } = await requireAdmin(ctx);
    const { data: conn } = await ctx.supabase
      .from("whatsapp_connections")
      .select("id, connection_type")
      .eq("id", data.connectionId)
      .maybeSingle();
    if (!conn) throw new Error("Instância inexistente.");
    if (conn.connection_type !== "BROADCAST") throw new Error("Esta instância não é de disparo.");
    const { logoutInstance } = await import("@/lib/whatsapp/actions.server");
    const result = await logoutInstance(data.connectionId);
    await log(ctx, companyId, userName, "INSTANCE_DISCONNECTED", null, { instancia: data.connectionId });
    return { ok: result.ok, error: result.error ?? null };
  });

/* ------------------------------------------------------------------ */
/* Contatos                                                            */
/* ------------------------------------------------------------------ */

export type BroadcastContactInput = {
  id?: string;
  name?: string | null;
  phone: string;
  companyName?: string | null;
  tags?: string[];
  source?: string | null;
  note?: string | null;
  status?: "ATIVO" | "PAUSADO" | "BLOQUEADO" | "DESCADASTRADO";
  optIn?: boolean;
  optInSource?: string | null;
};

export const listBroadcastContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { search?: string; status?: string; tag?: string; optIn?: boolean }) => data ?? {})
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { companyId } = await requireAdmin(ctx);
    let query = ctx.supabase
      .from("broadcast_contacts")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(1000);

    if (data.status) query = query.eq("status", data.status);
    if (typeof data.optIn === "boolean") query = query.eq("opt_in", data.optIn);
    if (data.tag) query = query.contains("tags", [data.tag]);
    if (data.search?.trim()) {
      const term = data.search.trim();
      const digits = term.replace(/\D/g, "");
      const parts = [`name.ilike.%${term}%`, `company_name.ilike.%${term}%`];
      if (digits) parts.push(`whatsapp.ilike.%${digits}%`, `phone.ilike.%${digits}%`);
      query = query.or(parts.join(","));
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const saveBroadcastContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: BroadcastContactInput) => {
    if (!data.phone?.trim()) throw new Error("Informe o telefone.");
    return data;
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { companyId } = await requireAdmin(ctx);
    const whatsapp = PhoneNormalizationService.normalize(data.phone);
    if (!whatsapp) throw new Error("Telefone inválido.");

    const payload = {
      company_id: companyId,
      name: data.name ?? null,
      phone: whatsapp,
      whatsapp,
      company_name: data.companyName ?? null,
      tags: data.tags ?? [],
      source: data.source ?? "manual",
      note: data.note ?? null,
      status: data.status ?? "ATIVO",
      opt_in: data.optIn ?? false,
      opt_in_source: data.optInSource ?? null,
      created_by: ctx.userId,
    };

    if (data.id) {
      const { error } = await ctx.supabase
        .from("broadcast_contacts")
        .update(payload)
        .eq("id", data.id)
        .eq("company_id", companyId);
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    }

    const { data: row, error } = await ctx.supabase
      .from("broadcast_contacts")
      .upsert(payload, { onConflict: "company_id,whatsapp" })
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { ok: true, id: row?.id as string };
  });

export const importBroadcastContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { rows: BroadcastContactInput[] }) => data)
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { companyId, userName } = await requireAdmin(ctx);

    const seen = new Set<string>();
    const payload: Record<string, unknown>[] = [];
    let invalid = 0;
    for (const row of data.rows.slice(0, 5000)) {
      const whatsapp = PhoneNormalizationService.normalize(row.phone);
      if (!whatsapp || seen.has(whatsapp)) {
        if (!whatsapp) invalid += 1;
        continue;
      }
      seen.add(whatsapp);
      payload.push({
        company_id: companyId,
        name: row.name ?? null,
        phone: whatsapp,
        whatsapp,
        company_name: row.companyName ?? null,
        tags: row.tags ?? [],
        source: row.source ?? "importacao",
        note: row.note ?? null,
        status: row.status ?? "ATIVO",
        opt_in: row.optIn ?? false,
        opt_in_source: row.optInSource ?? null,
        created_by: ctx.userId,
      });
    }
    if (!payload.length) return { imported: 0, invalid };

    const { error } = await ctx.supabase
      .from("broadcast_contacts")
      .upsert(payload, { onConflict: "company_id,whatsapp" });
    if (error) throw new Error(error.message);

    await log(ctx, companyId, userName, "CONTACTS_IMPORTED", null, { total: payload.length, invalidos: invalid });
    return { imported: payload.length, invalid };
  });

export const deleteBroadcastContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ids: string[] }) => data)
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { companyId } = await requireAdmin(ctx);
    const { error } = await ctx.supabase
      .from("broadcast_contacts")
      .delete()
      .eq("company_id", companyId)
      .in("id", data.ids);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* Mensagens                                                           */
/* ------------------------------------------------------------------ */

export const listBroadcastMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    const { companyId } = await requireAdmin(ctx);
    const { data, error } = await ctx.supabase
      .from("broadcast_messages")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const ALLOWED_VARIABLES = ["nome", "primeiro_nome"];

export function validateTemplate(content: string): string[] {
  const found = [...content.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map((m) => m[1]?.toLowerCase() ?? "");
  return [...new Set(found.filter((name) => !ALLOWED_VARIABLES.includes(name)))];
}

export const saveBroadcastMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id?: string; name: string; content: string; status?: string }) => {
    if (!data.name?.trim()) throw new Error("Informe o nome interno da mensagem.");
    if (!data.content?.trim()) throw new Error("Informe o texto da mensagem.");
    const unknown = validateTemplate(data.content);
    if (unknown.length) {
      throw new Error(
        `Variáveis não suportadas: ${unknown.map((v) => `{{${v}}}`).join(", ")}. Use apenas {{nome}} e {{primeiro_nome}}.`,
      );
    }
    return data;
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { companyId } = await requireAdmin(ctx);
    const payload = {
      company_id: companyId,
      name: data.name.trim(),
      content: data.content,
      status: data.status ?? "ACTIVE",
      created_by: ctx.userId,
    };
    if (data.id) {
      const { error } = await ctx.supabase
        .from("broadcast_messages")
        .update(payload)
        .eq("id", data.id)
        .eq("company_id", companyId);
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    }
    const { data: row, error } = await ctx.supabase
      .from("broadcast_messages")
      .insert(payload)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { ok: true, id: row?.id as string };
  });

export const deleteBroadcastMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { companyId } = await requireAdmin(ctx);
    const { error } = await ctx.supabase
      .from("broadcast_messages")
      .delete()
      .eq("id", data.id)
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* Campanhas                                                           */
/* ------------------------------------------------------------------ */

export type CampaignInput = {
  id?: string;
  name: string;
  instanceId: string;
  messageId: string;
  contactIds: string[];
  requireOptIn?: boolean;
  messagesPerMinute?: number;
  minIntervalSeconds?: number;
  maxIntervalSeconds?: number;
  dailyLimit?: number;
  campaignLimit?: number | null;
  windowStart?: string;
  windowEnd?: string;
  maxConsecutiveFailures?: number;
  autoResume?: boolean;
  scheduledAt?: string | null;
};

export const listBroadcastCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    const { companyId } = await requireAdmin(ctx);
    const { data: campaigns, error } = await ctx.supabase
      .from("broadcast_campaigns")
      .select("*, instance:whatsapp_connections(id, name, status), message:broadcast_messages(id, name)")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const ids = (campaigns ?? []).map((c: { id: string }) => c.id);
    const totals: Record<string, { total: number; sent: number; pending: number; failed: number }> = {};
    if (ids.length) {
      const { data: queue } = await ctx.supabase
        .from("broadcast_queue")
        .select("campaign_id, status")
        .in("campaign_id", ids);
      for (const row of queue ?? []) {
        const key = row.campaign_id as string;
        totals[key] = totals[key] ?? { total: 0, sent: 0, pending: 0, failed: 0 };
        totals[key].total += 1;
        if (row.status === "SENT") totals[key].sent += 1;
        else if (row.status === "PENDING" || row.status === "PROCESSING") totals[key].pending += 1;
        else if (row.status === "FAILED") totals[key].failed += 1;
      }
      const { data: audience } = await ctx.supabase
        .from("broadcast_campaign_contacts")
        .select("campaign_id")
        .in("campaign_id", ids);
      for (const row of audience ?? []) {
        const key = row.campaign_id as string;
        totals[key] = totals[key] ?? { total: 0, sent: 0, pending: 0, failed: 0 };
      }
    }

    const { data: audienceRows } = ids.length
      ? await ctx.supabase.from("broadcast_campaign_contacts").select("campaign_id").in("campaign_id", ids)
      : { data: [] as { campaign_id: string }[] };
    const audienceCount: Record<string, number> = {};
    for (const row of audienceRows ?? []) {
      audienceCount[row.campaign_id] = (audienceCount[row.campaign_id] ?? 0) + 1;
    }

    return (campaigns ?? []).map((c: Record<string, any>) => ({
      ...c,
      audience: audienceCount[c["id"] as string] ?? 0,
      stats: totals[c["id"] as string] ?? { total: 0, sent: 0, pending: 0, failed: 0 },
    }));
  });

export const saveBroadcastCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: CampaignInput) => {
    if (!data.name?.trim()) throw new Error("Informe o nome da campanha.");
    if (!data.instanceId) throw new Error("Selecione a instância de disparo.");
    if (!data.messageId) throw new Error("Selecione a mensagem.");
    if (!data.contactIds?.length) throw new Error("Selecione pelo menos um contato.");
    return data;
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { companyId, userName } = await requireAdmin(ctx);

    // Proteção da instância tronco também no backend (o banco recusa de novo).
    const { data: conn } = await ctx.supabase
      .from("whatsapp_connections")
      .select("id, is_trunk, connection_type, company_id")
      .eq("id", data.instanceId)
      .maybeSingle();
    if (!conn || conn.company_id !== companyId) throw new Error("Instância inválida.");
    if (conn.is_trunk || conn.connection_type !== "BROADCAST") {
      throw new Error("A instância tronco é exclusiva do atendimento e não pode ser usada em disparos.");
    }

    const payload = {
      company_id: companyId,
      name: data.name.trim(),
      instance_id: data.instanceId,
      message_id: data.messageId,
      require_opt_in: data.requireOptIn ?? false,
      messages_per_minute: data.messagesPerMinute ?? 5,
      min_interval_seconds: data.minIntervalSeconds ?? 10,
      max_interval_seconds: data.maxIntervalSeconds ?? 25,
      daily_limit: data.dailyLimit ?? 200,
      campaign_limit: data.campaignLimit ?? null,
      window_start: data.windowStart ?? "08:00",
      window_end: data.windowEnd ?? "20:00",
      max_consecutive_failures: data.maxConsecutiveFailures ?? 5,
      auto_resume: data.autoResume ?? true,
      scheduled_at: data.scheduledAt ?? null,
      created_by: ctx.userId,
    };

    let campaignId = data.id ?? null;
    if (campaignId) {
      const { error } = await ctx.supabase
        .from("broadcast_campaigns")
        .update(payload)
        .eq("id", campaignId)
        .eq("company_id", companyId);
      if (error) throw new Error(error.message);
      await ctx.supabase.from("broadcast_campaign_contacts").delete().eq("campaign_id", campaignId);
    } else {
      const { data: row, error } = await ctx.supabase
        .from("broadcast_campaigns")
        .insert({ ...payload, status: "DRAFT" })
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      campaignId = row?.id as string;
    }

    const links = data.contactIds.map((contactId) => ({
      company_id: companyId,
      campaign_id: campaignId,
      contact_id: contactId,
    }));
    const { error: linkError } = await ctx.supabase
      .from("broadcast_campaign_contacts")
      .upsert(links, { onConflict: "campaign_id,contact_id" });
    if (linkError) throw new Error(linkError.message);

    await log(ctx, companyId, userName, data.id ? "CAMPAIGN_UPDATED" : "CAMPAIGN_CREATED", campaignId, {
      contatos: data.contactIds.length,
    });
    return { ok: true, id: campaignId as string };
  });

async function setCampaignStatus(
  ctx: Ctx,
  companyId: string,
  userName: string | null,
  campaignId: string,
  status: string,
  action: string,
  extra: Record<string, unknown> = {},
) {
  const { error } = await ctx.supabase
    .from("broadcast_campaigns")
    .update({ status, last_activity_at: new Date().toISOString(), ...extra })
    .eq("id", campaignId)
    .eq("company_id", companyId);
  if (error) throw new Error(error.message);
  await log(ctx, companyId, userName, action, campaignId);
  return { ok: true };
}

export const startBroadcastCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { campaignId: string; scheduledAt?: string | null }) => data)
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { companyId, userName } = await requireAdmin(ctx);

    const { data: campaign } = await ctx.supabase
      .from("broadcast_campaigns")
      .select("id, instance_id, message_id, status")
      .eq("id", data.campaignId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!campaign) throw new Error("Campanha inexistente.");
    if (!campaign.instance_id || !campaign.message_id) {
      throw new Error("Complete a instância e a mensagem antes de iniciar.");
    }

    // A parada de emergência precisa ser liberada antes de qualquer novo envio.
    const { data: settings } = await ctx.supabase
      .from("broadcast_settings")
      .select("emergency_stop")
      .eq("company_id", companyId)
      .maybeSingle();
    if (settings?.emergency_stop) {
      throw new Error("Os disparos estão bloqueados pela parada de emergência. Libere em Configurações.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: enqueued, error: enqueueError } = await supabaseAdmin.rpc("broadcast_enqueue_campaign", {
      _campaign_id: data.campaignId,
    });
    if (enqueueError) throw new Error(enqueueError.message);

    const scheduled = data.scheduledAt ?? null;
    await setCampaignStatus(
      ctx,
      companyId,
      userName,
      data.campaignId,
      scheduled ? "SCHEDULED" : "RUNNING",
      scheduled ? "CAMPAIGN_SCHEDULED" : "CAMPAIGN_STARTED",
      {
        scheduled_at: scheduled,
        started_at: scheduled ? null : new Date().toISOString(),
        next_send_at: null,
        pause_reason: null,
        consecutive_failures: 0,
        finished_at: null,
      },
    );

    return { ok: true, enqueued: Number(enqueued ?? 0) };
  });

export const pauseBroadcastCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { campaignId: string }) => data)
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { companyId, userName } = await requireAdmin(ctx);
    return setCampaignStatus(ctx, companyId, userName, data.campaignId, "PAUSED", "CAMPAIGN_PAUSED", {
      pause_reason: "A campanha foi pausada pelo administrador.",
    });
  });

export const resumeBroadcastCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { campaignId: string }) => data)
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { companyId, userName } = await requireAdmin(ctx);
    return setCampaignStatus(ctx, companyId, userName, data.campaignId, "RUNNING", "CAMPAIGN_RESUMED", {
      pause_reason: null,
      consecutive_failures: 0,
      next_send_at: null,
    });
  });

export const cancelBroadcastCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { campaignId: string }) => data)
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { companyId, userName } = await requireAdmin(ctx);
    await ctx.supabase
      .from("broadcast_queue")
      .update({ status: "CANCELLED", error_message: "Campanha cancelada." })
      .eq("campaign_id", data.campaignId)
      .eq("company_id", companyId)
      .in("status", ["PENDING", "PROCESSING"]);
    return setCampaignStatus(ctx, companyId, userName, data.campaignId, "CANCELLED", "CAMPAIGN_CANCELLED", {
      finished_at: new Date().toISOString(),
    });
  });

export const duplicateBroadcastCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { campaignId: string }) => data)
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { companyId, userName } = await requireAdmin(ctx);
    const { data: original } = await ctx.supabase
      .from("broadcast_campaigns")
      .select("*")
      .eq("id", data.campaignId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!original) throw new Error("Campanha inexistente.");

    const copy = { ...original } as Record<string, unknown>;
    delete copy["id"];
    delete copy["created_at"];
    delete copy["updated_at"];
    Object.assign(copy, {
      name: `${original.name} (cópia)`,
      status: "DRAFT",
      started_at: null,
      finished_at: null,
      next_send_at: null,
      last_activity_at: null,
      consecutive_failures: 0,
      pause_reason: null,
      scheduled_at: null,
      created_by: ctx.userId,
    });

    const { data: row, error } = await ctx.supabase
      .from("broadcast_campaigns")
      .insert(copy)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);

    const { data: contacts } = await ctx.supabase
      .from("broadcast_campaign_contacts")
      .select("contact_id")
      .eq("campaign_id", data.campaignId);
    if (contacts?.length) {
      await ctx.supabase.from("broadcast_campaign_contacts").insert(
        contacts.map((c: { contact_id: string }) => ({
          company_id: companyId,
          campaign_id: row?.id,
          contact_id: c.contact_id,
        })),
      );
    }

    await log(ctx, companyId, userName, "CAMPAIGN_DUPLICATED", row?.id as string);
    return { ok: true, id: row?.id as string };
  });

export const stopAllBroadcasts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    await requireAdmin(ctx);
    const { data, error } = await ctx.supabase.rpc("broadcast_emergency_stop");
    if (error) throw new Error(error.message);
    return { cancelled: Number(data ?? 0) };
  });

export const releaseEmergencyStop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    const { companyId, userName } = await requireAdmin(ctx);
    const { error } = await ctx.supabase
      .from("broadcast_settings")
      .upsert({ ...DEFAULT_SETTINGS, company_id: companyId, emergency_stop: false }, { onConflict: "company_id" });
    if (error) throw new Error(error.message);
    await log(ctx, companyId, userName, "EMERGENCY_STOP_RELEASED", null);
    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* Histórico e visão geral                                             */
/* ------------------------------------------------------------------ */

export const listBroadcastHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { campaignId?: string; status?: string; instanceId?: string; days?: number; search?: string }) =>
      data ?? {},
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { companyId } = await requireAdmin(ctx);
    let query = ctx.supabase
      .from("broadcast_queue")
      .select(
        "id, status, scheduled_at, sent_at, attempts, error_message, provider_message_id, created_at, campaign:broadcast_campaigns(id, name), contact:broadcast_contacts(id, name, whatsapp), instance:whatsapp_connections(id, name)",
      )
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(500);

    if (data.campaignId) query = query.eq("campaign_id", data.campaignId);
    if (data.status) query = query.eq("status", data.status);
    if (data.instanceId) query = query.eq("instance_id", data.instanceId);
    if (data.days) {
      query = query.gte("created_at", new Date(Date.now() - data.days * 86_400_000).toISOString());
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getBroadcastOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    const { companyId } = await requireAdmin(ctx);

    const [{ data: campaigns }, { data: queue }, { data: contacts }, { data: settings }, { data: instances }] =
      await Promise.all([
        ctx.supabase.from("broadcast_campaigns").select("id, name, status, last_activity_at, instance_id").eq("company_id", companyId),
        ctx.supabase.from("broadcast_queue").select("status, sent_at, created_at").eq("company_id", companyId).limit(20000),
        ctx.supabase.from("broadcast_contacts").select("id, status").eq("company_id", companyId),
        ctx.supabase.from("broadcast_settings").select("*").eq("company_id", companyId).maybeSingle(),
        ctx.supabase
          .from("whatsapp_connections")
          .select("id, name, status, connection_type, phone_number")
          .eq("connection_type", "BROADCAST"),
      ]);

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const rows = queue ?? [];
    const sentToday = rows.filter(
      (r: { status: string; sent_at: string | null }) =>
        r.status === "SENT" && r.sent_at && new Date(r.sent_at) >= startOfDay,
    ).length;
    const lastSent = rows
      .filter((r: { sent_at: string | null }) => r.sent_at)
      .map((r: { sent_at: string }) => r.sent_at)
      .sort()
      .pop();

    const byStatus = (status: string) => (campaigns ?? []).filter((c: { status: string }) => c.status === status).length;

    return {
      campaigns: {
        running: byStatus("RUNNING") + byStatus("SCHEDULED"),
        paused: byStatus("PAUSED"),
        completed: byStatus("COMPLETED"),
        total: (campaigns ?? []).length,
      },
      contacts: {
        total: (contacts ?? []).length,
        active: (contacts ?? []).filter((c: { status: string }) => c.status === "ATIVO").length,
      },
      messages: {
        sentToday,
        pending: rows.filter((r: { status: string }) => r.status === "PENDING" || r.status === "PROCESSING").length,
        failed: rows.filter((r: { status: string }) => r.status === "FAILED").length,
        sentTotal: rows.filter((r: { status: string }) => r.status === "SENT").length,
        total: rows.length,
      },
      lastSentAt: (lastSent as string | undefined) ?? null,
      settings: { ...DEFAULT_SETTINGS, ...(settings ?? {}) },
      instances: (instances ?? []).map((i: Record<string, unknown>) => ({
        id: i["id"] as string,
        name: (i["name"] as string | null) ?? null,
        status: i["status"] as string,
        phoneNumber: (i["phone_number"] as string | null) ?? null,
      })),
    };
  });

export const listBroadcastLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    const { companyId } = await requireAdmin(ctx);
    const { data, error } = await ctx.supabase
      .from("broadcast_logs")
      .select("*, campaign:broadcast_campaigns(id, name)")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
