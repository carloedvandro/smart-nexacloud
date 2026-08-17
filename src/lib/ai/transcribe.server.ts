/**
 * Transcrição de áudios recebidos pelo WhatsApp.
 * Usa o gateway de IA da Lovable (modelo multimodal) e grava o texto em
 * messages.transcription para o consultor ler e para a IA responder.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { bytesToBase64, downloadStoredMedia } from "@/lib/whatsapp/media.server";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

function audioFormat(mimeType: string | null): string {
  const clean = (mimeType ?? "").toLowerCase();
  if (clean.includes("mpeg") || clean.includes("mp3")) return "mp3";
  if (clean.includes("wav")) return "wav";
  if (clean.includes("webm")) return "webm";
  if (clean.includes("mp4") || clean.includes("m4a")) return "m4a";
  return "ogg";
}

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

  const mimeType = input.mimeType ?? file.mimeType;
  const base64 = bytesToBase64(file.bytes);

  try {
    const response = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Transcreva integralmente o áudio a seguir em português do Brasil. Responda apenas com a transcrição, sem comentários.",
              },
              {
                type: "input_audio",
                input_audio: { data: base64, format: audioFormat(mimeType) },
              },
            ],
          },
        ],
        temperature: 0,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      console.error("[transcrição] gateway respondeu", response.status, await response.text());
      await setStatus(input.messageId, "FAILED");
      return null;
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = payload.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) {
      await setStatus(input.messageId, "FAILED");
      return null;
    }

    await setStatus(input.messageId, "COMPLETED", text);
    return text;
  } catch (error) {
    console.error("[transcrição] falha", error);
    await setStatus(input.messageId, "FAILED");
    return null;
  }
}
