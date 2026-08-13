import { createFileRoute } from "@tanstack/react-router";

import { ModulePage } from "@/components/nexa/module-page";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — NexaAtende" },
      {
        name: "description",
        content: "Configurações da empresa: fila, SLA, horário de atendimento, privacidade e auditoria.",
      },
      { property: "og:title", content: "Configurações — NexaAtende" },
      { property: "og:description", content: "Parâmetros operacionais da empresa." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <ModulePage
      title="Configurações"
      description="Fila, SLA, horários, privacidade e auditoria"
      phase="Fase 2 e 3"
      scope={[
        "SLA de resposta configurável (padrão de 60 segundos) e número de tentativas",
        "Modo de distribuição da fila (rodízio, menor carga, prioridade)",
        "Horário de atendimento por dia da semana e fuso horário",
        "Consentimento de privacidade e retenção de dados (LGPD)",
        "Trilha de auditoria das ações administrativas",
      ]}
    />
  ),
});
