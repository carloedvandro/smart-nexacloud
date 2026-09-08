/** Anexos dos modelos de disparo: imagens, áudios e documentos, vários por modelo. */
export type AttachmentKind = "image" | "audio" | "document";

export type StoredAttachment = {
  path: string;
  mime: string;
  filename: string;
  kind: AttachmentKind;
};

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS_TOTAL_BYTES = 25 * 1024 * 1024;

/** Deduz o tipo do anexo a partir do MIME (ou da extensão do arquivo). */
export function attachmentKindFor(
  mime: string | null | undefined,
  filename?: string | null,
): AttachmentKind {
  const clean = (mime ?? "").toLowerCase();
  if (clean.startsWith("image/")) return "image";
  if (clean.startsWith("audio/")) return "audio";
  const ext = (filename ?? "").toLowerCase().split(".").pop() ?? "";
  if (["mp3", "ogg", "opus", "m4a", "aac", "wav", "amr"].includes(ext)) return "audio";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return "image";
  return "document";
}

/** Une o formato antigo (uma imagem só) com o novo (lista de anexos). */
export function normalizeStoredAttachments(row: Record<string, any>): StoredAttachment[] {
  const raw = Array.isArray(row["attachments"]) ? (row["attachments"] as any[]) : [];
  const list = raw
    .filter((a) => a && typeof a.path === "string")
    .map((a) => {
      const mime = (a.mime as string) ?? "application/octet-stream";
      const filename = (a.filename as string) ?? "arquivo";
      const kind: AttachmentKind =
        a.kind === "image" || a.kind === "audio" || a.kind === "document"
          ? a.kind
          : attachmentKindFor(mime, filename);
      return { path: a.path as string, mime, filename, kind };
    });
  if (list.length) return list;
  if (row["media_url"]) {
    const mime = (row["media_type"] as string) ?? "image/jpeg";
    const filename = (row["media_filename"] as string) ?? "imagem.jpg";
    return [
      { path: row["media_url"] as string, mime, filename, kind: attachmentKindFor(mime, filename) },
    ];
  }
  return [];
}
