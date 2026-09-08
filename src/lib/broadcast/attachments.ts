/** Anexos dos modelos de disparo: imagens e documentos, vários por modelo. */
export type StoredAttachment = {
  path: string;
  mime: string;
  filename: string;
  kind: "image" | "document";
};

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS_TOTAL_BYTES = 25 * 1024 * 1024;

/** Une o formato antigo (uma imagem só) com o novo (lista de anexos). */
export function normalizeStoredAttachments(row: Record<string, any>): StoredAttachment[] {
  const raw = Array.isArray(row["attachments"]) ? (row["attachments"] as any[]) : [];
  const list = raw
    .filter((a) => a && typeof a.path === "string")
    .map((a) => ({
      path: a.path as string,
      mime: (a.mime as string) ?? "application/octet-stream",
      filename: (a.filename as string) ?? "arquivo",
      kind: (a.kind === "image" ? "image" : "document") as "image" | "document",
    }));
  if (list.length) return list;
  if (row["media_url"]) {
    const mime = (row["media_type"] as string) ?? "image/jpeg";
    return [
      {
        path: row["media_url"] as string,
        mime,
        filename: (row["media_filename"] as string) ?? "imagem.jpg",
        kind: mime.startsWith("image/") ? "image" : "document",
      },
    ];
  }
  return [];
}
