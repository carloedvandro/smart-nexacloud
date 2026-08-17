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
      const rawMessage =
        payload && typeof payload === "object" && "message" in payload
          ? String((payload as { message?: unknown }).message ?? "")
          : typeof bodyError === "string"
            ? bodyError
            : "";
      const name =
        payload && typeof payload === "object" && "name" in payload
          ? String((payload as { name?: unknown }).name ?? "")
          : "";
      const message =
        name === "UNAUTHORIZED"
          ? "Token da MEGA API inválido para esta instância. Cadastre o token (Bearer) da instância no painel."
          : rawMessage || `MEGA API respondeu ${response.status} em ${path}`;
      console.error("[mega] falha", {
        path,
        status: response.status,
        name,
        body: text?.slice(0, 500),
      });
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

  /**
   * Envio de mídia (áudio, imagem, vídeo, documento).
   * A MEGA aceita formatos de corpo diferentes conforme a versão do servidor,
   * então tentamos as variações conhecidas até uma responder com sucesso.
   */
  async sendMedia(
    creds: MegaCredentials,
    input: {
      to: string;
      url: string;
      mediaType: "audio" | "image" | "video" | "document";
      mimeType?: string | null;
      fileName?: string | null;
      caption?: string | null;
    },
  ) {
    const fileName = input.fileName ?? `arquivo-${Date.now()}`;
    const caption = input.caption ?? "";
    const attempts: Array<{ path: string; body: Record<string, unknown> }> = [
      {
        path: `/rest/sendMessage/${creds.instanceKey}/mediaUrl`,
        body: {
          messageData: {
            to: input.to,
            url: input.url,
            type: input.mediaType,
            mimeType: input.mimeType ?? undefined,
            fileName,
            caption,
          },
        },
      },
      {
        path: `/rest/sendMessage/${creds.instanceKey}/${input.mediaType}`,
        body: {
          messageData: {
            to: input.to,
            url: input.url,
            mimeType: input.mimeType ?? undefined,
            fileName,
            caption,
          },
        },
      },
      {
        path: `/rest/sendMessage/${creds.instanceKey}/mediaUrl`,
        body: {
          messageData: { to: input.to, url: input.url, type: input.mediaType, caption },
        },
      },
    ];

    let last: MegaResult<{ key?: { id?: string }; messageId?: string }> = {
      ok: false,
      error: "Não foi possível enviar a mídia pela MEGA API.",
    };
    for (const attempt of attempts) {
      const result = await request<{ key?: { id?: string }; messageId?: string }>(creds, attempt.path, {
        method: "POST",
        body: attempt.body,
      });
      if (result.ok) return result;
      last = result;
      if (result.status === 401 || result.status === 403) return result;
    }
    return last;
  },

  /**
   * Download de mídia recebida. A MEGA aceita formatos de corpo diferentes
   * conforme a versão do servidor (algumas exigem o objeto completo da
   * mensagem, outras apenas a chave), então tentamos as variações conhecidas.
   */
  async downloadMedia(creds: MegaCredentials, messageKey: unknown, messagePayload: unknown) {
    type DownloadResponse = {
      data?: string;
      base64?: string;
      buffer?: string;
      mediaUrl?: string;
      fileURL?: string;
      url?: string;
      mimetype?: string;
      mimeType?: string;
    };

    const key = (messageKey ?? {}) as Record<string, unknown>;

    // Contrato oficial: messageKeys contém os dados criptográficos da mídia e
    // messageType normalizado (audio|video|document|image). O valor cru do
    // webhook, como `audioMessage`, não é aceito pela MEGA.
    const stack: unknown[] = [messagePayload];
    let mediaNode: Record<string, unknown> | null = null;
    let messageType: "audio" | "video" | "document" | "image" | null = null;
    while (stack.length > 0 && !mediaNode) {
      const current = stack.pop();
      if (!current || typeof current !== "object") continue;
      for (const [name, value] of Object.entries(current as Record<string, unknown>)) {
        if (value && typeof value === "object") {
          if (/^(audio|video|document|image)Message$/i.test(name)) {
            mediaNode = value as Record<string, unknown>;
            const normalizedType = name.replace(/Message$/i, "").toLowerCase();
            if (
              normalizedType === "audio" ||
              normalizedType === "video" ||
              normalizedType === "document" ||
              normalizedType === "image"
            ) {
              messageType = normalizedType;
            }
            break;
          }
          stack.push(value);
        }
      }
    }

    const messageKeys = mediaNode && messageType
      ? {
          mediaKey: mediaNode["mediaKey"],
          directPath: mediaNode["directPath"],
          url: mediaNode["url"],
          mimetype: mediaNode["mimetype"] ?? mediaNode["mimeType"],
          messageType,
        }
      : null;
    const full = { key, message: messagePayload };
    const bodies: unknown[] = messageKeys
      ? [{ messageKeys }]
      : [{ messageKeys: full }, { messageKeys: key, message: messagePayload }];

    const paths = [
      `/rest/instance/downloadMediaMessage/${creds.instanceKey}`,
      `/rest/instance/downloadMedia/${creds.instanceKey}`,
      `/rest/message/downloadMedia/${creds.instanceKey}`,
    ];

    let last: MegaResult<DownloadResponse> = { ok: false, error: "sem tentativa" };
    for (const path of paths) {
      let pathUnsupported = false;
      for (const body of bodies) {
        const result = await request<DownloadResponse>(creds, path, { method: "POST", body });
        if (result.ok) {
          const data = result.data ?? {};
          const hasPayload =
            Boolean(data.data ?? data.base64 ?? data.buffer) ||
            typeof (data.url ?? data.mediaUrl ?? data.fileURL) === "string";
          if (hasPayload) return result;
          last = { ok: false, error: "resposta sem mídia" };
          continue;
        }
        last = result;
        if (result.status === 401 || result.status === 403) return result;
        // Endpoint inexistente nesta versão da MEGA: não insistir com outros corpos.
        if (result.status === 404) {
          pathUnsupported = true;
          break;
        }
      }
      if (!pathUnsupported && last.ok === false && last.error === "resposta sem mídia") continue;
    }
    return last;
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

  /**
   * Configura/reconfigura o webhook central para a instância.
   * A MEGA aceita formatos de corpo diferentes conforme a versão do servidor,
   * então tentamos as variações conhecidas até uma responder com sucesso.
   */
  async setWebhook(creds: MegaCredentials, webhookUrl: string) {
    const variants: Array<Record<string, unknown>> = [
      { messageData: { webhookUrl, webhookEnabled: true } },
      { webhookUrl, webhookEnabled: true },
      { webhookData: { webhookUrl, webhookEnabled: true } },
    ];

    let last: MegaResult<Record<string, unknown>> = {
      ok: false,
      error: "Não foi possível configurar o webhook na MEGA API.",
    };
    for (const body of variants) {
      const result = await request<Record<string, unknown>>(
        creds,
        `/rest/webhook/${creds.instanceKey}/configWebhook`,
        { method: "POST", body },
      );
      if (result.ok) return result;
      last = result;
      // Token inválido não melhora com outro formato de corpo.
      if (result.status === 401 || result.status === 403) return result;
    }
    return last;
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
