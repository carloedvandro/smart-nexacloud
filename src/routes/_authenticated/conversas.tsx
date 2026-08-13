import { createFileRoute } from "@tanstack/react-router";

import { ModulePage } from "@/components/nexa/module-page";

export const Route = createFileRoute("/_authenticated/conversas")({
  head: () => ({
    meta: [
      { title: "Conversas — NexaAtende" },
      {
        name: "description",
        content: "Central de conversas do WhatsApp com histórico completo e atualização em tempo real.",
      },
      { property: "og:title", content: "Conversas — NexaAtende" },
      { property: "og:description", content: "Central de atendimento do NexaAtende." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <ModulePage
      title="Conversas"
      description="Central de atendimento em tempo real"
      phase="Fase 3 e 4"
      scope={[
        "Lista de conversas por situação (IA, fila, atribuída, humano ativo, encerrada)",
        "Thread de mensagens com paginação e mídias privadas",
        "Envio de texto e áudio pela camada de serviço do WhatsApp",
        "Resumo da IA e memória do lead no painel lateral",
        "Assumir, transferir e encerrar atendimento com registro de eventos",
        "Atualização automática via tempo real, sem recarregar a página",
      ]}
    />
  ),
});
