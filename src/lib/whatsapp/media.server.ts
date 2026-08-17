/**
 * Armazenamento e leitura das mídias das conversas.
 * Os arquivos ficam no bucket privado `conversation-media`, sempre no
 * primeiro nível pela empresa: {company_id}/{connection_id}/{uuid}.{ext}
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const MEDIA_BUCKET = "conversation-media";

export type MediaKind = "audio" | "image" | "video" | "document" | "other";

const EXTENSION_BY_KIND: Record<MediaKind, string> = {
  audio: "ogg",
  image: "jpg",
  video: "mp4",
  document: "bin",
  other: "bin",
};

/** Extensão a partir do mime-type, com fallback pelo tipo de mensagem. */
export function extensionFor(kind: MediaKind, mimeType: string | null | undefined): string {
  const clean = (mimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const map: Record<string, string> = {
    "audio/ogg": "ogg",
    "audio/opus": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/webm": "webm",
    "audio/wav": "wav",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "application/pdf": "pdf",
  };
  return map[clean] ?? EXTENSION_BY_KIND[kind];
}

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.includes(",") ? (base64.split(",")[1] ?? base64) : base64;
  const binary = atob(clean.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Sobe bytes para o bucket da empresa e devolve o caminho salvo. */
export async function storeMedia(input: {
  companyId: string;
  connectionId: string;
  bytes: Uint8Array;
  mimeType: string | null;
  kind: MediaKind;
  fileName?: string | null;
}): Promise<string | null> {
  const extension = extensionFor(input.kind, input.mimeType);
  const path = `${input.companyId}/${input.connectionId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabaseAdmin.storage.from(MEDIA_BUCKET).upload(path, input.bytes, {
    contentType: input.mimeType ?? "application/octet-stream",
    upsert: false,
  });
  if (error) {
    console.error("[midia] upload falhou", error.message);
    return null;
  }
  return path;
}

/** Link temporário para ouvir/ver/baixar o arquivo. */
export async function signedMediaUrl(path: string, expiresIn = 60 * 60): Promise<string | null> {
  const { data, error } = await supabaseAdmin.storage
    .from(MEDIA_BUCKET)
    .createSignedUrl(path, expiresIn);
  if (error) {
    console.error("[midia] link assinado falhou", error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}

/** Baixa os bytes do arquivo guardado (usado pela transcrição). */
export async function downloadStoredMedia(
  path: string,
): Promise<{ bytes: Uint8Array; mimeType: string | null } | null> {
  const { data, error } = await supabaseAdmin.storage.from(MEDIA_BUCKET).download(path);
  if (error || !data) {
    console.error("[midia] download interno falhou", error?.message);
    return null;
  }
  const buffer = await data.arrayBuffer();
  return { bytes: new Uint8Array(buffer), mimeType: data.type || null };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
