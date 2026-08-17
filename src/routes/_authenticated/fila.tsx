import { createFileRoute, Link } from "@tanstack/react-router";
import { AdminOnly } from "@/components/nexa/admin-only";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { AlarmClock, ArrowRight, RefreshCw, Timer, Users } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/nexa/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  enqueueConversation,
  getQueueOverview,
  runQueueTick,
  saveQueueSettings,
  skipQueueOffer,
  type QueueSettings,
} from "@/lib/queue/queue.functions";

export const Route = createFileRoute("/_authenticated/fila")({
  head: () => ({
    meta: [
      { title: "Fila — NexaAtende" },
      {
        name: "description",
        content: "Motor de fila com rodízio automático, SLA de resposta e reatribuição por timeout.",
      },
      { property: "og:title", content: "Fila — NexaAtende" },
      { property: "og:description", content: "Distribuição automática de atendimentos." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: GuardedFilaPage,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-muted-foreground">
      Não foi possível carregar a fila: {error.message}
    </div>
  ),
});

function useCountdown(deadline: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, Math.round((new Date(deadline).getTime() - now) / 1000));
}

function OfferCountdown({ deadline }: { deadline: string }) {
  const left = useCountdown(deadline);
  return (
    <span className={left <= 10 ? "font-semibold text-destructive" : "font-semibold text-primary"}>
      {left}s
    </span>
  );
}

const ATTEMPT_LABEL: Record<string, string> = {
  WAITING: "Aguardando resposta",
  RESPONDED: "Respondido",
  TIMEOUT: "Expirou",
  CANCELLED: "Cancelado",
};

function FilaPage() {
  const queryClient = useQueryClient();
  const fetchOverview = useServerFn(getQueueOverview);
  const saveSettings = useServerFn(saveQueueSettings);
  const tick = useServerFn(runQueueTick);
  const skip = useServerFn(skipQueueOffer);
  const enqueue = useServerFn(enqueueConversation);

  const { data, isLoading } = useQuery({
    queryKey: ["queue-overview"],
    queryFn: () => fetchOverview(),
    refetchInterval: 5000,
  });

  const [form, setForm] = useState<QueueSettings | null>(null);
  useEffect(() => {
    if (data?.settings && !form) setForm(data.settings);
  }, [data?.settings, form]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["queue-overview"] });

  const saveMutation = useMutation({
    mutationFn: (values: QueueSettings) => saveSettings({ data: values }),
    onSuccess: () => {
      toast.success("Configuração da fila salva.");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const tickMutation = useMutation({
    mutationFn: () => tick({}),
    onSuccess: (result) => {
      toast.success(
        result.processed ? `${result.processed} oferta(s) expirada(s) e repassada(s).` : "Nenhum prazo vencido.",
      );
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const skipMutation = useMutation({
    mutationFn: (conversationId: string) => skip({ data: { conversationId } }),
    onSuccess: (result) => {
      toast.success(result.consultantId ? "Passou para o próximo consultor." : "Nenhum consultor disponível.");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const enqueueMutation = useMutation({
    mutationFn: (conversationId: string) => enqueue({ data: { conversationId } }),
    onSuccess: (result) => {
      toast.success(result.consultantId ? "Conversa oferecida a um consultor." : "Fila sem consultor disponível.");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const waiting = data?.waiting ?? [];
  const attempts = data?.attempts ?? [];
  const activeOffers = attempts.filter((a) => a.status === "WAITING");
  const consultants = data?.consultants ?? [];
  const online = consultants.filter((c) => c.availability === "ONLINE").length;

  return (
    <AppShell title="Fila" description="Rodízio automático, SLA e reatribuição">
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={<Timer className="h-4 w-4" />} label="Aguardando na fila" value={waiting.length} />
          <MetricCard icon={<AlarmClock className="h-4 w-4" />} label="Ofertas em andamento" value={activeOffers.length} />
          <MetricCard icon={<Users className="h-4 w-4" />} label="Consultores online" value={online} />
          <MetricCard
            icon={<RefreshCw className="h-4 w-4" />}
            label="Prazo de resposta"
            value={`${data?.settings.slaSeconds ?? 60}s`}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle>Ofertas e histórico do rodízio</CardTitle>
                <CardDescription>
                  Cada tentativa registra o consultor, o prazo e o desfecho: respondido, expirado ou cancelado.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => tickMutation.mutate()}
                disabled={tickMutation.isPending}
              >
                <RefreshCw className="mr-2 h-4 w-4" /> Verificar prazos
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {isLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : attempts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma tentativa registrada ainda.</p>
              ) : (
                attempts.map((attempt) => (
                  <div
                    key={attempt.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{attempt.leadName ?? "Lead sem nome"}</p>
                      <p className="text-xs text-muted-foreground">
                        {attempt.consultantName ?? "Sem consultor"} ·{" "}
                        {new Date(attempt.assignedAt).toLocaleString("pt-BR")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {attempt.status === "WAITING" ? (
                        <>
                          <OfferCountdown deadline={attempt.deadlineAt} />
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => skipMutation.mutate(attempt.conversationId)}
                            disabled={skipMutation.isPending}
                          >
                            Próximo <ArrowRight className="ml-1 h-3 w-3" />
                          </Button>
                        </>
                      ) : (
                        <Badge variant="outline">{ATTEMPT_LABEL[attempt.status] ?? attempt.status}</Badge>
                      )}
                      <Button asChild variant="ghost" size="sm">
                        <Link to="/conversas" search={{ c: attempt.conversationId }}>
                          Abrir
                        </Link>
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Configuração</CardTitle>
                <CardDescription>Regras usadas pelo motor de distribuição.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {form ? (
                  <>
                    <div className="space-y-2">
                      <Label>Modo de distribuição</Label>
                      <Select
                        value={form.distributionMode}
                        onValueChange={(value) =>
                          setForm({ ...form, distributionMode: value as QueueSettings["distributionMode"] })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ROUND_ROBIN">Rodízio (round robin)</SelectItem>
                          <SelectItem value="LEAST_BUSY">Menor carga</SelectItem>
                          <SelectItem value="MANUAL">Manual</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="sla">Prazo de resposta (segundos)</Label>
                      <Input
                        id="sla"
                        type="number"
                        min={10}
                        value={form.slaSeconds}
                        onChange={(event) => setForm({ ...form, slaSeconds: Number(event.target.value) })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="limite">Atendimentos simultâneos por consultor</Label>
                      <Input
                        id="limite"
                        type="number"
                        min={1}
                        value={form.maxConcurrentPerConsultant}
                        onChange={(event) =>
                          setForm({ ...form, maxConcurrentPerConsultant: Number(event.target.value) })
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-border p-3">
                      <div>
                        <p className="text-sm font-medium">Somente consultores online</p>
                        <p className="text-xs text-muted-foreground">Ignora quem está offline ou pausado.</p>
                      </div>
                      <Switch
                        checked={form.onlyOnline}
                        onCheckedChange={(checked) => setForm({ ...form, onlyOnline: checked })}
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-border p-3">
                      <div>
                        <p className="text-sm font-medium">Respeitar horário comercial</p>
                        <p className="text-xs text-muted-foreground">Usa os horários cadastrados da empresa.</p>
                      </div>
                      <Switch
                        checked={form.businessHoursEnabled}
                        onCheckedChange={(checked) => setForm({ ...form, businessHoursEnabled: checked })}
                      />
                    </div>
                    <Button
                      className="w-full"
                      onClick={() => saveMutation.mutate(form)}
                      disabled={saveMutation.isPending}
                    >
                      Salvar configuração
                    </Button>
                  </>
                ) : (
                  <Skeleton className="h-56 w-full" />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Aguardando atendimento</CardTitle>
                <CardDescription>Conversas sem consultor definido.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {waiting.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum lead sem resposta. 🎉</p>
                ) : (
                  waiting.map((item) => (
                    <div
                      key={item.conversationId}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{item.leadName ?? "Lead sem nome"}</p>
                        <p className="text-xs text-muted-foreground">
                          desde {new Date(item.startedAt).toLocaleString("pt-BR")}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => enqueueMutation.mutate(item.conversationId)}
                        disabled={enqueueMutation.isPending}
                      >
                        Distribuir
                      </Button>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Carga da equipe</CardTitle>
                <CardDescription>Atendimentos ativos por consultor.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {consultants.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum consultor ativo.</p>
                ) : (
                  consultants.map((consultant) => (
                    <div key={consultant.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate">{consultant.name}</span>
                      <span className="flex items-center gap-2">
                        <Badge variant="outline">{consultant.availability}</Badge>
                        <span className="text-muted-foreground">
                          {consultant.load}/{consultant.limit}
                        </span>
                      </span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold">{value}</p>
        </div>
        <span className="rounded-lg bg-primary/10 p-2 text-primary">{icon}</span>
      </CardContent>
    </Card>
  );
}

function GuardedFilaPage() {
  return (
    <AdminOnly title="Fila" description="Rodízio, SLA e distribuição">
      <FilaPage />
    </AdminOnly>
  );
}
