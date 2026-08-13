import { createFileRoute } from "@tanstack/react-router";

import { ModulePage } from "@/components/nexa/module-page";

export const Route = createFileRoute("/_authenticated/relatorios")({
  head: () => ({
    meta: [
      { title: "Relatórios — NexaAtende" },
      {
        name: "description",
        content: "Relatórios operacionais: volume de leads, tempo de resposta, conversão e desempenho da equipe.",
      },
      { property: "og:title", content: "Relatórios — NexaAtende" },
      { property: "og:description", content: "Indicadores e relatórios do atendimento." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <ModulePage
      title="Relatórios"
      description="Indicadores operacionais e de conversão"
      phase="Fase 6"
      scope={[
        "Volume de leads por período, origem e campanha",
        "Tempo médio de primeira resposta e de atendimento",
        "Taxa de conversão por consultor e por origem",
        "Timeouts, transferências e reatribuições da fila",
        "Exportação dos dados filtrados",
      ]}
    />
  ),
});
