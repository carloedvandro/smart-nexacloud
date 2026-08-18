import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type WhatsAppInstance = {
  id: string;
  name: string | null;
  instanceNumber: number | null;
  isTrunk: boolean;
  status: string;
  phoneNumber: string | null;
  qrCode: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  assignedAt: string | null;
  lastConnectedAt: string | null;
  lastEventAt: string | null;
  hasCredentials: boolean;
};

/** Lista as instâncias contratadas pela empresa. Nunca devolve a instance_key. */
export const listWhatsAppInstances = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WhatsAppInstance[]> => {
    const { data, error } = await context.supabase
      .from("whatsapp_connections")
      .select(
        "id, name, instance_number, is_trunk, status, phone_number, qr_code, user_id, assigned_at, last_connected_at, last_event_at, profile:profiles!whatsapp_connections_user_id_fkey(full_name, email)",
      )
      .order("is_trunk", { ascending: false })
      .order("instance_number", { ascending: true });

    if (error) throw new Error(error.message);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ids = (data ?? []).map((row) => row.id);
    const { data: creds } = ids.length
      ? await supabaseAdmin.from("whatsapp_credentials").select("connection_id").in("connection_id", ids)
      : { data: [] as { connection_id: string }[] };
    const withCreds = new Set((creds ?? []).map((row) => row.connection_id));

    return (data ?? []).map((row) => {
      const profile = row.profile as { full_name: string | null; email: string | null } | null;
      return {
        id: row.id,
        name: row.name,
        instanceNumber: row.instance_number,
        isTrunk: row.is_trunk,
        status: row.status,
        phoneNumber: row.phone_number,
        qrCode: row.qr_code,
        assignedUserId: row.user_id,
        assignedUserName: profile?.full_name ?? profile?.email ?? null,
        assignedAt: row.assigned_at,
        lastConnectedAt: row.last_connected_at,
        lastEventAt: row.last_event_at,
        hasCredentials: withCreds.has(row.id),
      };
    });
  });

/** Define a instância tronco (número principal) da empresa — somente administrador da empresa. */
export const setTrunkWhatsAppInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { connectionId: string }) => data)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("set_trunk_whatsapp_instance", {
      _connection_id: data.connectionId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });


/** Histórico de vinculações de uma instância (quem usou, qual número, quando). */
export const listInstanceHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { connectionId: string }) => data)
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("whatsapp_instance_assignments")
      .select("id, user_name, phone_number, started_at, ended_at, release_reason")
      .eq("connection_id", data.connectionId)
      .order("started_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/** Provisionamento manual — somente administrador da plataforma. */
export const provisionWhatsAppInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { instanceKey: string; name?: string; instanceNumber?: number }) => {
    if (!data.instanceKey?.trim()) throw new Error("Informe a instance_key.");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("company_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (!profile?.company_id) throw new Error("Usuário sem empresa.");

    const { data: id, error } = await context.supabase.rpc("provision_whatsapp_instance", {
      _company_id: profile.company_id,
      _instance_key: data.instanceKey.trim(),
      ...(data.name ? { _name: data.name } : {}),
      ...(typeof data.instanceNumber === "number" ? { _instance_number: data.instanceNumber } : {}),
    });
    if (error) throw new Error(error.message);
    return { id: id as string };
  });

/** Colaboradores elegíveis para vincular a uma instância (da empresa dona da instância). */
export const listInstanceCandidates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { connectionId: string }) => {
    if (!data?.connectionId) throw new Error("Instância inválida.");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { data: connection, error: connError } = await context.supabase
      .from("whatsapp_connections")
      .select("company_id")
      .eq("id", data.connectionId)
      .maybeSingle();
    if (connError) throw new Error(connError.message);
    if (!connection) throw new Error("Instância inexistente.");

    const { data: rows, error } = await context.supabase
      .from("profiles")
      .select("id, full_name, email, availability, is_active")
      .eq("company_id", connection.company_id)
      .eq("is_active", true)
      .order("full_name", { ascending: true });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((row) => ({
      id: row.id,
      fullName: row.full_name,
      email: row.email,
      availability: row.availability as string,
    }));
  });

/** Vincula um colaborador a uma instância disponível. */

export const assignWhatsAppInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { connectionId: string; userId: string }) => data)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("assign_whatsapp_instance", {
      _connection_id: data.connectionId,
      _user_id: data.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Libera a instância: logout na MEGA, encerra o vínculo e preserva o histórico. */
export const releaseWhatsAppInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { connectionId: string; reason?: string }) => data)
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_company_admin");
    const { data: isPlatformAdmin } = await context.supabase.rpc("is_platform_admin");
    if (!isAdmin && !isPlatformAdmin) {
      throw new Error("Somente administradores podem liberar instâncias.");
    }

    const { data: connection } = await context.supabase
      .from("whatsapp_connections")
      .select("id")
      .eq("id", data.connectionId)
      .maybeSingle();
    if (!connection) throw new Error("Instância inexistente.");

    const { logoutInstance } = await import("@/lib/whatsapp/actions.server");
    const logout = await logoutInstance(data.connectionId);

    const { error } = await context.supabase.rpc("release_whatsapp_instance", {
      _connection_id: data.connectionId,
      ...(data.reason ? { _reason: data.reason } : {}),
    });
    if (error) throw new Error(error.message);

    return { ok: true, logout: logout.ok, logoutError: logout.error ?? null };
  });

/** Gera o QR Code para o colaborador vinculado conectar o WhatsApp. */
export const connectWhatsAppInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { connectionId: string }) => data)
  .handler(async ({ data, context }) => {
    const { data: connection } = await context.supabase
      .from("whatsapp_connections")
      .select("id, user_id, status")
      .eq("id", data.connectionId)
      .maybeSingle();
    if (!connection) throw new Error("Instância inexistente.");
    if (!connection.user_id) throw new Error("Vincule um colaborador antes de conectar.");

    const { data: isAdmin } = await context.supabase.rpc("is_company_admin");
    if (!isAdmin && connection.user_id !== context.userId) {
      throw new Error("Somente o colaborador vinculado ou um administrador pode conectar.");
    }

    const { requestQrCode } = await import("@/lib/whatsapp/actions.server");
    return requestQrCode(data.connectionId);
  });

/** Sincroniza a situação real da instância e o número conectado. */
export const refreshWhatsAppInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { connectionId: string }) => data)
  .handler(async ({ data, context }) => {
    const { data: connection } = await context.supabase
      .from("whatsapp_connections")
      .select("id")
      .eq("id", data.connectionId)
      .maybeSingle();
    if (!connection) throw new Error("Instância inexistente.");

    const { syncInstanceStatus } = await import("@/lib/whatsapp/actions.server");
    return syncInstanceStatus(data.connectionId);
  });

/** URL do webhook da instância — visível apenas para administradores. */
export const getWhatsAppWebhookUrl = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isPlatformAdmin } = await context.supabase.rpc("is_platform_admin");
    if (!isPlatformAdmin) throw new Error("Acesso restrito ao administrador da plataforma.");

    const { getRequest } = await import("@tanstack/react-start/server");
    const origin = new URL(getRequest().url).origin;
    return { url: `${origin}/api/public/whatsapp/webhook` };
  });

/** Consulta o webhook configurado na MEGA para a instância (administradores). */
export const getInstanceWebhookConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { connectionId: string }) => data)
  .handler(async ({ data, context }) => {
    const { data: isPlatformAdmin } = await context.supabase.rpc("is_platform_admin");
    if (!isPlatformAdmin) throw new Error("Acesso restrito ao administrador da plataforma.");

    const { data: connection } = await context.supabase
      .from("whatsapp_connections")
      .select("id")
      .eq("id", data.connectionId)
      .maybeSingle();
    if (!connection) throw new Error("Instância inexistente.");

    const { readInstanceWebhook } = await import("@/lib/whatsapp/actions.server");
    return readInstanceWebhook(data.connectionId);
  });

/** Configura o webhook central na MEGA para a instância (administradores). */
export const configureInstanceWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { connectionId: string }) => data)
  .handler(async ({ data, context }) => {
    const { data: isPlatformAdmin } = await context.supabase.rpc("is_platform_admin");
    if (!isPlatformAdmin) throw new Error("Acesso restrito ao administrador da plataforma.");

    const { data: connection } = await context.supabase
      .from("whatsapp_connections")
      .select("id")
      .eq("id", data.connectionId)
      .maybeSingle();
    if (!connection) throw new Error("Instância inexistente.");

    const { getRequest } = await import("@tanstack/react-start/server");
    const url = `${new URL(getRequest().url).origin}/api/public/whatsapp/webhook`;

    const { writeInstanceWebhook } = await import("@/lib/whatsapp/actions.server");
    const result = await writeInstanceWebhook(data.connectionId, url);
    if (!result.ok) throw new Error(result.error ?? "Falha ao configurar o webhook.");
    return { ok: true, url };
  });

/** Envio de mensagem pelo painel via WhatsApp. */
export const sendWhatsAppMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { conversationId: string; content: string }) => {
    if (!data.content?.trim()) throw new Error("Mensagem vazia.");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("company_id, full_name, email")
      .eq("id", context.userId)
      .maybeSingle();
    if (!profile?.company_id) throw new Error("Usuário sem empresa.");

    const { data: isAdmin } = await context.supabase.rpc("is_company_admin");

    const { sendWhatsAppText } = await import("@/lib/whatsapp/actions.server");
    const result = await sendWhatsAppText({
      companyId: profile.company_id,
      conversationId: data.conversationId,
      userId: context.userId,
      senderName: profile.full_name ?? profile.email ?? null,
      senderType: isAdmin ? "admin" : "consultant",
      content: data.content.trim(),
    });

    if (!result.ok) throw new Error(result.error);
    return { messageId: result.messageId };
  });

/** Envia áudio/imagem/vídeo/documento para o lead pelo WhatsApp. */
export const sendWhatsAppMediaMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      conversationId: string;
      base64: string;
      mimeType: string | null;
      fileName: string | null;
      caption: string | null;
      kind: "audio" | "image" | "video" | "document";
    }) => {
      if (!data.conversationId) throw new Error("Conversa inválida.");
      if (!data.base64?.trim()) throw new Error("Arquivo vazio.");
      return data;
    },
  )
  .handler(async ({ data, context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("company_id, full_name, email")
      .eq("id", context.userId)
      .maybeSingle();
    if (!profile?.company_id) throw new Error("Usuário sem empresa.");

    const { data: isAdmin } = await context.supabase.rpc("is_company_admin");
    const { sendWhatsAppMedia } = await import("@/lib/whatsapp/actions.server");
    const result = await sendWhatsAppMedia({
      companyId: profile.company_id,
      conversationId: data.conversationId,
      userId: context.userId,
      senderName: profile.full_name ?? profile.email ?? null,
      senderType: isAdmin ? "admin" : "consultant",
      base64: data.base64,
      mimeType: data.mimeType,
      fileName: data.fileName,
      caption: data.caption,
      kind: data.kind,
    });
    if (!result.ok) throw new Error(result.error);
    return { messageId: result.messageId, mediaPath: result.mediaPath };
  });

/** Link temporário para ouvir/ver as mídias da conversa (respeita a empresa). */
export const getConversationMediaUrls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { paths: string[] }) => ({ paths: (data.paths ?? []).slice(0, 60) }))
  .handler(async ({ data, context }): Promise<Record<string, string>> => {
    if (!data.paths.length) return {};
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("company_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (!profile?.company_id) throw new Error("Usuário sem empresa.");

    // Só liberamos arquivos do prefixo da própria empresa.
    const allowed = data.paths.filter((path) => path.startsWith(`${profile.company_id}/`));
    const { signedMediaUrl, repairMediaContentType } = await import("@/lib/whatsapp/media.server");
    const entries = await Promise.all(
      allowed.map(async (path) => {
        // Corrige arquivos antigos salvos sem o tipo correto (PDF abrindo em branco).
        const fixed = await repairMediaContentType(path);
        return [path, await signedMediaUrl(fixed)] as const;
      }),
    );
    return Object.fromEntries(entries.filter(([, url]) => Boolean(url)) as [string, string][]);
  });

