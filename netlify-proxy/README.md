# Proxy de domínio (Netlify) — nexaatende.yrwentechnology.com.br

Enquanto o serviço de domínios do Lovable estiver instável, o subdomínio
aponta para o Netlify, que repassa 100% do tráfego para o app publicado
(`https://smart-nexacloud.lovable.app`). Nada muda no backend: banco,
autenticação, storage, realtime e webhooks continuam no Lovable Cloud.

## 1. Criar o site no Netlify

Opção A (mais rápida, sem Git):

1. Baixe/copie **apenas esta pasta** `netlify-proxy` para o seu computador.
2. Acesse https://app.netlify.com/drop e arraste a pasta.
3. O site é criado com um nome aleatório (ex.: `zesty-otter-123.netlify.app`).

Opção B (Git): suba esta pasta em um repositório e conecte no Netlify com
"Base directory" = `netlify-proxy`.

## 2. Conectar o subdomínio

No Netlify: **Site configuration → Domain management → Add domain** →
`nexaatende.yrwentechnology.com.br`.

## 3. DNS na GoDaddy (zona yrwentechnology.com.br)

Remova o registro **A** antigo de `nexaatende` (185.158.133.1) e o TXT
`_lovable.nexaatende`, depois crie:

| Tipo  | Nome         | Valor                          | TTL   |
|-------|--------------|--------------------------------|-------|
| CNAME | nexaatende   | <seu-site>.netlify.app         | 600   |

(O Netlify mostra o valor exato na tela de domínio.)

## 4. SSL

Após a propagação (5–30 min), em **Domain management → HTTPS** clique em
**Verify DNS configuration** e depois **Provision certificate**. O Let's
Encrypt é emitido automaticamente.

## 5. Depois que o domínio estiver no ar

Atualizar `PUBLIC_BASE_URL` em `src/lib/nexa/public-url.ts` para
`https://nexaatende.yrwentechnology.com.br` (links de convite) e informar
essa URL de webhook na MEGA API:

```
https://nexaatende.yrwentechnology.com.br/api/public/whatsapp/webhook
```

## Observações

- O proxy usa `status = 200`, então a URL na barra do navegador permanece
  no seu domínio (não redireciona para o lovable.app).
- Sempre que publicar no Lovable, o domínio já serve a versão nova — não
  é necessário republicar no Netlify.
