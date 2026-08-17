/**
 * PhoneNormalizationService
 * Regra única de normalização de telefone no frontend.
 * A mesma regra existe no banco (public.normalize_phone) — nunca duplicar lógica divergente.
 */
export const PhoneNormalizationService = {
  /** Retorna somente dígitos com DDI (Brasil assumido quando ausente). Null se inválido. */
  normalize(raw: string | null | undefined): string | null {
    if (!raw) return null;
    let digits = raw.replace(/\D/g, "").replace(/^0+/, "");
    if (!digits) return null;
    if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
    if (digits.length < 10 || digits.length > 15) return null;
    return digits;
  },

  isValid(raw: string | null | undefined): boolean {
    return PhoneNormalizationService.normalize(raw) !== null;
  },

  /** true quando o valor é um LID do WhatsApp (identificador interno, não é telefone). */
  isLid(raw: string | null | undefined): boolean {
    return typeof raw === "string" && raw.includes("@lid");
  },

  /** Exibição amigável: +55 (11) 99999-9999 quando for número brasileiro. */
  format(raw: string | null | undefined): string {
    if (PhoneNormalizationService.isLid(raw)) return "Número oculto pelo WhatsApp";
    const n = PhoneNormalizationService.normalize(raw);
    if (!n) return raw ?? "—";
    if (n.startsWith("55") && (n.length === 12 || n.length === 13)) {
      const ddd = n.slice(2, 4);
      const rest = n.slice(4);
      const head = rest.length === 9 ? rest.slice(0, 5) : rest.slice(0, 4);
      const tail = rest.length === 9 ? rest.slice(5) : rest.slice(4);
      return `+55 (${ddd}) ${head}-${tail}`;
    }
    return `+${n}`;
  },

  /** Prefere o telefone real; cai para o identificador do WhatsApp. */
  formatContact(
    phone: string | null | undefined,
    whatsapp?: string | null | undefined,
  ): string {
    if (phone && !PhoneNormalizationService.isLid(phone)) {
      return PhoneNormalizationService.format(phone);
    }
    return PhoneNormalizationService.format(whatsapp ?? phone ?? null);
  },


  /** Link direto para o WhatsApp do lead. */
  waLink(raw: string | null | undefined): string | null {
    const n = PhoneNormalizationService.normalize(raw);
    return n ? `https://wa.me/${n}` : null;
  },
};
