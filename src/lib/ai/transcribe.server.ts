/**
 * Transcrição de áudios recebidos pelo WhatsApp.
 * Usa o endpoint dedicado de reconhecimento de voz e grava o texto em
 * messages.transcription para o consultor ler e para a IA responder.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { downloadStoredMedia, extensionFor } from "@/lib/whatsapp/media.server";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/audio/transcriptions";
const MODEL = "openai/gpt-4o-transcribe";

async function setStatus(
  messageId: string,
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED",
  transcription?: string | null,
) {
  await supabaseAdmin.rpc("set_message_transcription", {
    _message_id: messageId,
    _status: status,
    ...(transcription ? { _transcription: transcription } : {}),
  });
}

/** Transcreve o áudio da mensagem. Devolve o texto quando consegue. */
export async function transcribeAudioMessage(input: {
  messageId: string;
  mediaPath: string;
  mimeType: string | null;
}): Promise<string | null> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) {
    console.error("[transcrição] LOVABLE_API_KEY ausente");
    await setStatus(input.messageId, "FAILED");
    return null;
  }

  await setStatus(input.messageId, "PROCESSING");

  const file = await downloadStoredMedia(input.mediaPath);
  if (!file) {
    await setStatus(input.messageId, "FAILED");
    return null;
  }

  const mimeType = (input.mimeType ?? file.mimeType ?? "audio/ogg").split(";")[0] ?? "audio/ogg";

  try {
    const form = new FormData();
    const extension = extensionFor("audio", mimeType);
    const audioBytes = new Uint8Array(file.bytes.byteLength);
    audioBytes.set(file.bytes);
    form.append("file", new Blob([audioBytes.buffer], { type: mimeType }), `audio.${extension}`);
    form.append("model", MODEL);
    form.append("language", "pt");
    form.append("prompt", "Conversa de atendimento em português do Brasil sobre salário-maternidade e auxílio-maternidade.");

    console.info("[transcrição] enviando áudio", {
      messageId: input.messageId,
      bytes: file.bytes.byteLength,
      mimeType,
    });
    const response = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      console.error("[transcrição] gateway respondeu", response.status, await response.text());
      await setStatus(input.messageId, "FAILED");
      return null;
    }

    const payload = (await response.json()) as { text?: string };
    const text = payload.text?.trim() ?? "";
    if (!text) {
      await setStatus(input.messageId, "FAILED");
      return null;
    }

    await setStatus(input.messageId, "COMPLETED", text);
    console.info("[transcrição] concluída", { messageId: input.messageId, caracteres: text.length });
    return text;
  } catch (error) {
    console.error("[transcrição] falha", error);
    await setStatus(input.messageId, "FAILED");
    return null;
  }
}
