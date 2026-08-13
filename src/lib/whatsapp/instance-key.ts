/**
 * Extração da instance_key enviada pela MEGA API no payload do webhook.
 * É a ÚNICA informação usada para identificar a conexão — company_id vindo
 * do cliente jamais é considerado.
 * Browser-safe (sem segredos): apenas leitura do payload.
 */
const KEY_NAMES = /^(instance_?key|instancekey|instance|instance_?id|instanceName|instance_?name|key)$/i;

export function extractInstanceKey(payload: unknown): string | null {
  const stack: Array<{ node: unknown; depth: number }> = [{ node: payload, depth: 0 }];

  while (stack.length) {
    const current = stack.pop();
    if (!current || !current.node || typeof current.node !== "object" || current.depth > 4) continue;

    for (const [name, value] of Object.entries(current.node as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim() && KEY_NAMES.test(name)) {
        return value.trim();
      }
      if (value && typeof value === "object") {
        stack.push({ node: value, depth: current.depth + 1 });
      }
    }
  }
  return null;
}
