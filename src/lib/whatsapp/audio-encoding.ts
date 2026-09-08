/**
 * Prepara a gravação do MediaRecorder para o envio ao WhatsApp.
 *
 * Caminho preferido: converter para MP3 (aceito de forma consistente).
 * Se o navegador não conseguir decodificar/codificar (comum no iOS), usamos
 * a própria gravação quando o formato já é entendido pelo WhatsApp (m4a/mp4
 * ou ogg/opus). Assim o usuário nunca fica sem conseguir enviar o áudio.
 */

export type PreparedAudio = { blob: Blob; extension: string };

function audioContextClass(): typeof AudioContext | null {
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function decode(context: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  // Safari antigo só tem a versão com callbacks.
  return new Promise((resolve, reject) => {
    const maybe = context.decodeAudioData(data, resolve, reject) as unknown as
      | Promise<AudioBuffer>
      | undefined;
    if (maybe && typeof maybe.then === "function") maybe.then(resolve, reject);
  });
}

async function toMp3(recording: Blob): Promise<Blob> {
  const AudioContextClass = audioContextClass();
  if (!AudioContextClass) throw new Error("AudioContext indisponível neste navegador.");
  const context = new AudioContextClass();

  try {
    const decoded = await decode(context, await recording.arrayBuffer());
    const sampleRate = decoded.sampleRate;
    const samples = decoded.length;
    const mono = new Int16Array(samples);

    for (let index = 0; index < samples; index += 1) {
      let value = 0;
      for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
        value += decoded.getChannelData(channel)[index] ?? 0;
      }
      value /= decoded.numberOfChannels;
      const clamped = Math.max(-1, Math.min(1, value));
      mono[index] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    }

    const { Mp3Encoder } = await import("@breezystack/lamejs");
    const encoder = new Mp3Encoder(1, sampleRate, 64);
    const chunks: BlobPart[] = [];
    const frameSize = 1152;

    for (let offset = 0; offset < mono.length; offset += frameSize) {
      const encoded = encoder.encodeBuffer(mono.subarray(offset, offset + frameSize));
      if (encoded.length > 0) chunks.push(new Uint8Array(encoded));
    }
    const finalChunk = encoder.flush();
    if (finalChunk.length > 0) chunks.push(new Uint8Array(finalChunk));

    const mp3 = new Blob(chunks, { type: "audio/mpeg" });
    if (mp3.size === 0) throw new Error("A conversão do áudio gerou um arquivo vazio.");
    return mp3;
  } finally {
    void context.close();
  }
}

/** Formatos que o WhatsApp aceita direto, sem conversão. */
function passthrough(recording: Blob): PreparedAudio | null {
  const mime = (recording.type || "").toLowerCase();
  if (mime.includes("ogg") || mime.includes("opus")) {
    return { blob: new Blob([recording], { type: "audio/ogg; codecs=opus" }), extension: "ogg" };
  }
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) {
    return { blob: new Blob([recording], { type: "audio/mp4" }), extension: "m4a" };
  }
  if (mime.includes("mpeg") || mime.includes("mp3")) {
    return { blob: new Blob([recording], { type: "audio/mpeg" }), extension: "mp3" };
  }
  return null;
}

export async function prepareRecordingForWhatsApp(recording: Blob): Promise<PreparedAudio> {
  try {
    return { blob: await toMp3(recording), extension: "mp3" };
  } catch (error) {
    console.error("[audio] conversão para MP3 falhou, tentando formato original", error);
    const direct = passthrough(recording);
    if (direct) return direct;
    throw error instanceof Error ? error : new Error("Falha ao preparar o áudio.");
  }
}

/** Compatibilidade com o nome antigo. */
export async function recordingToWhatsAppAudio(recording: Blob): Promise<Blob> {
  return (await prepareRecordingForWhatsApp(recording)).blob;
}
