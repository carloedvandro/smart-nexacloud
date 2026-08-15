import { createFileRoute, Link } from "@tanstack/react-router";
import { Bot, ShieldCheck, Timer, Workflow } from "lucide-react";

import ogImage from "@/assets/nexa-og.jpg.asset.json";
import { NexaLogo } from "@/components/nexa/logo";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NexaAtende — Atendimento inteligente para leads de WhatsApp" },
      {
        name: "description",
        content:
          "Plataforma de atendimento com IA, fila automática com SLA e CRM de leads no WhatsApp. Leads nunca mais sem resposta.",
      },
      { property: "og:title", content: "NexaAtende — Atendimento inteligente" },
      {
        property: "og:description",
        content:
          "IA de qualificação, fila automática com SLA e CRM de leads integrados ao WhatsApp.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://nexaatende.yrwentechnology.com.br/" },
      { property: "og:image", content: `https://nexaatende.yrwentechnology.com.br${ogImage.url}` },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: `https://nexaatende.yrwentechnology.com.br${ogImage.url}` },
    ],
    links: [{ rel: "canonical", href: "https://nexaatende.yrwentechnology.com.br/" }],
  }),
  component: Landing,
});

const PILLARS = [
  {
    icon: Bot,
    title: "IA que qualifica",
    text: "Responde na hora, coleta os dados do lead e nunca inventa preço, cobertura ou carência.",
  },
  {
    icon: Timer,
    title: "SLA de 60 segundos",
    text: "Contador no servidor, reatribuição automática e nenhum lead esquecido na fila.",
  },
  {
    icon: Workflow,
    title: "Fila com rodízio",
    text: "Distribuição justa entre consultores online, respeitando limite de atendimentos.",
  },
  {
    icon: ShieldCheck,
    title: "Seguro por padrão",
    text: "Isolamento total por empresa, papéis de acesso e trilha de auditoria desde o primeiro dia.",
  },
];

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <NexaLogo />
        <Button asChild variant="outline">
          <Link to="/auth">Entrar</Link>
        </Button>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-24">
        <section className="py-16 text-center">
          <p className="text-sm font-medium tracking-widest text-primary uppercase">
            Plataforma de atendimento
          </p>
          <h1 className="mx-auto mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Atendimento inteligente. Leads nunca mais sem resposta.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground">
            IA de primeiro atendimento, transferência para consultores humanos com SLA controlado e
            um CRM que guarda a memória de cada cliente.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Button asChild size="lg">
              <Link to="/auth">Acessar o sistema</Link>
            </Button>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PILLARS.map((pillar) => (
            <article
              key={pillar.title}
              className="bg-surface-gradient rounded-xl border border-border p-6 shadow-panel"
            >
              <pillar.icon className="size-5 text-primary" />
              <h2 className="mt-4 text-sm font-semibold">{pillar.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{pillar.text}</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
