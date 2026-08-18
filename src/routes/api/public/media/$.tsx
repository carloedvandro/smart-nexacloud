/**
 * Entrega as mídias das conversas pelo próprio domínio, com o tipo correto.
 * O acesso é liberado por um token assinado e expirável gerado no servidor.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/media/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const path = decodeURIComponent((params as { _splat?: string })._splat ?? "");
        if (!path) return new Response("Not found", { status: 404 });

        const url = new URL(request.url);
        const expiresAt = Number(url.searchParams.get("e"));
        const token = url.searchParams.get("t") ?? "";

        const { verifyMediaToken } = await import("@/lib/whatsapp/media-token.server");
        if (!verifyMediaToken(path, expiresAt, token)) {
          return new Response("Link expirado", { status: 401 });
        }

        const { downloadStoredMedia, sniffMimeType } = await import(
          "@/lib/whatsapp/media.server"
        );
        const file = await downloadStoredMedia(path);
        if (!file) return new Response("Arquivo não encontrado", { status: 404 });

        const generic =
          !file.mimeType ||
          file.mimeType === "application/octet-stream" ||
          file.mimeType === "binary/octet-stream";
        const mimeType = (generic ? sniffMimeType(file.bytes) : file.mimeType) ?? "application/octet-stream";

        const name = path.split("/").pop() ?? "arquivo";
        const disposition = url.searchParams.has("download") ? "attachment" : "inline";

        return new Response(file.bytes as unknown as BodyInit, {
          headers: {
            "content-type": mimeType,
            "content-length": String(file.bytes.byteLength),
            "content-disposition": `${disposition}; filename="${name}"`,
            "cache-control": "private, max-age=300",
          },
        });
      },
    },
  },
});
