/**
 * Avisos no WhatsApp pessoal quando um atendimento é atribuído manualmente
 * pelo administrador — ou quando o administrador assume a conversa e ela
 * sai das mãos do consultor.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadTrunk, sendToConsultant } from "@/lib/queue/bridge.server";
import { getPublicBaseUrl } from "@/lib/nexa/public-url";

type Profile = { id: string; full_name: string | null; phone: string | null };

async function loadProfile(id: string): Promise<Profile | null> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, phone")
    .eq("id", id)
    .maybeSingle();
  return (data as Profile | null) ?? null;
}

function firstName(name: string | null | undefined) {
  return (name ?? "").trim().split(/\s+/)[0] || "consultor(a)";
}

/**
 * Notifica o novo responsável e, quando houver troca, o consultor anterior.
 */
export async function notifyManualAssignment(input: {
  companyId: string;
  conversationId: string;
  previousUserId: string | null;
  newUserId: string | null;
  actorId: string;
}): Promise<void> {
  const { companyId, conversationId, previousUserId, newUserId, actorId } = input;
  if (previousUserId === newUserId) return;

  const trunk = await loadTrunk(companyId);
  if (!trunk) {
    console.error("[atribuição] empresa sem instância tronco", companyId);
    return;
  }

  const link = `${getPublicBaseUrl()}/conversas?c=${conversationId}`;

  const { data: conversation } = await supabaseAdmin
    .from("conversations")
    .select("lead:leads(name, whatsapp, city, state)")
    .eq("id", conversationId)
    .maybeSingle();
  const lead = (conversation?.lead ?? null) as {
    name: string | null;
    whatsapp: string | null;
    city: string | null;
    state: string | null;
  } | null;
  const leadLabel = lead?.name?.trim() || lead?.whatsapp || "sem nome";

  const actor = await loadProfile(actorId);
  const actorName = actor?.full_name?.trim() || "A administração";

  // 1) Novo responsável (quando não é o próprio autor da ação).
  if (newUserId && newUserId !== actorId) {
    const target = await loadProfile(newUserId);
    if (target?.phone) {
      await sendToConsultant(
        trunk,
        target.phone,
        [
          `🔔 Um lead foi atribuído a você, ${firstName(target.full_name)}!`,
          "",
          `👤 Lead: ${leadLabel}`,
          lead?.city ? `📍 ${lead.city}${lead.state ? `/${lead.state}` : ""}` : "",
          `👤 Atribuído por: ${actorName}`,
          "",
          `🖥️ Entre no link para conversar com o lead: ${link}`,
          "",
          "⚠️ Não responda por aqui: o atendimento acontece somente no painel.",
        ]
          .filter((line) => line !== "")
          .join("\n"),
      );
    } else {
      console.error("[atribuição] consultor sem WhatsApp pessoal", newUserId);
    }
  }

  // 2) Consultor que perdeu o atendimento.
  if (previousUserId && previousUserId !== actorId) {
    const previous = await loadProfile(previousUserId);
    if (previous?.phone) {
      const message =
        newUserId === actorId
          ? `ℹ️ ${actorName} assumiu o atendimento do lead ${leadLabel}. Essa conversa não está mais sob sua responsabilidade.`
          : newUserId
            ? `ℹ️ O atendimento do lead ${leadLabel} foi transferido para outro consultor por ${actorName}.`
            : `ℹ️ O atendimento do lead ${leadLabel} foi retirado da sua fila por ${actorName}.`;
      await sendToConsultant(trunk, previous.phone, message);
    }
  }
}
