import { createFileRoute } from "@tanstack/react-router";

import { ModulePage } from "@/components/nexa/module-page";

export const Route = createFileRoute("/_authenticated/whatsapp")({
  head: () => ({
    meta: [
      { title: "WhatsApp — NexaAtende" },
      {
        name: "description",
        content: "Conexões de WhatsApp da empresa: instâncias, status de conexão e QR code.",
      },
      { property: "og:title", content: "WhatsApp — NexaAtende" },
      { property: "og:description", content: "Gestão das conexões de WhatsApp." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <ModulePage
      title="WhatsApp"
      description="Conexões, instâncias e status"
      phase="Fase 4"
      scope={[
        "Camada de serviço única para o provedor (criar instância, status, QR code, conectar, desconectar, enviar)",
        "Webhook de recebimento com validação, idempotência e processamento assíncrono",
        "Número tratado como conexão, separado da identidade do consultor",
        "Status de conexão atualizado em tempo real no painel",
        "Credenciais do provedor guardadas apenas no backend",
      ]}
    />
  ),
});
