import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  Bot,
  Clock3,
  MessagesSquare,
  Repeat2,
  TimerReset,
  UserCheck,
  Users,
  Wifi,
} from "lucide-react";

import { AppShell } from "@/components/nexa/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { OPEN_CONVERSATION_STATUSES } from "@/lib/nexa/domain";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — NexaAtende" },
      {
        name: "description",
        content:
          "Indicadores em tempo real do atendimento: leads do dia, conversas abertas, IA ativa, fila e consultores online.",
      },
      { property: "og:title", content: "Dashboard — NexaAtende" },
      { property: "og:description", content: "Painel operacional do atendimento NexaAtende." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DashboardPage,
});

type Metrics = {
  leadsToday: number;
  openConversations: number;
  aiActive: number;
  waitingHuman: number;
  onlineConsultants: number;
  transfers: number;
  timeouts: number;
};

async function fetchMetrics(companyId: string): Promise<Metrics> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const iso = startOfDay.toISOString();

  const count = (q: { count: number | null }) => q.count ?? 0;

  const [leadsToday, openConversations, aiActive, waitingHuman, online, transfers, timeouts] =
    await Promise.all([
      supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .gte("created_at", iso),
      supabase
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .in("status", OPEN_CONVERSATION_STATUSES),
      supabase
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("status", "AI_ACTIVE"),
      supabase
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .in("status", ["WAITING_HUMAN", "QUEUED"]),
      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("availability", "ONLINE")
        .eq("is_active", true),
      supabase
        .from("conversation_assignments")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("status", "TRANSFERRED")
        .gte("assigned_at", iso),
      supabase
        .from("assignment_attempts")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("status", "TIMEOUT")
        .gte("assigned_at", iso),
    ]);

  return {
    leadsToday: count(leadsToday),
    openConversations: count(openConversations),
    aiActive: count(aiActive),
    waitingHuman: count(waitingHuman),
    onlineConsultants: count(online),
    transfers: count(transfers),
    timeouts: count(timeouts),
  };
}

function DashboardPage() {
  const { companyId, profile } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-metrics", companyId],
    queryFn: () => fetchMetrics(companyId as string),
    enabled: Boolean(companyId),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!companyId) return;
    const channel = supabase
      .channel("dashboard-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["dashboard-metrics", companyId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "assignment_attempts" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["dashboard-metrics", companyId] });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [companyId, queryClient]);

  const cards = [
    { label: "Leads hoje", value: data?.leadsToday, icon: Users },
    { label: "Conversas abertas", value: data?.openConversations, icon: MessagesSquare },
    { label: "IA atendendo", value: data?.aiActive, icon: Bot },
    { label: "Aguardando consultor", value: data?.waitingHuman, icon: Clock3 },
    { label: "Consultores online", value: data?.onlineConsultants, icon: UserCheck },
    { label: "Transferências hoje", value: data?.transfers, icon: Repeat2 },
    { label: "Timeouts hoje", value: data?.timeouts, icon: TimerReset },
  ];

  return (
    <AppShell
      title="Dashboard"
      description={`Bem-vindo, ${profile?.full_name ?? profile?.email ?? ""}`}
    >
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
            </CardContent>
          </Card>
        ))}

        <Card className="bg-surface-gradient shadow-panel">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Tempo médio de 1ª resposta
            </CardTitle>
            <Wifi className="size-4 text-primary" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tracking-tight text-muted-foreground">—</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Disponível quando o motor de fila entrar em operação.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6 shadow-panel">
        <CardHeader>
          <CardTitle className="text-base">Fundação concluída</CardTitle>
          <CardDescription>
            Banco multi-tenant, autenticação, papéis, políticas de acesso, armazenamento privado e
            tempo real já operando. Os indicadores acima leem dados reais da sua empresa e se
            atualizam automaticamente quando conversas e atribuições mudam.
          </CardDescription>
        </CardHeader>
      </Card>
    </AppShell>
  );
}
