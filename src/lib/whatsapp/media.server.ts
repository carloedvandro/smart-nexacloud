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

/**
 * Descobre o tipo real pelo início do arquivo. Necessário porque a MEGA nem
 * sempre devolve o mimetype: sem isso o PDF ficava salvo como
 * application/octet-stream e o navegador baixava um arquivo que não abre.
 */
export function sniffMimeType(bytes: Uint8Array): string | null {
  const starts = (...sig: number[]) => sig.every((byte, index) => bytes[index] === byte);
  if (starts(0x25, 0x50, 0x44, 0x46)) return "application/pdf";
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0x4f, 0x67, 0x67, 0x53)) return "audio/ogg";
  if (starts(0x49, 0x44, 0x33)) return "audio/mpeg";
  if (starts(0x1a, 0x45, 0xdf, 0xa3)) return "video/webm";
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return "video/mp4";
  }
  if (starts(0x50, 0x4b, 0x03, 0x04)) return "application/zip";
  // RIFF....WEBP — figurinhas do WhatsApp (inclusive animadas) chegam assim.
  if (
    starts(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

function isGeneric(mimeType: string | null | undefined): boolean {
  const clean = (mimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return !clean || clean === "application/octet-stream" || clean === "binary/octet-stream";
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
  const sniffed = sniffMimeType(input.bytes);
  const mimeType = isGeneric(input.mimeType) ? (sniffed ?? input.mimeType) : input.mimeType;
  const extension = extensionFor(input.kind, mimeType);
  const path = `${input.companyId}/${input.connectionId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabaseAdmin.storage.from(MEDIA_BUCKET).upload(path, input.bytes, {
    contentType: mimeType ?? "application/octet-stream",
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

/**
 * Arquivos antigos foram salvos como application/octet-stream, e por isso o
 * navegador abre uma aba em branco em vez do PDF. Aqui detectamos o tipo real
 * pelos bytes e regravamos o arquivo com o tipo e a extensão corretos,
 * devolvendo o novo caminho (ou o mesmo, quando nada precisa mudar).
 */
export async function repairMediaContentType(path: string): Promise<string> {
  if (!/\.(bin|dat)$/i.test(path)) return path;
  const file = await downloadStoredMedia(path);
  if (!file) return path;
  const detected = sniffMimeType(file.bytes);
  if (!detected) return path;

  const kind: MediaKind = detected.startsWith("image/")
    ? "image"
    : detected.startsWith("audio/")
      ? "audio"
      : detected.startsWith("video/")
        ? "video"
        : "document";
  const extension = extensionFor(kind, detected);
  const newPath = `${path.replace(/\.[^.]+$/, "")}.${extension}`;

  const { error } = await supabaseAdmin.storage.from(MEDIA_BUCKET).upload(newPath, file.bytes, {
    contentType: detected,
    upsert: true,
  });
  if (error) {
    console.error("[midia] regravação falhou", error.message);
    return path;
  }
  await supabaseAdmin
    .from("messages")
    .update({ media_url: newPath })
    .eq("media_url", path);
  await supabaseAdmin.storage.from(MEDIA_BUCKET).remove([path]);
  return newPath;
}
