/**
 * URL pública e compartilhável do NexaAtende.
 *
 * Os domínios de edição/preview do Lovable (lovableproject.com,
 * id-preview--*.lovable.app, sandbox local) exigem login na Lovable,
 * então links de convite gerados a partir deles levam para a tela de login.
 * Nesses casos usamos sempre o domínio público publicado.
 */
const PUBLIC_BASE_URL = "https://nexaatende.yrwentechnology.com.br";

const INTERNAL_HOST_PATTERNS = [
  "lovableproject.com",
  "id-preview--",
  "-dev.lovable.app",
  "localhost",
  "127.0.0.1",
];

export function getPublicBaseUrl(): string {
  if (typeof window === "undefined") return PUBLIC_BASE_URL;
  const { origin, hostname } = window.location;
  const isInternal = INTERNAL_HOST_PATTERNS.some((pattern) => hostname.includes(pattern));
  return isInternal ? PUBLIC_BASE_URL : origin;
}

export function buildInviteUrl(token: string): string {
  return `${getPublicBaseUrl()}/convite/${token}`;
}
