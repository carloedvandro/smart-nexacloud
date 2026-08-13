import { createFileRoute } from "@tanstack/react-router";

import { ModulePage } from "@/components/nexa/module-page";

export const Route = createFileRoute("/_authenticated/fila")({
  head: () => ({
    meta: [
      { title: "Fila — NexaAtende" },
      {
        name: "description",
        content: "Motor de fila com rodízio automático, SLA de resposta e reatribuição por timeout.",
      },
      { property: "og:title", content: "Fila — NexaAtende" },
      { property: "og:description", content: "Distribuição automática de atendimentos." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <ModulePage
      title="Fila"
      description="Rodízio automático, SLA e reatribuição"
      phase="Fase 4"
      scope={[
        "Atribuição automática apenas para consultores online e dentro do limite de carga",
        "Contador de SLA no backend, nunca no navegador",
        "Reatribuição automática quando o consultor não responde no prazo",
        "Registro de cada tentativa: aceita, expirada ou recusada",
        "Regra crítica: nenhum lead pode ficar sem resposta",
      ]}
    />
  ),
});
