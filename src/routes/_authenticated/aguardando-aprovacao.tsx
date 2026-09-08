import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Clock, LogOut, RefreshCw } from "lucide-react";

import { NexaLogo } from "@/components/nexa/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/aguardando-aprovacao")({
  head: () => ({
    meta: [
      { title: "Aguardando aprovação — NexaAtende" },
      {
        name: "description",
        content: "Seu cadastro de empresa está em análise pelo administrador do NexaAtende.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PendingApprovalPage,
});

function PendingApprovalPage() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  const statusQuery = useQuery({
    queryKey: ["my-company-status"],
    enabled: Boolean(profile?.company_id),
    refetchInterval: 20_000,
    queryFn: async () => {
      const { data } = await supabase.rpc("my_company_status");
      return (data as string | null) ?? null;
    },
  });

  const status = statusQuery.data;

  useEffect(() => {
    if (status === "ACTIVE") void navigate({ to: "/dashboard", replace: true });
  }, [status, navigate]);

  const suspended = status === "SUSPENDED" || status === "INACTIVE";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-lg">
        <NexaLogo className="mb-8" />
        <Card className="shadow-panel">
          <CardHeader>
            <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-muted">
              <Clock className="size-5 text-muted-foreground" />
            </div>
            <CardTitle>
              {suspended ? "Acesso suspenso" : "Aguarde a aprovação do administrador"}
            </CardTitle>
            <CardDescription>
              {suspended
                ? "O acesso desta empresa está temporariamente bloqueado. Fale com o administrador do sistema."
                : "Seu cadastro foi recebido e está em análise. Assim que o administrador do sistema liberar o acesso, esta tela abre o painel automaticamente."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border border-border px-3 py-2 text-sm">
              <p className="font-medium">{profile?.full_name ?? profile?.email}</p>
              <p className="text-xs text-muted-foreground">
                Situação: {suspended ? "suspenso" : "aguardando aprovação"}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => void statusQuery.refetch()}
                disabled={statusQuery.isFetching}
              >
                <RefreshCw className="mr-1.5 size-4" /> Verificar novamente
              </Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  await signOut();
                  void navigate({ to: "/auth", replace: true });
                }}
              >
                <LogOut className="mr-1.5 size-4" /> Sair
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
