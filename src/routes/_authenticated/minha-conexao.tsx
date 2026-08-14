import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { MessageCircle, Smartphone, TriangleAlert } from "lucide-react";

import { AppShell } from "@/components/nexa/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { ConnectionStatusPanel } from "@/components/nexa/connection-status-panel";

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
    <AppShell
      title="Minha conexão"
      description="Status do seu WhatsApp e histórico de atendimentos"
    >
      <ConnectionStatusPanel userId={profile?.id ?? null} companyId={profile?.company_id ?? null} />
    </AppShell>
  );
}
