/**
 * Assinatura curta para servir mídias pelo próprio domínio do app.
 * O Safari abre/baixa PDFs sem problema quando o arquivo vem do mesmo domínio
 * com Content-Type e Content-Disposition corretos — o link assinado do storage
 * às vezes resulta em aba em branco.
 */
import { createHmac, timingSafeEqual } from "crypto";

function secret(): string {
  return (
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ??
    process.env["SUPABASE_PUBLISHABLE_KEY"] ??
    "nexaatende-media"
  );
}

function sign(path: string, expiresAt: number): string {
  return createHmac("sha256", secret()).update(`${path}:${expiresAt}`).digest("hex");
}

/** Gera o caminho same-origin para abrir/baixar a mídia. */
export function mediaProxyUrl(path: string, ttlSeconds = 60 * 60): string {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const token = sign(path, expiresAt);
  return `/api/public/media/${path}?e=${expiresAt}&t=${token}`;
}

export function verifyMediaToken(path: string, expiresAt: number, token: string): boolean {
  if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(sign(path, expiresAt));
  const given = Buffer.from(token ?? "");
  return expected.length === given.length && timingSafeEqual(expected, given);
}
