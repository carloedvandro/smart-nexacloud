import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Link2, Loader2, Plug, QrCode, RefreshCw, Unplug, User } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/nexa/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { listConsultants } from "@/lib/nexa/crm";
import { WHATSAPP_INSTANCE_STATUS_LABEL } from "@/lib/nexa/domain";
import { PhoneNormalizationService } from "@/lib/nexa/phone";
import {
  assignWhatsAppInstance,
  connectWhatsAppInstance,
  getWhatsAppWebhookUrl,
  listInstanceHistory,
  listWhatsAppInstances,
  provisionWhatsAppInstance,
  refreshWhatsAppInstance,
  releaseWhatsAppInstance,
  type WhatsAppInstance,
} from "@/lib/whatsapp/whatsapp.functions";

export const Route = createFileRoute("/_authenticated/whatsapp")({
  head: () => ({
    meta: [
      { title: "Instâncias de WhatsApp — NexaAtende" },
      {
        name: "description",
        content:
          "Instâncias de WhatsApp contratadas pela empresa: colaborador vinculado, número conectado e QR Code.",
      },
      { property: "og:title", content: "Instâncias de WhatsApp — NexaAtende" },
      { property: "og:description", content: "Gestão das instâncias de WhatsApp da empresa." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: WhatsAppPage,
});

function statusTone(status: string) {
  if (status === "CONNECTED") return "default" as const;
  if (status === "AVAILABLE") return "secondary" as const;
  if (status === "CONNECTING") return "outline" as const;
  return "destructive" as const;
}

function WhatsAppPage() {
  const { companyId, isAdmin } = useAuth();
  const queryClient = useQueryClient();

  const fetchInstances = useServerFn(listWhatsAppInstances);
  const assignFn = useServerFn(assignWhatsAppInstance);
  const releaseFn = useServerFn(releaseWhatsAppInstance);
  const connectFn = useServerFn(connectWhatsAppInstance);
  const refreshFn = useServerFn(refreshWhatsAppInstance);
  const provisionFn = useServerFn(provisionWhatsAppInstance);

  const [assignTarget, setAssignTarget] = useState<WhatsAppInstance | null>(null);
  const [assignUser, setAssignUser] = useState<string>("");
  const [qrTarget, setQrTarget] = useState<WhatsAppInstance | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [historyTarget, setHistoryTarget] = useState<WhatsAppInstance | null>(null);
  const [provisionOpen, setProvisionOpen] = useState(false);
  const [instanceKey, setInstanceKey] = useState("");
  const [instanceName, setInstanceName] = useState("");

  const instancesQuery = useQuery({
    queryKey: ["whatsapp-instances", companyId],
    queryFn: () => fetchInstances(),
    refetchInterval: qrTarget ? 5000 : 30000,
  });

  const consultantsQuery = useQuery({
    queryKey: ["team", companyId],
    enabled: Boolean(companyId),
    queryFn: () => listConsultants(companyId as string),
  });

  const platformAdminQuery = useQuery({
    queryKey: ["is-platform-admin"],
    queryFn: async () => {
      const { data } = await supabase.rpc("is_platform_admin");
      return Boolean(data);
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["whatsapp-instances"] });

  const assignMutation = useMutation({
    mutationFn: (input: { connectionId: string; userId: string }) => assignFn({ data: input }),
    onSuccess: () => {
      toast.success("Colaborador vinculado à instância.");
      setAssignTarget(null);
      setAssignUser("");
      void invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const releaseMutation = useMutation({
    mutationFn: (connectionId: string) => releaseFn({ data: { connectionId } }),
    onSuccess: (result) => {
      toast.success(
        result.logout
          ? "Instância liberada e WhatsApp deslogado. O histórico foi preservado."
          : "Instância liberada. O logout na MEGA API não pôde ser confirmado.",
      );
      void invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const connectMutation = useMutation({
    mutationFn: (connectionId: string) => connectFn({ data: { connectionId } }),
    onSuccess: (result) => {
      if (result.status === "CONNECTED") {
        toast.success("Instância já está conectada.");
        setQrTarget(null);
      } else if (result.qrCode) {
        setQrCode(result.qrCode);
      } else {
        toast.error(result.error ?? "Não foi possível obter o QR Code.");
      }
      void invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const refreshMutation = useMutation({
    mutationFn: (connectionId: string) => refreshFn({ data: { connectionId } }),
    onSuccess: (result) => {
      toast.success(`Situação: ${WHATSAPP_INSTANCE_STATUS_LABEL[result.status] ?? result.status}`);
      if (result.status === "CONNECTED") {
        setQrTarget(null);
        setQrCode(null);
      }
      void invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const provisionMutation = useMutation({
    mutationFn: () =>
      provisionFn({
        data: { instanceKey, ...(instanceName.trim() ? { name: instanceName.trim() } : {}) },
      }),
    onSuccess: () => {
      toast.success("Instância provisionada.");
      setProvisionOpen(false);
      setInstanceKey("");
      setInstanceName("");
      void invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Enquanto o QR Code está aberto, verificamos a conexão periodicamente.
  useEffect(() => {
    if (!qrTarget) return;
    const timer = setInterval(() => refreshMutation.mutate(qrTarget.id), 8000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrTarget?.id]);

  const instances = instancesQuery.data ?? [];
  const available = instances.filter((i) => !i.assignedUserId).length;

  return (
    <AppShell>
      <div className="space-y-6 p-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Instâncias de WhatsApp</h1>
            <p className="text-sm text-muted-foreground">
              Conexões contratadas pela empresa. A instância é permanente — o colaborador e o número
              podem mudar sem perder o histórico.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{instances.length} contratadas</Badge>
            <Badge variant="outline">{available} disponíveis</Badge>
            {platformAdminQuery.data ? (
              <Button size="sm" onClick={() => setProvisionOpen(true)}>
                Provisionar instância
              </Button>
            ) : null}
          </div>
        </header>

        {instancesQuery.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : instances.length === 0 ? (
          <Card className="shadow-panel">
            <CardHeader>
              <CardTitle className="text-base">Nenhuma instância provisionada</CardTitle>
              <CardDescription>
                As instâncias são contratadas na MEGA API e provisionadas manualmente pela operação da
                plataforma. Assim que forem cadastradas, aparecerão aqui.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {instances.map((instance) => (
              <Card key={instance.id} className="shadow-panel">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{instance.name ?? "Instância"}</CardTitle>
                    <Badge variant={statusTone(instance.status)}>
                      {WHATSAPP_INSTANCE_STATUS_LABEL[instance.status] ?? instance.status}
                    </Badge>
                  </div>
                  <CardDescription className="flex items-center gap-1.5">
                    <User className="size-3.5" />
                    {instance.assignedUserName ?? "Sem colaborador vinculado"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm">
                    <span className="text-muted-foreground">WhatsApp: </span>
                    {instance.phoneNumber
                      ? PhoneNormalizationService.format(instance.phoneNumber)
                      : "—"}
                  </p>
                  {!instance.hasCredentials ? (
                    <p className="text-xs text-destructive">
                      Instância sem credencial cadastrada. Fale com a operação da plataforma.
                    </p>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    {isAdmin ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setAssignTarget(instance);
                          setAssignUser(instance.assignedUserId ?? "");
                        }}
                      >
                        <Link2 className="mr-1.5 size-3.5" />
                        {instance.assignedUserId ? "Trocar colaborador" : "Vincular colaborador"}
                      </Button>
                    ) : null}

                    {instance.assignedUserId ? (
                      <Button
                        size="sm"
                        onClick={() => {
                          setQrTarget(instance);
                          setQrCode(instance.qrCode);
                          connectMutation.mutate(instance.id);
                        }}
                      >
                        <QrCode className="mr-1.5 size-3.5" />
                        Conectar
                      </Button>
                    ) : null}

                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => refreshMutation.mutate(instance.id)}
                    >
                      <RefreshCw className="mr-1.5 size-3.5" />
                      Atualizar
                    </Button>

                    <Button size="sm" variant="ghost" onClick={() => setHistoryTarget(instance)}>
                      Histórico
                    </Button>

                    {isAdmin && instance.assignedUserId ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => releaseMutation.mutate(instance.id)}
                        disabled={releaseMutation.isPending}
                      >
                        <Unplug className="mr-1.5 size-3.5" />
                        Liberar instância
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {isAdmin ? <WebhookCard instances={instances} /> : null}
      </div>

      {/* Vincular colaborador */}
      <Dialog open={Boolean(assignTarget)} onOpenChange={(open) => !open && setAssignTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vincular colaborador</DialogTitle>
            <DialogDescription>
              {assignTarget?.name} — a instância continua pertencendo à empresa; apenas o colaborador
              e o número mudam.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Colaborador</Label>
            <Select value={assignUser} onValueChange={setAssignUser}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o colaborador" />
              </SelectTrigger>
              <SelectContent>
                {(consultantsQuery.data ?? []).map((consultant) => (
                  <SelectItem key={consultant.id} value={consultant.id}>
                    {consultant.full_name ?? consultant.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              disabled={!assignUser || assignMutation.isPending}
              onClick={() =>
                assignTarget &&
                assignMutation.mutate({ connectionId: assignTarget.id, userId: assignUser })
              }
            >
              {assignMutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Vincular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* QR Code */}
      <Dialog
        open={Boolean(qrTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setQrTarget(null);
            setQrCode(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conectar WhatsApp</DialogTitle>
            <DialogDescription>
              {qrTarget?.name} — {qrTarget?.assignedUserName}. Abra o WhatsApp do colaborador em
              Aparelhos conectados e leia o código.
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-56 items-center justify-center rounded-lg border border-border p-4">
            {connectMutation.isPending ? (
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            ) : qrCode ? (
              <img src={qrCode} alt="QR Code para conectar o WhatsApp" className="size-56" />
            ) : (
              <p className="text-center text-sm text-muted-foreground">
                QR Code indisponível no momento. Tente novamente em alguns segundos.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => qrTarget && connectMutation.mutate(qrTarget.id)}
              disabled={connectMutation.isPending}
            >
              <QrCode className="mr-1.5 size-3.5" />
              Gerar novamente
            </Button>
            <Button
              onClick={() => qrTarget && refreshMutation.mutate(qrTarget.id)}
              disabled={refreshMutation.isPending}
            >
              <Plug className="mr-1.5 size-3.5" />
              Já escaneei
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Histórico */}
      <HistoryDialog instance={historyTarget} onClose={() => setHistoryTarget(null)} />

      {/* Provisionamento (administrador da plataforma) */}
      <Dialog open={provisionOpen} onOpenChange={setProvisionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Provisionar instância contratada</DialogTitle>
            <DialogDescription>
              Cadastre uma instância já contratada na MEGA API. A chave é armazenada apenas no
              backend e nunca é exibida no painel.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nome da instância</Label>
              <Input
                value={instanceName}
                onChange={(event) => setInstanceName(event.target.value)}
                placeholder="Deixe em branco para numerar automaticamente"
              />
            </div>
            <div className="space-y-1.5">
              <Label>instance_key</Label>
              <Input
                value={instanceKey}
                onChange={(event) => setInstanceKey(event.target.value)}
                autoComplete="off"
                placeholder="chave fornecida pela MEGA API"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={!instanceKey.trim() || provisionMutation.isPending}
              onClick={() => provisionMutation.mutate()}
            >
              {provisionMutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Provisionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function HistoryDialog({
  instance,
  onClose,
}: {
  instance: WhatsAppInstance | null;
  onClose: () => void;
}) {
  const fetchHistory = useServerFn(listInstanceHistory);
  const { data, isLoading } = useQuery({
    queryKey: ["instance-history", instance?.id],
    enabled: Boolean(instance),
    queryFn: () => fetchHistory({ data: { connectionId: instance!.id } }),
  });

  return (
    <Dialog open={Boolean(instance)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Histórico de utilização</DialogTitle>
          <DialogDescription>{instance?.name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : (data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma vinculação registrada.</p>
          ) : (
            (data ?? []).map((row) => (
              <div key={row.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                <p className="font-medium">{row.user_name ?? "Colaborador removido"}</p>
                <p className="text-xs text-muted-foreground">
                  {row.phone_number ? PhoneNormalizationService.format(row.phone_number) : "sem número"}
                  {" · "}
                  {new Date(row.started_at).toLocaleDateString("pt-BR")} →{" "}
                  {row.ended_at ? new Date(row.ended_at).toLocaleDateString("pt-BR") : "atual"}
                </p>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WebhookCard({ instances }: { instances: WhatsAppInstance[] }) {
  const fetchUrl = useServerFn(getWhatsAppWebhookUrl);
  const [selected, setSelected] = useState<string>("");
  const [url, setUrl] = useState<string>("");

  return (
    <Card className="shadow-panel">
      <CardHeader>
        <CardTitle className="text-base">Webhook da instância</CardTitle>
        <CardDescription>
          Cadastre esta URL na MEGA API para receber mensagens, status de entrega e eventos de
          conexão. Cada instância tem uma URL própria e secreta.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1 space-y-1.5">
          <Label>Instância</Label>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {instances.map((instance) => (
                <SelectItem key={instance.id} value={instance.id}>
                  {instance.name ?? instance.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          disabled={!selected}
          onClick={async () => {
            try {
              const result = await fetchUrl({ data: { connectionId: selected } });
              setUrl(result.url);
              await navigator.clipboard.writeText(result.url).catch(() => undefined);
              toast.success("URL do webhook copiada.");
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Falha ao gerar a URL.");
            }
          }}
        >
          Mostrar e copiar
        </Button>
        {url ? (
          <p className="w-full break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">{url}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
