import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { ModulePage } from "@/components/nexa/module-page";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { AVAILABILITY_LABEL, type Availability } from "@/lib/nexa/domain";

export const Route = createFileRoute("/_authenticated/consultores")({
  head: () => ({
    meta: [
      { title: "Consultores — NexaAtende" },
      {
        name: "description",
        content: "Equipe de consultores, papéis de acesso e disponibilidade para receber atendimentos.",
      },
      { property: "og:title", content: "Consultores — NexaAtende" },
      { property: "og:description", content: "Gestão da equipe de atendimento." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ConsultantsPage,
});

type Row = {
  id: string;
  full_name: string | null;
  email: string | null;
  availability: Availability;
  is_active: boolean;
};

function ConsultantsPage() {
  const { companyId } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["team", companyId],
    enabled: Boolean(companyId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, availability, is_active")
        .eq("company_id", companyId as string)
        .order("full_name", { ascending: true })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  return (
    <ModulePage
      title="Consultores"
      description="Equipe, papéis e disponibilidade"
      phase="Fase 2"
      scope={[
        "Convite e cadastro de consultores pelo administrador",
        "Ativação e desativação sem perda de histórico",
        "Alteração de papel (administrador / consultor)",
        "Disponibilidade em tempo real (online, pausado, ocupado, offline)",
        "Limite de atendimentos simultâneos por consultor",
      ]}
    >
      <Card className="shadow-panel">
        <CardHeader>
          <CardTitle className="text-base">Equipe atual</CardTitle>
          <CardDescription>Usuários vinculados à sua empresa.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : data && data.length > 0 ? (
            data.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{member.full_name ?? "Sem nome"}</p>
                  <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={member.availability === "ONLINE" ? "default" : "secondary"}>
                    {AVAILABILITY_LABEL[member.availability]}
                  </Badge>
                  {!member.is_active ? <Badge variant="outline">Inativo</Badge> : null}
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum usuário cadastrado ainda.</p>
          )}
        </CardContent>
      </Card>
    </ModulePage>
  );
}
