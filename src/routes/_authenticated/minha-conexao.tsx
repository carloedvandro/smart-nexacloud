import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/nexa/app-shell";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { ConnectionStatusPanel } from "@/components/nexa/connection-status-panel";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/minha-conexao")({
  head: () => ({
    meta: [
      { title: "Minha conexão — NexaAtende" },
      {
        name: "description",
        content:
          "Veja se o seu WhatsApp está conectado ao NexaAtende e acompanhe o histórico dos seus atendimentos.",
      },
      { property: "og:title", content: "Minha conexão — NexaAtende" },
      { property: "og:description", content: "Status da sua instância de WhatsApp." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MyConnectionPage,
});

function MyConnectionPage() {
  const { profile } = useAuth();

  return (
    <AppShell title="Minha conexão" description="Como você recebe e atende os leads">
      <div className="space-y-4">
        <Card className="shadow-panel">
          <CardHeader>
            <CardTitle className="text-base">Você não precisa conectar seu WhatsApp</CardTitle>
            <CardDescription>
              Todo o atendimento sai pelo WhatsApp tronco da empresa. Seu número pessoal serve apenas
              para receber o aviso da oportunidade com o link da conversa — e você responde ao lead
              aqui pelo painel. Mantenha seu telefone atualizado em Configurações › Perfil.
            </CardDescription>
          </CardHeader>
        </Card>
        <ConnectionStatusPanel userId={profile?.id ?? null} companyId={profile?.company_id ?? null} />
      </div>
    </AppShell>
  );
}

