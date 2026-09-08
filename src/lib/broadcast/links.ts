/**
 * Deixa a mensagem do disparo "clicável" no WhatsApp:
 * - links escritos sem protocolo (wa.me/..., api.whatsapp.com/...) ganham https://
 * - números de WhatsApp soltos viram https://wa.me/55XXXXXXXXXXX
 * O WhatsApp só transforma em link o que tem protocolo ou domínio conhecido,
 * por isso a normalização acontece imediatamente antes do envio.
 */

const URL_LIKE =
  /(https?:\/\/\S+)|((?:www\.|wa\.me\/|api\.whatsapp\.com\/|chat\.whatsapp\.com\/)[^\s<>()]+)/gi;

/** Número brasileiro solto: (11) 97217-5895, 11 97217-5895, +55 11 ..., 5511972175895 */
const PHONE_LIKE = /(?:\+?55[\s.-]?)?(?:\(?\d{2}\)?[\s.-]?)?\d{4,5}[\s.-]?\d{4}/g;

function toWaLink(digits: string): string | null {
  let d = digits.replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) return `https://wa.me/${d}`;
  return null;
}

export function normalizeWhatsAppLinks(text: string): string {
  if (!text?.trim()) return text;

  // 1) Protege trechos que já são links e adiciona protocolo quando falta.
  const tokens: string[] = [];
  let working = text.replace(URL_LIKE, (match) => {
    const url = /^https?:\/\//i.test(match) ? match : `https://${match}`;
    tokens.push(url);
    return `\u0000${tokens.length - 1}\u0000`;
  });

  // 2) Números soltos viram links do WhatsApp.
  working = working.replace(PHONE_LIKE, (match) => {
    const link = toWaLink(match);
    if (!link) return match;
    tokens.push(link);
    return `\u0000${tokens.length - 1}\u0000`;
  });

  return working.replace(/\u0000(\d+)\u0000/g, (_m, i) => tokens[Number(i)] ?? "");
}
