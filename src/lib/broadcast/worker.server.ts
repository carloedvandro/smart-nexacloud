/**
 * Worker de Disparos — roda SEMPRE no backend (cron), nunca no navegador.
 * Reserva um item por vez através de public.broadcast_claim_next, que já valida
 * campanha ativa, instância de disparo conectada, contato permitido, janela de
 * horário e todos os limites de velocidade. Aqui só executamos o envio pela
 * mesma camada MEGA API usada pelo atendimento e registramos o resultado.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadMegaCredentials } from "@/lib/whatsapp/credentials.server";
import { MegaApiService } from "@/lib/whatsapp/mega.server";
import { WhatsAppIdentifierService } from "@/lib/whatsapp/jid";

type ClaimedItem = {
  queue_id: string;
  company_id: string;
  campaign_id: string;
  connection_id: string;
  contact_id: string;
  phone: string;
  content: string;
};

async function claim(limit: number): Promise<ClaimedItem[]> {
  const { data, error } = await supabaseAdmin.rpc("broadcast_claim_next", { _limit: limit });
  if (error) {
    console.error("[disparos] falha ao reservar envio", error.message);
    return [];
  }
  return (data ?? []) as unknown as ClaimedItem[];
}

async function finalize(queueId: string, ok: boolean, providerId: string | null, error: string | null) {
  await supabaseAdmin.rpc("broadcast_finalize", {
    _queue_id: queueId,
    _ok: ok,
    _provider_message_id: providerId as unknown as string,
    _error: error as unknown as string,
  });
}

async function sendOne(item: ClaimedItem): Promise<boolean> {
  const recipient = WhatsAppIdentifierService.toRecipient(item.phone);
  if (!recipient) {
    await finalize(item.queue_id, false, null, "Número inválido para WhatsApp.");
    return false;
  }
  if (!item.content.trim()) {
    await finalize(item.queue_id, false, null, "Mensagem vazia.");
    return false;
  }

  const creds = await loadMegaCredentials(item.connection_id);
  if (!creds) {
    await finalize(item.queue_id, false, null, "Credenciais da instância de disparo não configuradas.");
    return false;
  }

  const sent = await MegaApiService.sendText(creds, recipient, item.content);
  if (!sent.ok) {
    await finalize(item.queue_id, false, null, sent.error);
    return false;
  }

  const providerId = sent.data?.key?.id ?? sent.data?.messageId ?? null;
  await finalize(item.queue_id, true, providerId, null);
  return true;
}

/**
 * Executa uma janela de processamento. O ritmo real é definido pelo banco
 * (next_send_at da campanha), por isso apenas repetimos a reserva até o prazo.
 */
export async function runBroadcastTick(options?: { budgetMs?: number }): Promise<{
  sent: number;
  failed: number;
}> {
  const deadline = Date.now() + (options?.budgetMs ?? 45_000);
  let sent = 0;
  let failed = 0;

  while (Date.now() < deadline) {
    const items = await claim(5);
    if (items.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      if (Date.now() >= deadline) break;
      continue;
    }
    for (const item of items) {
      const ok = await sendOne(item);
      if (ok) sent += 1;
      else failed += 1;
    }
  }

  return { sent, failed };
}
