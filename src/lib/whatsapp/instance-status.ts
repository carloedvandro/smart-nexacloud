export type MegaInstanceStatus = "CONNECTED" | "CONNECTING" | "LOGGED_OUT" | "DISCONNECTED";

/** Interpreta somente a resposta de status; webhook e credenciais não indicam conexão. */
export function readMegaInstanceStatus(payload: unknown, phone: string | null): MegaInstanceStatus {
  const raw = JSON.stringify(payload ?? {}).toUpperCase();
  if (/"(STATE|STATUS)"\s*:\s*"(OPEN|CONNECTED|ONLINE)"/.test(raw) && phone) return "CONNECTED";
  if (/CONNECTING|PAIRING|QRCODE/.test(raw)) return "CONNECTING";
  if (/LOGGED_?OUT|LOGOUT/.test(raw)) return "LOGGED_OUT";
  return "DISCONNECTED";
}
