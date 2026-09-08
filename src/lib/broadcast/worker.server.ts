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

async function finalize(
  queueId: string,
  ok: boolean,
  providerId: string | null,
  error: string | null,
  skip = false,
) {
  await (supabaseAdmin.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<unknown>)(
    "broadcast_finalize",
    {
      _queue_id: queueId,
      _ok: ok,
      _provider_message_id: providerId,
      _error: error,
      _skip: skip,
    },
  );
}

/**
 * Erros que são do destinatário (número inexistente/sem WhatsApp), não da
 * conexão. Marcamos como ignorado para a campanha não pausar sozinha.
 */
function isRecipientProblem(error: string | null | undefined) {
  const text = (error ?? "").toLowerCase();
  return (
    text.includes("resource not found in your plan") ||
    text.includes("not found in your plan") ||
    text.includes("number not registered") ||
    text.includes("not registered on whatsapp") ||
    text.includes("number not exists") ||
    text.includes("number does not exist") ||
    text.includes("exists: false") ||
    text.includes("invalid number") ||
    text.includes("não existe no whatsapp")
  );
}

async function sendOne(item: ClaimedItem): Promise<boolean> {
  const recipient = WhatsAppIdentifierService.toRecipient(item.phone);
  if (!recipient) {
    await finalize(item.queue_id, false, null, "Número inválido para WhatsApp.");
    return false;
  }

  // Modelo com anexos: o primeiro leva o texto como legenda e os demais seguem
  // logo depois, na ordem em que foram anexados.
  const { data: queueRow } = await supabaseAdmin
    .from("broadcast_queue")
    .select("message:broadcast_messages(media_url, media_type, media_filename, attachments)")
    .eq("id", item.queue_id)
    .maybeSingle();
  const messageRow =
    (queueRow as { message?: Record<string, any> | null } | null)?.message ?? null;
  const { normalizeStoredAttachments } = await import("@/lib/broadcast/attachments");
  const attachments = messageRow ? normalizeStoredAttachments(messageRow) : [];

  if (!item.content.trim() && !attachments.length) {
    await finalize(item.queue_id, false, null, "Mensagem vazia.");
    return false;
  }

  const creds = await loadMegaCredentials(item.connection_id);
  if (!creds) {
    await finalize(item.queue_id, false, null, "Credenciais da instância de disparo não configuradas.");
    return false;
  }

  const { normalizeWhatsAppLinks } = await import("@/lib/broadcast/links");
  const body = normalizeWhatsAppLinks(item.content ?? "");

  // Ordem de chegada: primeiro todos os arquivos (sem legenda) e, por último,
  // o texto — assim o contexto fecha a sequência no WhatsApp do cliente.
  let sent;
  if (attachments.length) {
    const { signedMediaUrl } = await import("@/lib/whatsapp/media.server");
    for (let index = 0; index < attachments.length; index += 1) {
      const att = attachments[index]!;
      const url = await signedMediaUrl(att.path, 60 * 60);
      if (!url) {
        await finalize(item.queue_id, false, null, `Não consegui gerar o link de "${att.filename}".`);
        return false;
      }
      const result = await MegaApiService.sendMedia(creds, {
        to: recipient,
        url,
        mediaType: att.kind === "image" ? "image" : att.kind === "audio" ? "audio" : "document",
        mimeType: att.mime,
        fileName: att.filename,
        caption: "",
      });
      sent = result;
      if (!result.ok) break;
      await new Promise((resolve) => setTimeout(resolve, 1_200));
    }
    if (sent?.ok && body.trim()) {
      sent = await MegaApiService.sendText(creds, recipient, body);
    }
  } else {
    sent = await MegaApiService.sendText(creds, recipient, body);
  }
  if (!sent) {
    await finalize(item.queue_id, false, null, "Mensagem vazia.");
    return false;
  }



  if (!sent.ok) {
    if (isRecipientProblem(sent.error)) {
      await finalize(
        item.queue_id,
        false,
        null,
        "Número sem WhatsApp ativo — contato ignorado.",
        true,
      );
      return true;
    }
    await finalize(item.queue_id, false, null, sent.error);
    return false;
  }

  const providerId = sent.data?.key?.id ?? (sent.data as { messageId?: string } | undefined)?.messageId ?? null;
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
