import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { MegaCredentials } from "@/lib/whatsapp/mega.server";

/**
 * Carrega as credenciais da instância. A instance_key vive numa tabela sem
 * acesso para anon/authenticated e NUNCA é devolvida ao frontend.
 */
export async function loadMegaCredentials(connectionId: string): Promise<MegaCredentials | null> {
  const { data, error } = await supabaseAdmin
    .from("whatsapp_credentials")
    .select("connection_id, company_id, instance_key, api_host, api_key")
    .eq("connection_id", connectionId)
    .maybeSingle();

  if (error) {
    console.error("[whatsapp] erro ao carregar credenciais", error.message);
    return null;
  }
  if (!data) return null;

  const host = data.api_host || process.env["MEGA_API_HOST"];
  const apiKey = data.api_key || process.env["MEGA_API_KEY"];
  if (!host || !apiKey) {
    console.error("[whatsapp] MEGA_API_HOST/MEGA_API_KEY ausentes para a conexão", connectionId);
    return null;
  }

  return {
    connectionId: data.connection_id,
    companyId: data.company_id,
    instanceKey: data.instance_key,
    host,
    apiKey,
  };
}
