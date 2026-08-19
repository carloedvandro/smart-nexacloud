/**
 * Converte a gravação do MediaRecorder para MP3 antes do envio.
 * Chromium/Safari normalmente gravam WebM/MP4, formatos que algumas versões
 * da MEGA aceitam com HTTP 200, mas que o WhatsApp descarta sem entregar.
 */
export async function recordingToWhatsAppAudio(recording: Blob): Promise<Blob> {
  const AudioContextClass = window.AudioContext;
  const context = new AudioContextClass();

  try {
    const decoded = await context.decodeAudioData(await recording.arrayBuffer());
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
    await context.close();
  }
}