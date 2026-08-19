/**
 * Síntese de voz da IA (resposta em áudio).
 * Usa o gateway de IA da Lovable, guarda o arquivo no bucket de mídias e
 * devolve o caminho para envio pela MEGA API.
 */
import { storeMedia } from "@/lib/whatsapp/media.server";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/audio/speech";
const MODEL = "openai/gpt-4o-mini-tts";
/** Voz feminina. */
const VOICE = "shimmer";
// O webhook do provedor tem uma janela curta. A voz precisa terminar antes
// dela; caso contrário cancelamos e o agente envia o mesmo conteúdo em texto.
const TTS_TIMEOUT_MS = 5_000;

const INSTRUCTIONS = [
  "Fale em português do Brasil com voz feminina, jovem e simpática.",
  "Use sotaque paulista da cidade de São Paulo: fala rápida, 'r' brando no fim das palavras",
  "(sem o 'r' caipira e sem o 'r' arrastado carioca), 's' sibilante (nunca chiado),",
  "entonação amistosa e profissional de atendimento.",
  "Ritmo natural de conversa por WhatsApp, sem soar robótica.",
].join(" ");

/** Gera o áudio da resposta e guarda no storage. Devolve o caminho salvo. */
export async function synthesizeReplyAudio(input: {
  companyId: string;
  connectionId: string;
  text: string;
}): Promise<{ path: string; mimeType: string } | null> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) {
    console.error("[voz] LOVABLE_API_KEY ausente");
    return null;
  }
  const text = input.text.trim();
  if (!text) return null;

  try {
    console.info("[voz] iniciando geração", { caracteres: text.length });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort("tts-timeout"), TTS_TIMEOUT_MS);
    const response = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        input: text.slice(0, 600),
        voice: VOICE,
        instructions: INSTRUCTIONS,
        response_format: "mp3",
        stream_format: "audio",
      }),
      // A resposta de voz não pode deixar o webhook preso indefinidamente.
      // Quando o limite estoura, devolvemos null e o agente envia o mesmo
      // conteúdo em texto, sem deixar o lead sem resposta.
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error("[voz] falha na geração", response.status, detail.slice(0, 300));
      return null;
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength) {
      console.error("[voz] resposta sem áudio");
      return null;
    }

    const path = await storeMedia({
      companyId: input.companyId,
      connectionId: input.connectionId,
      bytes,
      mimeType: "audio/mpeg",
      kind: "audio",
    });
    if (!path) return null;
    console.info("[voz] geração concluída", { bytes: bytes.byteLength });
    return { path, mimeType: "audio/mpeg" };
  } catch (error) {
    const timedOut = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
    console.error(timedOut ? "[voz] tempo limite; resposta seguirá em texto" : "[voz] erro inesperado", error);
    return null;
  }
}
