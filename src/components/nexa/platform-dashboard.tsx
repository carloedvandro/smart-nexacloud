import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Building2,
  MessagesSquare,
  Send,
  Smartphone,
  UserPlus,
  Users,
  Wifi,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getPlatformOverview } from "@/lib/platform/platform.functions";

export function PlatformDashboard() {
  const fetchOverview = useServerFn(getPlatformOverview);
  const { data, isLoading } = useQuery({
    queryKey: ["platform-overview"],
    queryFn: () => fetchOverview(),
    refetchInterval: 60_000,
  });

  const cards = [
    {
      label: "Empresas",
      value: data?.companies,
      hint: `${data?.activeCompanies ?? 0} ativas`,
      icon: Building2,
    },
    {
      label: "Instâncias contratadas",
      value: data?.instances,
      hint: `${data?.availableInstances ?? 0} disponíveis`,
      icon: Smartphone,
    },
    {
      label: "Instâncias conectadas",
      value: data?.connectedInstances,
      hint: "WhatsApp online agora",
      icon: Wifi,
    },
    { label: "Usuários na plataforma", value: data?.users, hint: "Perfis criados", icon: Users },
    { label: "Leads hoje", value: data?.leadsToday, hint: "Todas as empresas", icon: Users },
    {
      label: "Conversas abertas",
      value: data?.openConversations,
      hint: "Todas as empresas",
      icon: MessagesSquare,
    },
    { label: "Mensagens hoje", value: data?.messagesToday, hint: "Entrada e saída", icon: Send },
    {
      label: "Convites pendentes",
      value: data?.pendingInvites,
      hint: "Aguardando aceite",
      icon: UserPlus,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label} className="bg-surface-gradient shadow-panel">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.label}
              </CardTitle>
              <card.icon className="size-4 text-primary" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <p className="text-3xl font-semibold tracking-tight">{card.value ?? 0}</p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">{card.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="shadow-panel">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Empresas recentes</CardTitle>
            <CardDescription>
              Últimas empresas cadastradas na plataforma e suas instâncias contratadas.
            </CardDescription>
          </div>
          <Button asChild size="sm">
            <Link to="/plataforma">Gerenciar plataforma</Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : data?.recentCompanies.length ? (
            data.recentCompanies.map((company) => (
              <div
                key={company.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{company.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {company.instanceCount} instância(s) ·{" "}
                    {new Date(company.createdAt).toLocaleDateString("pt-BR")}
                  </p>
                </div>
                <Badge variant={company.status === "ACTIVE" ? "secondary" : "outline"}>
                  {company.status}
                </Badge>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhuma empresa cadastrada ainda. Use o painel Plataforma para criar a primeira.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
