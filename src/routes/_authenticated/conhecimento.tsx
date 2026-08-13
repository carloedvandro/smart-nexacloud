import { createFileRoute } from "@tanstack/react-router";

import { ModulePage } from "@/components/nexa/module-page";

export const Route = createFileRoute("/_authenticated/conhecimento")({
  head: () => ({
    meta: [
      { title: "Conhecimento IA — NexaAtende" },
      {
        name: "description",
        content: "Base de conhecimento usada pela IA: planos, operadoras, coberturas, carências e FAQ.",
      },
      { property: "og:title", content: "Conhecimento IA — NexaAtende" },
      { property: "og:description", content: "Base de conhecimento da inteligência artificial." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <ModulePage
      title="Conhecimento IA"
      description="Base oficial consultada pela inteligência artificial"
      phase="Fase 5"
      scope={[
        "Cadastro de conteúdos por categoria (planos, operadoras, preços, coberturas, carências, FAQ, processos)",
        "Publicação com rascunho, ativo e arquivado",
        "Regra absoluta: a IA nunca inventa preço, cobertura, carência, operadora ou regra comercial",
        "Encaminhamento imediato para humano quando não houver informação confiável",
        "Estrutura preparada para busca semântica (RAG) na evolução do módulo",
      ]}
    />
  ),
});
