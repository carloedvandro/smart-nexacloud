import { createFileRoute } from "@tanstack/react-router";

import { ModulePage } from "@/components/nexa/module-page";

export const Route = createFileRoute("/_authenticated/leads")({
  head: () => ({
    meta: [
      { title: "Leads — NexaAtende" },
      {
        name: "description",
        content: "CRM de leads com origem de campanha, memória do cliente e histórico de atendimento.",
      },
      { property: "og:title", content: "Leads — NexaAtende" },
      { property: "og:description", content: "CRM de leads do NexaAtende." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <ModulePage
      title="Leads"
      description="CRM, memória e histórico do cliente"
      phase="Fase 3"
      scope={[
        "Listagem paginada com filtros por situação, origem e consultor",
        "Ficha do lead com dados dinâmicos (dependentes, plano, faixa de preço)",
        "Memória persistente separada do histórico bruto de mensagens",
        "Anotações internas do consultor",
        "Rastreamento de campanha (utm, campanha e anúncio)",
        "Linha do tempo com todas as conversas do lead",
      ]}
    />
  ),
});
