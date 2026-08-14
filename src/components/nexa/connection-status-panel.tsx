import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { MessageCircle, Smartphone, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";

type ConnectionRow = {
  id: string;
  name: string | null;
  instance_number: number | null;
  status: string;
  phone_number: string | null;
  is_trunk: boolean;
  last_connected_at: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  CONNECTED: "Conectado",
  CONNECTING: "Conectando",
  DISCONNECTED: "Desconectado",
  LOGGED_OUT: "Sessão encerrada",
  ERROR: "Erro",
  AVAILABLE: "Disponível",
  BLOCKED: "Bloqueado",
};

export function ConnectionStatusPanel({
  userId,
  companyId,
}: {
  userId: string | null;
  companyId: string | null;
}) {
  const connectionQuery = useQuery({
    queryKey: ["my-connection", userId],
    enabled: Boolean(userId),
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_connections")
        .select("id, name, instance_number, status, phone_number, is_trunk, last_connected_at")
        .eq("user_id", userId as string)
        .order("instance_number", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ConnectionRow[];
    },
  });

  const companyQuery = useQuery({
    queryKey: ["my-company", companyId],
    enabled: Boolean(companyId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id, name")
        .eq("id", companyId as string)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const conversationsQuery = useQuery({
    queryKey: ["my-conversations", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, status, last_message_at, leads(name, whatsapp)")
        .eq("assigned_user_id", userId as string)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(15);
      if (error) throw error;
      return (data ?? []) as unknown as {
        id: string;
        status: string;
        last_message_at: string | null;
        leads: { name: string | null; whatsapp: string | null } | null;
      }[];
    },
  });

  const connections = connectionQuery.data ?? [];
  const connected = connections.filter((c) => c.status === "CONNECTED");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="size-5 text-primary" /> Status do WhatsApp
          </CardTitle>
          <CardDescription>
            {companyQuery.data?.name
              ? `Você está vinculado à empresa ${companyQuery.data.name}.`
              : "Você ainda não está vinculado a uma empresa."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {connectionQuery.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : connections.length === 0 ? (
            <div className="flex gap-3 rounded-lg border border-dashed border-border bg-muted/40 p-4">
              <TriangleAlert className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <div className="text-sm">
                <p className="font-medium">Nenhuma instância vinculada</p>
                <p className="text-muted-foreground">
                  Entre em contato com o seu gestor para que ele libere uma instância e gere o QR
                  Code de vinculação do seu WhatsApp.
                </p>
              </div>
            </div>
          ) : (
            connections.map((conn) => (
              <div
                key={conn.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {conn.name ?? `Instância ${conn.instance_number ?? ""}`}
                    {conn.is_trunk ? (
                      <Badge variant="outline" className="ml-2">
                        Número tronco
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {conn.phone_number
                      ? `Número: ${conn.phone_number}`
                      : "Aguardando leitura do QR Code pelo gestor"}
                  </p>
                </div>
                <Badge variant={conn.status === "CONNECTED" ? "default" : "secondary"}>
                  {STATUS_LABEL[conn.status] ?? conn.status}
                </Badge>
              </div>
            ))
          )}

          {connections.length > 0 && connected.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Sua instância está liberada, mas ainda não está ativa. Peça ao seu gestor para gerar o
              QR Code e conectar o seu WhatsApp.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="size-5 text-primary" /> Meus atendimentos
          </CardTitle>
          <CardDescription>Últimas conversas atribuídas a este usuário.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {conversationsQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (conversationsQuery.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum atendimento registrado ainda.</p>
          ) : (
            conversationsQuery.data!.map((conv) => (
              <div
                key={conv.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
              >
                <span className="truncate">
                  {conv.leads?.name ?? conv.leads?.whatsapp ?? "Lead sem nome"}
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {conv.last_message_at
                    ? new Date(conv.last_message_at).toLocaleString("pt-BR")
                    : "—"}
                  <Badge variant="outline">{conv.status}</Badge>
                </span>
              </div>
            ))
          )}
          <Button asChild variant="outline" size="sm" className="mt-2">
            <Link to="/conversas">Abrir central de conversas</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
