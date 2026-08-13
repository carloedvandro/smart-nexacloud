/**
 * MegaApiService — camada ÚNICA de comunicação com a MEGA API.
 * Nenhum outro módulo deve chamar a MEGA diretamente.
 * Credenciais nunca saem do servidor.
 */

export type MegaCredentials = {
  connectionId: string;
  companyId: string;
  instanceKey: string;
  host: string;
  apiKey: string;
};

export type MegaResult<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };

const TIMEOUT_MS = 20_000;

function baseUrl(host: string) {
  const clean = host.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${clean}`;
}

async function request<T>(
  creds: MegaCredentials,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<MegaResult<T>> {
  const url = `${baseUrl(creds.host)}${path}`;
  try {
    const response = await fetch(url, {
      method: init?.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${creds.apiKey}`,
      },
      ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }

    // A MEGA API responde 200 mesmo em erro: validar o corpo.
    const bodyError =
      payload && typeof payload === "object" && "error" in payload
        ? (payload as { error?: unknown }).error
        : null;

    if (!response.ok || (bodyError && bodyError !== false)) {
      const message =
        typeof bodyError === "string"
          ? bodyError
          : `MEGA API respondeu ${response.status} em ${path}`;
      console.error("[mega] falha", { path, status: response.status, message });
      return { ok: false, error: message, status: response.status };
    }

    return { ok: true, data: payload as T };
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro desconhecido";
    console.error("[mega] exceção", { path, message });
    return { ok: false, error: message };
  }
}

export const MegaApiService = {
  /** Envio de texto — endpoint confirmado na integração de referência. */
  sendText(creds: MegaCredentials, to: string, text: string) {
    return request<{ key?: { id?: string }; messageId?: string }>(
      creds,
      `/rest/sendMessage/${creds.instanceKey}/text`,
      { method: "POST", body: { messageData: { to, text } } },
    );
  },

  /** Envio de imagem com legenda — endpoint confirmado na integração de referência. */
  sendImage(creds: MegaCredentials, to: string, url: string, caption?: string) {
    return request<{ key?: { id?: string } }>(
      creds,
      `/rest/sendMessage/${creds.instanceKey}/image`,
      { method: "POST", body: { messageData: { to, url, caption: caption ?? "" } } },
    );
  },

  /** Download de mídia recebida — endpoint confirmado na integração de referência. */
  downloadMedia(creds: MegaCredentials, messageKey: unknown, messagePayload: unknown) {
    return request<{ data?: string; base64?: string; mimetype?: string }>(
      creds,
      `/rest/instance/downloadMediaMessage/${creds.instanceKey}`,
      { method: "POST", body: { messageKeys: messageKey, message: messagePayload } },
    );
  },

  /**
   * Situação da instância.
   * ATENÇÃO: este endpoint NÃO existia no projeto de referência (YTech);
   * foi implementado conforme a documentação pública da MEGA API e precisa de
   * confirmação da operação antes do uso em produção.
   */
  getInstanceStatus(creds: MegaCredentials) {
    return request<Record<string, unknown>>(creds, `/rest/instance/${creds.instanceKey}`);
  },

  /** QR Code em base64. Mesma ressalva do endpoint de status. */
  getQrCode(creds: MegaCredentials) {
    return request<Record<string, unknown>>(
      creds,
      `/rest/instance/qrcode_base64/${creds.instanceKey}`,
    );
  },

  /** Logout do número (a instância continua pertencendo à empresa). */
  logout(creds: MegaCredentials) {
    return request<Record<string, unknown>>(
      creds,
      `/rest/instance/${creds.instanceKey}/logout`,
      { method: "DELETE" },
    );
  },

  /** Consulta o webhook configurado atualmente para a instância. */
  getWebhook(creds: MegaCredentials) {
    return request<Record<string, unknown>>(creds, `/rest/webhook/${creds.instanceKey}`);
  },

  /** Configura/reconfigura o webhook central para a instância. */
  setWebhook(creds: MegaCredentials, webhookUrl: string) {
    return request<Record<string, unknown>>(
      creds,
      `/rest/webhook/${creds.instanceKey}/configWebhook`,
      {
        method: "POST",
        body: { webhookData: { webhookUrl, webhookEnabled: true } },
      },
    );
  },
};

/** Extrai a URL de webhook informada pela MEGA API em qualquer formato. */
export function extractWebhookUrl(payload: unknown): string | null {
  const stack: unknown[] = [payload];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (typeof value === "string" && /webhook.*url|url/i.test(key) && /^https?:\/\//i.test(value)) {
        return value;
      }
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return null;
}

/** Extrai o número conectado das várias formas de resposta da MEGA API. */
export function extractConnectedPhone(payload: unknown): string | null {
  const candidates: unknown[] = [];
  const visit = (node: unknown, depth: number) => {
    if (!node || depth > 4) return;
    if (typeof node === "object") {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (/^(jid|wid|user|owner|phone|phone_?number|me)$/i.test(key)) candidates.push(value);
        visit(value, depth + 1);
      }
    }
  };
  visit(payload, 0);

  for (const candidate of candidates) {
    const raw =
      typeof candidate === "string"
        ? candidate
        : candidate && typeof candidate === "object" && "id" in candidate
          ? String((candidate as { id?: unknown }).id ?? "")
          : "";
    const digits = raw.split("@")[0]?.split(":")[0]?.replace(/\D/g, "") ?? "";
    if (digits.length >= 10) return digits;
  }
  return null;
}

/** Extrai o QR Code (base64 ou string) das várias formas de resposta. */
export function extractQrCode(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const stack: unknown[] = [payload];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (typeof value === "string" && /qrcode|qr_code|base64|code/i.test(key) && value.length > 40) {
        return value.startsWith("data:") ? value : `data:image/png;base64,${value.replace(/^base64,?/, "")}`;
      }
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return null;
}
