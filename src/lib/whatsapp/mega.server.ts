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

function externalMessageId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Record<string, unknown>;
  const key = body["key"];
  if (key && typeof key === "object") {
    const id = (key as Record<string, unknown>)["id"];
    if (typeof id === "string" && id.trim()) return id;
  }
  const direct = body["messageId"] ?? body["id"];
  if (typeof direct === "string" && direct.trim()) return direct;
  const nested = body["data"] ?? body["response"] ?? body["result"];
  return nested === payload ? null : externalMessageId(nested);
}

function baseUrl(host: string) {
  const clean = host.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${clean}`;
}

function providerError(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Record<string, unknown>;
  const error = body["error"];
  if (error && error !== false) {
    const message = body["message"];
    return typeof message === "string" && message.trim()
      ? message
      : typeof error === "string"
        ? error
        : "A MEGA API recusou a operação.";
  }

  for (const key of ["data", "response", "result"] as const) {
    const nested = body[key];
    if (nested && nested !== payload) {
      const nestedError = providerError(nested);
      if (nestedError) return nestedError;
    }
  }
  return null;
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
    });

    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }

    // A MEGA API responde 200 mesmo em erro: validar o corpo.
    const bodyError = providerError(payload);

    if (!response.ok || bodyError) {
      const rawMessage =
        payload && typeof payload === "object" && "message" in payload
          ? String((payload as { message?: unknown }).message ?? "")
            : bodyError ?? "";
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

  /**
   * Envia uma mensagem de texto com um botão clicável (URL button).
   * A MEGA API (Baileys) aceita variações de formato, então tentamos cada
   * combinação conhecida até uma responder com sucesso. Se nenhuma funcionar,
   * cai para sendText com a URL em linha própria (clicável no WhatsApp).
   */
  async sendButtonMessage(
    creds: MegaCredentials,
    input: { to: string; text: string; url: string; buttonText: string; footer?: string },
  ) {
    const footer = input.footer ?? "";
    const button = { type: "url", url: input.url };
    const variants: Array<{ path: string; body: Record<string, unknown> }> = [
      {
        path: `/rest/sendMessage/${creds.instanceKey}/button`,
        body: {
          messageData: {
            to: input.to,
            text: input.text,
            footer,
            buttons: [{ ...button, title: input.buttonText }],
          },
        },
      },
      {
        path: `/rest/sendMessage/${creds.instanceKey}/button`,
        body: {
          messageData: {
            to: input.to,
            text: input.text,
            footer,
            buttons: [{ ...button, displayText: input.buttonText }],
          },
        },
      },
      {
        path: `/rest/sendMessage/${creds.instanceKey}/button`,
        body: {
          messageData: {
            to: input.to,
            content: input.text,
            footerText: footer,
            buttons: [{ ...button, title: input.buttonText }],
          },
        },
      },
      {
        path: `/rest/sendMessage/${creds.instanceKey}/button`,
        body: {
          messageData: {
            to: input.to,
            content: input.text,
            buttons: [{ ...button, displayText: input.buttonText }],
          },
        },
      },
    ];

    let last: MegaResult<{ key?: { id?: string }; messageId?: string }> = {
      ok: false,
      error: "Não foi possível enviar o botão pela MEGA API.",
    };
    for (const variant of variants) {
      const result = await request<{ key?: { id?: string }; messageId?: string }>(
        creds,
        variant.path,
        { method: "POST", body: variant.body },
      );
      if (result.ok) return result;
      last = result;
      if (result.status === 401 || result.status === 403) return result;
    }

    // Fallback: texto com a URL em linha própria (clicável no WhatsApp).
    const fallbackText = [input.text, "", input.url].join("\n");
    return MegaApiService.sendText(creds, input.to, fallbackText);
  },

  /**
   * Encaminha uma mensagem recebida preservando o formato nativo.
   * É o único caminho correto para reenviar figurinhas (stickerMessage):
   * mantém WebP animado, transparência e o comportamento de figurinha.
   */
  forwardMessage(
    creds: MegaCredentials,
    input: { to: string; key: unknown; message: unknown },
  ) {
    return request<{ key?: { id?: string }; messageId?: string }>(
      creds,
      `/rest/sendMessage/${creds.instanceKey}/forwardMessage`,
      {
        method: "POST",
        body: { messageData: { to: input.to, key: input.key, message: input.message } },
      },
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
    const isAudio = input.mediaType === "audio";
    const audioMimeType = input.mimeType || "audio/ogg; codecs=opus";
    const isOggOpus = /audio\/(ogg|opus)/i.test(audioMimeType);
    // Áudio gravado: "ptt" só quando o arquivo é OGG/Opus (formato nativo do
    // WhatsApp). MP3/M4A vão como "audio" — enviados como ptt eles chegam
    // "quebrados" e não abrem no aparelho do cliente.
    const audioType = isOggOpus ? "ptt" : "audio";
    const attempts: Array<{ path: string; body: Record<string, unknown> }> = isAudio
      ? [
          {
            path: `/rest/sendMessage/${creds.instanceKey}/mediaUrl`,
            body: {
              messageData: {
                to: input.to,
                url: input.url,
                type: audioType,
                mimeType: audioMimeType,
                fileName,
                caption,
              },
            },
          },
        ]
      : [
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
      if (result.ok) {
        // Resposta 200 = a MEGA aceitou e vai entregar. Nunca tentamos outro
        // endpoint depois disso, senão o cliente recebe o mesmo áudio várias vezes.
        const messageId = externalMessageId(result.data);
        console.info("[mega] mídia aceita", {
          path: attempt.path,
          tipo: input.mediaType,
          messageId: messageId ?? "sem-id",
        });
        return { ok: true as const, data: { ...(result.data ?? {}), ...(messageId ? { messageId } : {}) } };
      }
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
    type SerializedBuffer = { type?: string; data?: number[] };
    type DownloadResponse = {
      data?: string;
      base64?: string;
      buffer?: string | SerializedBuffer | number[];
      mediaUrl?: string;
      fileURL?: string;
      url?: string;
      mimetype?: string;
      mimeType?: string;
      response?: unknown;
      result?: unknown;
    };

    const stack: unknown[] = [messagePayload];
    let mediaNode: Record<string, unknown> | null = null;
    let messageType: "audio" | "video" | "document" | "image" | "sticker" | null = null;
    while (stack.length > 0 && !mediaNode) {
      const current = stack.pop();
      if (!current || typeof current !== "object") continue;
      const currentObject = current as Record<string, unknown>;
      // Há versões da MEGA que removem a chave `stickerMessage` e entregam
      // diretamente o objeto com os campos criptográficos da mídia.
      if (
        typeof currentObject["mediaKey"] === "string" &&
        typeof currentObject["directPath"] === "string" &&
        typeof currentObject["url"] === "string"
      ) {
        mediaNode = currentObject;
        const declared = String(
          currentObject["messageType"] ?? currentObject["mediaType"] ?? "",
        ).toLowerCase();
        const mime = String(currentObject["mimetype"] ?? currentObject["mimeType"] ?? "");
        messageType = /audio/.test(declared) || mime.startsWith("audio/")
          ? "audio"
          : /video/.test(declared) || mime.startsWith("video/")
            ? "video"
            : /document/.test(declared) || (!mime.startsWith("image/") && Boolean(mime))
              ? "document"
              : /sticker/.test(declared)
                ? "sticker"
                : "image";
        break;
      }
      for (const [name, value] of Object.entries(currentObject)) {
        if (!value || typeof value !== "object") continue;
        const normalized = name.replace(/Message$/i, "").toLowerCase();
        if (["audio", "video", "document", "image", "sticker"].includes(normalized)) {
          mediaNode = value as Record<string, unknown>;
          messageType = normalized as "audio" | "video" | "document" | "image" | "sticker";
          break;
        }
        stack.push(value);
      }
    }

    // Alguns eventos de figurinha da MEGA trazem apenas a `key` e o tipo
    // declarado, sem expor stickerMessage/mediaKey no webhook. A própria MEGA
    // consegue resolver a mídia pela chave; portanto o descritor é opcional e
    // nunca deve impedir as tentativas baseadas na key.
    const rawMime = mediaNode?.["mimetype"] ?? mediaNode?.["mimeType"];
    // Figurinhas nem sempre trazem mimetype no webhook; o padrão do WhatsApp é webp.
    const mimetype =
      typeof rawMime === "string" && rawMime.trim()
        ? rawMime
        : messageType === "sticker"
          ? "image/webp"
          : null;

    const key = (messageKey ?? {}) as Record<string, unknown>;
    const payloadObject =
      messagePayload && typeof messagePayload === "object"
        ? (messagePayload as Record<string, unknown>)
        : null;
    const fullMessage =
      payloadObject && "key" in payloadObject
        ? payloadObject
        : { key, message: messagePayload };
    const hasDescriptor = Boolean(
      mediaNode &&
        typeof mediaNode["mediaKey"] === "string" &&
        typeof mediaNode["directPath"] === "string" &&
        typeof mediaNode["url"] === "string",
    );
    const mediaDescriptor = hasDescriptor
      ? {
          mediaKey: mediaNode?.["mediaKey"],
          directPath: mediaNode?.["directPath"],
          url: mediaNode?.["url"],
          ...(mimetype ? { mimetype } : {}),
          // Contrato oficial da MEGA: sticker deve ser enviado como image.
          messageType: messageType === "sticker" ? "image" : messageType,
        }
      : null;

    // O endpoint varia entre versões da MEGA. As versões atuais esperam a
    // chave original do WhatsApp; instalações antigas aceitam a mensagem
    // completa ou o descritor criptográfico da mídia.
    const bodies: unknown[] = [
      // Formato oficial: descritor plano com os cinco campos obrigatórios.
      ...(mediaDescriptor ? [{ messageKeys: mediaDescriptor }] : []),
      // Compatibilidade com instalações antigas da MEGA.
      { messageKeys: key, type: "base64" },
      { messageKeys: fullMessage, type: "base64" },
      { messageKeys: key, type: "buffer" },
      { messageKeys: fullMessage, type: "buffer" },
    ];
    const paths = [
      `/rest/instance/downloadMediaMessage/${creds.instanceKey}`,
      `/rest/instance/downloadMedia/${creds.instanceKey}`,
      `/rest/message/downloadMedia/${creds.instanceKey}`,
    ];

    let last: MegaResult<DownloadResponse> = { ok: false, error: "MEGA API respondeu sem a mídia" };
    for (const path of paths) {
      for (const body of bodies) {
        const result = await request<DownloadResponse>(creds, path, { method: "POST", body });
        if (!result.ok) {
          last = result;
          if (result.status === 401 || result.status === 403) return result;
          if (result.status === 404) break;
          continue;
        }

        const raw = result.data ?? {};
        const nested =
          raw.response && typeof raw.response === "object"
            ? (raw.response as DownloadResponse)
            : raw.result && typeof raw.result === "object"
              ? (raw.result as DownloadResponse)
              : null;
        const data = nested ? { ...raw, ...nested } : raw;
        const hasMedia =
          Boolean(data.data ?? data.base64 ?? data.buffer) ||
          [data.url, data.mediaUrl, data.fileURL].some(
            (value) => typeof value === "string" && value.startsWith("http"),
          );
        if (hasMedia) return { ok: true as const, data };
        last = { ok: false, error: "MEGA API respondeu sem a mídia" };
      }
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
