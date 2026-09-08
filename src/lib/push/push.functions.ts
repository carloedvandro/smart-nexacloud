import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Chave pública usada pelo navegador para assinar as notificações. */
export const getPushPublicKey = createServerFn({ method: "GET" }).handler(async () => {
  const key = process.env["VAPID_PUBLIC_KEY"] ?? null;
  return { publicKey: key };
});

export const savePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent?: string | null;
  }) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("company_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (!profile?.company_id) throw new Error("Perfil sem empresa vinculada.");

    const { error } = await supabaseAdmin.from("push_subscriptions").upsert(
      {
        user_id: context.userId,
        company_id: profile.company_id as string,
        endpoint: data.endpoint,
        p256dh: data.p256dh,
        auth: data.auth,
        user_agent: data.userAgent ?? null,
        failure_count: 0,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { endpoint: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", data.endpoint)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Dispara um aviso de teste para os dispositivos do próprio usuário. */
export const sendTestPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { sendPushToUsers } = await import("@/lib/push/push.server");
    const sent = await sendPushToUsers([context.userId], {
      title: "🔔 NexaAtende",
      body: "Notificações ativadas! Você será avisado de novas mensagens e leads.",
      url: "/dashboard",
      tag: "teste",
    });
    return { sent };
  });

export const countPushDevices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { count } = await context.supabase
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId);
    return { devices: count ?? 0 };
  });
