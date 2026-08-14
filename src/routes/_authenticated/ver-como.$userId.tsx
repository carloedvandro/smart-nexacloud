import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Eye } from "lucide-react";

import { AppShell } from "@/components/nexa/app-shell";
import { ConnectionStatusPanel } from "@/components/nexa/connection-status-panel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/ver-como/$userId")({
  head: () => ({
    meta: [
      { title: "Ver como usuário — NexaAtende" },
      {
        name: "description",
        content: "Visão do administrador sobre a conexão e o histórico de um usuário da equipe.",
      },
      { property: "og:title", content: "Ver como usuário — NexaAtende" },
      { property: "og:description", content: "Modo de acompanhamento de usuário." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ImpersonatePage,
});

function ImpersonatePage() {
  const { userId } = useParams({ from: "/_authenticated/ver-como/$userId" });

  useEffect(() => {
    void supabase.rpc("log_impersonation", { _target_user_id: userId });
  }, [userId]);

  const profileQuery = useQuery({
    queryKey: ["impersonate-profile", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, company_id, document, availability")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const profile = profileQuery.data;

  return (
    <AppShell
      title={`Ver como ${profile?.full_name ?? profile?.email ?? "usuário"}`}
      description="Modo somente leitura — as ações continuam registradas na sua conta"
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to="/consultores">Sair do modo</Link>
        </Button>
      }
    >
      <div className="mb-4 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
        <Eye className="size-4 text-primary" />
        Você está acompanhando outro usuário. Tudo aqui é auditado.
      </div>

      {profileQuery.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : !profile ? (
        <p className="text-sm text-muted-foreground">Usuário não encontrado.</p>
      ) : (
        <ConnectionStatusPanel userId={profile.id} companyId={profile.company_id} />
      )}
    </AppShell>
  );
}
