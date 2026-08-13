/**
 * WhatsAppIdentifierService
 * Regra única de interpretação de identificadores do WhatsApp (JID/LID).
 * Browser-safe: pode ser importado tanto no servidor quanto no frontend.
 */
import { PhoneNormalizationService } from "@/lib/nexa/phone";

export type WhatsAppIdentifier = {
  /** JID completo como recebido do provedor. */
  jid: string;
  /** true quando o remetente é identificado por LID (sem número exposto). */
  isLid: boolean;
  /** true para grupos (@g.us) — devem ser ignorados nesta fase. */
  isGroup: boolean;
  /** true para status/broadcast/newsletter — sempre ignorados. */
  isBroadcast: boolean;
  /** Telefone normalizado quando disponível; null para LID/grupo. */
  phone: string | null;
  /** Identificador estável usado como chave do lead. */
  identifier: string | null;
};

export const WhatsAppIdentifierService = {
  parse(rawJid: string | null | undefined): WhatsAppIdentifier | null {
    const jid = (rawJid ?? "").trim();
    if (!jid) return null;

    const isGroup = jid.endsWith("@g.us");
    const isBroadcast =
      jid === "status@broadcast" || jid.endsWith("@broadcast") || jid.endsWith("@newsletter");
    const isLid = jid.endsWith("@lid");

    if (isGroup || isBroadcast) {
      return { jid, isLid, isGroup, isBroadcast, phone: null, identifier: null };
    }

    if (isLid) {
      // LID nunca é convertido em telefone: é preservado integralmente.
      return { jid, isLid, isGroup, isBroadcast, phone: null, identifier: jid };
    }

    const local = jid.split("@")[0]?.split(":")[0] ?? "";
    const phone = PhoneNormalizationService.normalize(local);
    return { jid, isLid, isGroup, isBroadcast, phone, identifier: phone };
  },

  /** Destinatário aceito pela MEGA API: número puro ou LID preservado. */
  toRecipient(rawJid: string | null | undefined): string | null {
    const parsed = WhatsAppIdentifierService.parse(rawJid);
    if (!parsed || parsed.isGroup || parsed.isBroadcast) return null;
    if (parsed.isLid) return parsed.jid;
    return parsed.phone;
  },

  /** Deve ser processado pelo webhook? */
  isProcessable(rawJid: string | null | undefined): boolean {
    const parsed = WhatsAppIdentifierService.parse(rawJid);
    return Boolean(parsed && !parsed.isGroup && !parsed.isBroadcast && parsed.identifier);
  },
};
