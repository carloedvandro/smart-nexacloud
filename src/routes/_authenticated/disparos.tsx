import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Megaphone,
  OctagonX,
  Pause,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { AdminOnly } from "@/components/nexa/admin-only";
import { AppShell } from "@/components/nexa/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { PhoneNormalizationService } from "@/lib/nexa/phone";
import {
  cancelBroadcastCampaign,
  connectBroadcastInstance,
  deleteBroadcastContacts,
  deleteBroadcastMessage,
  disconnectBroadcastInstance,
  duplicateBroadcastCampaign,
  getBroadcastOverview,
  getBroadcastSettings,
  importBroadcastContacts,
  listBroadcastCampaigns,
  listBroadcastContacts,
  listBroadcastHistory,
  listBroadcastInstances,
  listBroadcastLogs,
  listBroadcastMessages,
  pauseBroadcastCampaign,
  refreshBroadcastInstance,
  releaseEmergencyStop,
  resumeBroadcastCampaign,
  saveBroadcastCampaign,
  saveBroadcastContact,
  saveBroadcastMessage,
  saveBroadcastSettings,
  setInstanceConnectionType,
  startBroadcastCampaign,
  stopAllBroadcasts,
} from "@/lib/broadcast/broadcast.functions";

export const Route = createFileRoute("/_authenticated/disparos")({
  head: () => ({
    meta: [
      { title: "Disparos — NexaAtende" },
      {
        name: "description",
        content:
          "Campanhas de WhatsApp com fila controlada, limites de envio, janela de horário e instância dedicada, separada do atendimento.",
      },
      { property: "og:title", content: "Disparos — NexaAtende" },
      { property: "og:description", content: "Campanhas de WhatsApp com proteção de envio." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: GuardedDisparosPage,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-muted-foreground">
      Não foi possível carregar os disparos: {error.message}
    </div>
  ),
});

const CAMPAIGN_LABEL: Record<string, string> = {
  DRAFT: "Rascunho",
  SCHEDULED: "Agendada",
  RUNNING: "Em andamento",
  PAUSED: "Pausada",
  COMPLETED: "Concluída",
  CANCELLED: "Cancelada",
  ERROR: "Erro",
};

const QUEUE_LABEL: Record<string, string> = {
  PENDING: "Pendente",
  PROCESSING: "Enviando",
  SENT: "Enviada",
  FAILED: "Falhou",
  SKIPPED: "Ignorada",
  CANCELLED: "Cancelada",
};

const CONTACT_STATUS = ["ATIVO", "PAUSADO", "BLOQUEADO", "DESCADASTRADO"] as const;

function campaignTone(status: string) {
  if (status === "RUNNING") return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
  if (status === "PAUSED") return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
  if (status === "COMPLETED") return "bg-primary/15 text-primary";
  if (status === "CANCELLED" || status === "ERROR") return "bg-destructive/15 text-destructive";
  return "bg-muted text-muted-foreground";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function GuardedDisparosPage() {
  return (
    <AdminOnly title="Disparos" description="Campanhas de WhatsApp">
      <DisparosPage />
    </AdminOnly>
  );
}

function DisparosPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("visao");

  const overviewFn = useServerFn(getBroadcastOverview);
  const campaignsFn = useServerFn(listBroadcastCampaigns);
  const instancesFn = useServerFn(listBroadcastInstances);
  const contactsFn = useServerFn(listBroadcastContacts);
  const messagesFn = useServerFn(listBroadcastMessages);
  const stopAllFn = useServerFn(stopAllBroadcasts);

  const overview = useQuery({ queryKey: ["broadcast", "overview"], queryFn: () => overviewFn({}) });
  const campaigns = useQuery({ queryKey: ["broadcast", "campaigns"], queryFn: () => campaignsFn({}) });
  const instances = useQuery({ queryKey: ["broadcast", "instances"], queryFn: () => instancesFn({}) });
  const messages = useQuery({ queryKey: ["broadcast", "messages"], queryFn: () => messagesFn({}) });
  const contacts = useQuery({
    queryKey: ["broadcast", "contacts"],
    queryFn: () => contactsFn({ data: {} }),
  });

  // Tempo real: progresso, pausas e conclusões chegam sem atualizar a página.
  useEffect(() => {
    const channel = supabase
      .channel("broadcast-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "broadcast_campaigns" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["broadcast"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "broadcast_queue" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["broadcast"] });
      })
      .subscribe();
    const poll = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ["broadcast", "overview"] });
      void queryClient.invalidateQueries({ queryKey: ["broadcast", "campaigns"] });
    }, 15_000);
    return () => {
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const stopAll = useMutation({
    mutationFn: () => stopAllFn({}),
    onSuccess: (result) => {
      toast.success(`Disparos interrompidos. ${result.cancelled} envio(s) pendente(s) cancelado(s).`);
      void queryClient.invalidateQueries({ queryKey: ["broadcast"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const broadcastInstances = (instances.data ?? []).filter((i) => i.connectionType === "BROADCAST");

  return (
    <AppShell
      title="Disparos"
      description="Campanhas de WhatsApp em instância dedicada, separada do atendimento"
      actions={
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm">
              <OctagonX className="size-4" /> Parar todos os disparos
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Parar todos os disparos?</AlertDialogTitle>
              <AlertDialogDescription>
                Todos os envios pendentes serão cancelados, as campanhas em andamento ficarão pausadas e
                nenhum novo envio acontecerá até você liberar em Configurações. O histórico é preservado.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Voltar</AlertDialogCancel>
              <AlertDialogAction onClick={() => stopAll.mutate()}>Parar agora</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      }
    >
      <Tabs value={tab} onValueChange={setTab} className="space-y-6">
        <TabsList className="flex w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="visao">Visão geral</TabsTrigger>
          <TabsTrigger value="campanhas">Campanhas</TabsTrigger>
          <TabsTrigger value="nova">Nova campanha</TabsTrigger>
          <TabsTrigger value="contatos">Contatos</TabsTrigger>
          <TabsTrigger value="mensagens">Mensagens</TabsTrigger>
          <TabsTrigger value="instancias">Instâncias de disparo</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
          <TabsTrigger value="config">Configurações</TabsTrigger>
        </TabsList>

        <TabsContent value="visao">
          <OverviewTab overview={overview.data} loading={overview.isLoading} />
        </TabsContent>

        <TabsContent value="campanhas">
          <CampaignsTab campaigns={campaigns.data ?? []} loading={campaigns.isLoading} />
        </TabsContent>

        <TabsContent value="nova">
          <NewCampaignTab
            instances={broadcastInstances}
            messages={messages.data ?? []}
            contacts={contacts.data ?? []}
            settings={overview.data?.settings}
            onCreated={() => setTab("campanhas")}
          />
        </TabsContent>

        <TabsContent value="contatos">
          <ContactsTab />
        </TabsContent>

        <TabsContent value="mensagens">
          <MessagesTab messages={messages.data ?? []} />
        </TabsContent>

        <TabsContent value="instancias">
          <InstancesTab instances={instances.data ?? []} loading={instances.isLoading} />
        </TabsContent>

        <TabsContent value="historico">
          <HistoryTab campaigns={campaigns.data ?? []} instances={broadcastInstances} />
        </TabsContent>

        <TabsContent value="config">
          <SettingsTab />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

/* ---------------------------------------------------------------- */
/* Visão geral                                                       */
/* ---------------------------------------------------------------- */

function Metric({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 py-5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

type Overview = Awaited<ReturnType<typeof getBroadcastOverview>>;

function OverviewTab({ overview, loading }: { overview: Overview | undefined; loading: boolean }) {
  if (loading || !overview) return <Skeleton className="h-64 w-full" />;
  const s = overview.settings;

  return (
    <div className="space-y-6">
      {s.emergency_stop ? (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center gap-3 py-4">
            <OctagonX className="size-5 text-destructive" />
            <p className="text-sm">
              <strong>Disparos bloqueados</strong> pela parada de emergência. Libere em Configurações para
              iniciar novas campanhas.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-emerald-500/40 bg-emerald-500/5">
          <CardContent className="flex flex-wrap items-center gap-3 py-4">
            <ShieldCheck className="size-5 text-emerald-600 dark:text-emerald-400" />
            <p className="text-sm font-medium">Proteção de envio ativa</p>
            <p className="text-xs text-muted-foreground">
              {s.messages_per_minute} msg/min · intervalo {s.min_interval_seconds}–{s.max_interval_seconds}s ·
              limite {s.hourly_limit}/hora e {s.daily_limit}/dia · janela {String(s.window_start).slice(0, 5)} às{" "}
              {String(s.window_end).slice(0, 5)} · pausa após {s.max_consecutive_failures} falhas seguidas
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Campanhas ativas" value={overview.campaigns.running} />
        <Metric label="Campanhas pausadas" value={overview.campaigns.paused} />
        <Metric label="Campanhas concluídas" value={overview.campaigns.completed} />
        <Metric
          label="Contatos cadastrados"
          value={overview.contacts.total}
          hint={`${overview.contacts.active} ativos`}
        />
        <Metric label="Enviadas hoje" value={overview.messages.sentToday} />
        <Metric label="Pendentes" value={overview.messages.pending} />
        <Metric label="Com erro" value={overview.messages.failed} />
        <Metric label="Último disparo" value={formatDate(overview.lastSentAt)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Instâncias de disparo</CardTitle>
          <CardDescription>
            A instância tronco continua exclusiva do atendimento e nunca é usada em campanhas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {overview.instances.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma instância marcada como disparo. Marque uma conexão já provisionada na aba “Instâncias de
              disparo”.
            </p>
          ) : (
            overview.instances.map((instance) => (
              <div
                key={instance.id}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
              >
                <span className="font-medium">{instance.name ?? "Instância de disparo"}</span>
                <span className="text-muted-foreground">
                  {instance.phoneNumber ? PhoneNormalizationService.format(instance.phoneNumber) : "sem número"}
                </span>
                <Badge variant={instance.status === "CONNECTED" ? "default" : "secondary"}>
                  {instance.status}
                </Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Os limites são controles operacionais do NexaAtende. Eles reduzem o volume e a cadência dos envios, mas
        não constituem garantia contra bloqueios ou contra as políticas do WhatsApp e do provedor.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Campanhas                                                         */
/* ---------------------------------------------------------------- */

type Campaign = Awaited<ReturnType<typeof listBroadcastCampaigns>>[number];

function CampaignsTab({ campaigns, loading }: { campaigns: Campaign[]; loading: boolean }) {
  const queryClient = useQueryClient();
  const startFn = useServerFn(startBroadcastCampaign);
  const pauseFn = useServerFn(pauseBroadcastCampaign);
  const resumeFn = useServerFn(resumeBroadcastCampaign);
  const cancelFn = useServerFn(cancelBroadcastCampaign);
  const duplicateFn = useServerFn(duplicateBroadcastCampaign);

  function run(promise: Promise<unknown>, message: string) {
    promise
      .then(() => {
        toast.success(message);
        void queryClient.invalidateQueries({ queryKey: ["broadcast"] });
      })
      .catch((error: Error) => toast.error(error.message));
  }

  if (loading) return <Skeleton className="h-64 w-full" />;
  if (!campaigns.length) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
          <Megaphone className="size-8 text-muted-foreground" />
          <p className="text-base font-medium">Nenhuma campanha ainda</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Crie a primeira campanha na aba “Nova campanha”. Ela só poderá usar uma instância marcada como
            disparo.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {campaigns.map((campaign) => {
        const stats = campaign.stats;
        const progress = stats.total ? Math.round(((stats.sent + stats.failed) / stats.total) * 100) : 0;
        return (
          <Card key={campaign.id}>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">{campaign.name}</CardTitle>
                <CardDescription>
                  {campaign.instance?.name ?? "sem instância"} · {campaign.message?.name ?? "sem mensagem"} ·{" "}
                  {campaign.audience} contatos
                </CardDescription>
              </div>
              <Badge className={campaignTone(campaign.status)} variant="secondary">
                {CAMPAIGN_LABEL[campaign.status] ?? campaign.status}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Progress value={progress} />
                <p className="text-xs text-muted-foreground">
                  {stats.sent} enviadas · {stats.pending} pendentes · {stats.failed} falhas · {progress}%
                </p>
              </div>

              <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3 lg:grid-cols-4">
                <span>Velocidade: {campaign.messages_per_minute} msg/min</span>
                <span>
                  Intervalo: {campaign.min_interval_seconds}–{campaign.max_interval_seconds}s
                </span>
                <span>Limite diário: {campaign.daily_limit}</span>
                <span>
                  Janela: {String(campaign.window_start).slice(0, 5)}–{String(campaign.window_end).slice(0, 5)}
                </span>
                <span>Criada: {formatDate(campaign.created_at)}</span>
                <span>Início: {formatDate(campaign.started_at)}</span>
                <span>Última atividade: {formatDate(campaign.last_activity_at)}</span>
                {campaign.scheduled_at ? <span>Agendada: {formatDate(campaign.scheduled_at)}</span> : null}
              </div>

              {campaign.pause_reason ? (
                <p className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {campaign.pause_reason}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {(campaign.status === "DRAFT" || campaign.status === "COMPLETED") && (
                  <Button
                    size="sm"
                    onClick={() =>
                      run(startFn({ data: { campaignId: campaign.id } }), "Campanha iniciada.")
                    }
                  >
                    <Play className="size-4" /> Iniciar
                  </Button>
                )}
                {campaign.status === "RUNNING" || campaign.status === "SCHEDULED" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => run(pauseFn({ data: { campaignId: campaign.id } }), "Campanha pausada.")}
                  >
                    <Pause className="size-4" /> Pausar
                  </Button>
                ) : null}
                {campaign.status === "PAUSED" ? (
                  <Button
                    size="sm"
                    onClick={() => run(resumeFn({ data: { campaignId: campaign.id } }), "Campanha retomada.")}
                  >
                    <Play className="size-4" /> Retomar
                  </Button>
                ) : null}
                {["RUNNING", "PAUSED", "SCHEDULED", "DRAFT"].includes(campaign.status) ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      run(cancelFn({ data: { campaignId: campaign.id } }), "Campanha cancelada.")
                    }
                  >
                    <X className="size-4" /> Cancelar
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => run(duplicateFn({ data: { campaignId: campaign.id } }), "Campanha duplicada.")}
                >
                  Duplicar
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Nova campanha                                                     */
/* ---------------------------------------------------------------- */

type Instance = Awaited<ReturnType<typeof listBroadcastInstances>>[number];
type Message = Awaited<ReturnType<typeof listBroadcastMessages>>[number];
type Contact = Awaited<ReturnType<typeof listBroadcastContacts>>[number];

function NewCampaignTab({
  instances,
  messages,
  contacts,
  settings,
  onCreated,
}: {
  instances: Instance[];
  messages: Message[];
  contacts: Contact[];
  settings: Overview["settings"] | undefined;
  onCreated: () => void;
}) {
  const queryClient = useQueryClient();
  const saveFn = useServerFn(saveBroadcastCampaign);
  const startFn = useServerFn(startBroadcastCampaign);

  const [name, setName] = useState("");
  const [instanceId, setInstanceId] = useState("");
  const [messageId, setMessageId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [requireOptIn, setRequireOptIn] = useState(false);
  const [perMinute, setPerMinute] = useState(settings?.messages_per_minute ?? 5);
  const [minInterval, setMinInterval] = useState(settings?.min_interval_seconds ?? 10);
  const [maxInterval, setMaxInterval] = useState(settings?.max_interval_seconds ?? 25);
  const [dailyLimit, setDailyLimit] = useState(settings?.daily_limit ?? 200);
  const [windowStart, setWindowStart] = useState(String(settings?.window_start ?? "08:00").slice(0, 5));
  const [windowEnd, setWindowEnd] = useState(String(settings?.window_end ?? "20:00").slice(0, 5));
  const [scheduledAt, setScheduledAt] = useState("");
  const [saving, setSaving] = useState(false);

  const message = messages.find((m) => m.id === messageId);
  const audience = contacts.filter(
    (c) => selected.includes(c.id) && c.status === "ATIVO" && (!requireOptIn || c.opt_in),
  );
  const preview = message
    ? message.content
        .replace(/\{\{nome\}\}/g, audience[0]?.name?.trim() || "cliente")
        .replace(/\{\{primeiro_nome\}\}/g, (audience[0]?.name?.trim() || "cliente").split(" ")[0] ?? "cliente")
    : "";

  async function submit(startNow: boolean) {
    if (!name.trim()) return toast.error("Informe o nome da campanha.");
    if (!instanceId) return toast.error("Selecione a instância de disparo.");
    if (!messageId) return toast.error("Selecione a mensagem.");
    if (!audience.length) return toast.error("Selecione pelo menos um contato válido.");

    setSaving(true);
    try {
      const created = await saveFn({
        data: {
          name,
          instanceId,
          messageId,
          contactIds: audience.map((c) => c.id),
          requireOptIn,
          messagesPerMinute: perMinute,
          minIntervalSeconds: minInterval,
          maxIntervalSeconds: maxInterval,
          dailyLimit,
          windowStart,
          windowEnd,
        },
      });
      if (startNow) {
        await startFn({
          data: {
            campaignId: created.id,
            scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
          },
        });
      }
      toast.success(startNow ? "Campanha confirmada e iniciada." : "Campanha salva como rascunho.");
      setName("");
      setSelected([]);
      void queryClient.invalidateQueries({ queryKey: ["broadcast"] });
      onCreated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar a campanha.");
    } finally {
      setSaving(false);
    }
  }

  const estimatedMinutes = audience.length ? Math.ceil(audience.length / Math.max(perMinute, 1)) : 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">1. Nome e instância</CardTitle>
            <CardDescription>Somente conexões marcadas como disparo aparecem aqui.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Nome da campanha</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Novembro — planos" />
            </div>
            <div className="space-y-2">
              <Label>Instância de disparo</Label>
              <Select value={instanceId} onValueChange={setInstanceId}>
                <SelectTrigger>
                  <SelectValue placeholder={instances.length ? "Selecione" : "Nenhuma instância de disparo"} />
                </SelectTrigger>
                <SelectContent>
                  {instances.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name ?? "Instância"} · {i.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Mensagem</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Select value={messageId} onValueChange={setMessageId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o modelo" />
              </SelectTrigger>
              <SelectContent>
                {messages.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {preview ? (
              <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm whitespace-pre-wrap">
                {preview}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">3. Contatos</CardTitle>
            <CardDescription>
              {selected.length} selecionado(s) · {audience.length} elegíveis para envio
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <Switch checked={requireOptIn} onCheckedChange={setRequireOptIn} id="optin" />
              <Label htmlFor="optin" className="text-sm font-normal">
                Enviar somente para contatos com consentimento registrado
              </Label>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSelected(contacts.filter((c) => c.status === "ATIVO").map((c) => c.id))}
              >
                Selecionar todos os ativos
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                Limpar
              </Button>
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
              {contacts.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">Cadastre contatos na aba “Contatos”.</p>
              ) : (
                contacts.map((contact) => (
                  <label
                    key={contact.id}
                    className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                  >
                    <Checkbox
                      checked={selected.includes(contact.id)}
                      onCheckedChange={(checked) =>
                        setSelected((prev) =>
                          checked ? [...prev, contact.id] : prev.filter((id) => id !== contact.id),
                        )
                      }
                    />
                    <span className="flex-1 truncate">{contact.name ?? "Sem nome"}</span>
                    <span className="text-xs text-muted-foreground">
                      {PhoneNormalizationService.format(contact.whatsapp)}
                    </span>
                    {contact.opt_in ? <Badge variant="secondary">opt-in</Badge> : null}
                  </label>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">4. Envio</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Mensagens por minuto</Label>
              <Input type="number" min={1} value={perMinute} onChange={(e) => setPerMinute(Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label>Limite diário</Label>
              <Input type="number" min={1} value={dailyLimit} onChange={(e) => setDailyLimit(Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label>Intervalo mínimo (s)</Label>
              <Input type="number" min={1} value={minInterval} onChange={(e) => setMinInterval(Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label>Intervalo máximo (s)</Label>
              <Input type="number" min={1} value={maxInterval} onChange={(e) => setMaxInterval(Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label>Horário inicial</Label>
              <Input type="time" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Horário final</Label>
              <Input type="time" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Início agendado (opcional)</Label>
              <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="h-fit lg:sticky lg:top-24">
        <CardHeader>
          <CardTitle className="text-base">5. Revisar e confirmar</CardTitle>
          <CardDescription>Confira o resumo antes de autorizar o envio.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p><strong>Campanha:</strong> {name || "—"}</p>
          <p><strong>Instância:</strong> {instances.find((i) => i.id === instanceId)?.name ?? "—"}</p>
          <p><strong>Mensagem:</strong> {message?.name ?? "—"}</p>
          <p><strong>Contatos:</strong> {audience.length}</p>
          <p><strong>Mensagens estimadas:</strong> {audience.length}</p>
          <p><strong>Velocidade:</strong> {perMinute} por minuto (~{estimatedMinutes} min)</p>
          <p><strong>Janela:</strong> {windowStart} às {windowEnd}</p>
          <p><strong>Limite diário:</strong> {dailyLimit}</p>
          <p><strong>Início:</strong> {scheduledAt ? formatDate(new Date(scheduledAt).toISOString()) : "Imediato"}</p>

          {audience.length >= 500 ? (
            <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              Você está prestes a iniciar uma campanha para {audience.length} contatos.
            </p>
          ) : null}
          {perMinute > 10 ? (
            <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              A velocidade configurada está acima do limite recomendado pela política interna.
            </p>
          ) : null}

          <div className="flex flex-col gap-2 pt-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={saving}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                  Confirmar e iniciar
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirmar o início da campanha?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {audience.length} mensagens serão enfileiradas e enviadas pela instância de disparo,
                    respeitando os limites configurados. Os limites são controles operacionais e não garantem
                    proteção contra bloqueios do WhatsApp.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Voltar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void submit(true)}>Confirmar e iniciar</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button variant="outline" disabled={saving} onClick={() => void submit(false)}>
              Salvar como rascunho
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Contatos                                                          */
/* ---------------------------------------------------------------- */

function ContactsTab() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listBroadcastContacts);
  const saveFn = useServerFn(saveBroadcastContact);
  const importFn = useServerFn(importBroadcastContacts);
  const deleteFn = useServerFn(deleteBroadcastContacts);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("todos");
  const [form, setForm] = useState({
    name: "",
    phone: "",
    companyName: "",
    tags: "",
    source: "",
    note: "",
    optIn: false,
    optInSource: "",
  });

  const contacts = useQuery({
    queryKey: ["broadcast", "contacts", search, status],
    queryFn: () =>
      listFn({ data: { search, ...(status !== "todos" ? { status } : {}) } }),
  });

  async function handleCsv(file: File) {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    if (!lines.length) return;
    const header = lines[0]!.toLowerCase();
    const hasHeader = /nome|telefone|phone|whatsapp/.test(header);
    const rows = (hasHeader ? lines.slice(1) : lines).map((line) => {
      const [name, phone, companyName, tags, optIn] = line.split(/[,;]/).map((v) => v.trim());
      return {
        name: name || null,
        phone: phone ?? "",
        companyName: companyName || null,
        tags: tags ? tags.split("|").filter(Boolean) : [],
        source: "csv",
        optIn: /^(1|sim|true|yes)$/i.test(optIn ?? ""),
        optInSource: /^(1|sim|true|yes)$/i.test(optIn ?? "") ? "importacao-csv" : null,
      };
    });
    try {
      const result = await importFn({ data: { rows } });
      toast.success(`${result.imported} contato(s) importado(s). ${result.invalid} inválido(s).`);
      void queryClient.invalidateQueries({ queryKey: ["broadcast"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao importar.");
    }
  }

  function exportCsv() {
    const rows = contacts.data ?? [];
    const csv = [
      "nome,telefone,empresa,tags,status,opt_in,origem,cadastro",
      ...rows.map((c) =>
        [
          c.name ?? "",
          c.whatsapp,
          c.company_name ?? "",
          (c.tags ?? []).join("|"),
          c.status,
          c.opt_in ? "sim" : "nao",
          c.source ?? "",
          c.created_at,
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "contatos-disparos.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          name: form.name || null,
          phone: form.phone,
          companyName: form.companyName || null,
          tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
          source: form.source || "manual",
          note: form.note || null,
          optIn: form.optIn,
          optInSource: form.optIn ? form.optInSource || "cadastro manual" : null,
        },
      }),
    onSuccess: () => {
      toast.success("Contato salvo.");
      setForm({ name: "", phone: "", companyName: "", tags: "", source: "", note: "", optIn: false, optInSource: "" });
      void queryClient.invalidateQueries({ queryKey: ["broadcast"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">Novo contato</CardTitle>
          <CardDescription>O telefone é normalizado pelo mesmo padrão do atendimento.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input
            placeholder="Telefone com DDD"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <Input
            placeholder="Empresa"
            value={form.companyName}
            onChange={(e) => setForm({ ...form, companyName: e.target.value })}
          />
          <Input
            placeholder="Tags separadas por vírgula"
            value={form.tags}
            onChange={(e) => setForm({ ...form, tags: e.target.value })}
          />
          <Input placeholder="Origem" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
          <Textarea
            placeholder="Observação"
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
          <div className="flex items-center gap-3">
            <Switch checked={form.optIn} onCheckedChange={(v) => setForm({ ...form, optIn: v })} id="c-optin" />
            <Label htmlFor="c-optin" className="text-sm font-normal">
              Consentimento registrado
            </Label>
          </div>
          {form.optIn ? (
            <Input
              placeholder="Origem do consentimento"
              value={form.optInSource}
              onChange={(e) => setForm({ ...form, optInSource: e.target.value })}
            />
          ) : null}
          <Button className="w-full" onClick={() => save.mutate()} disabled={save.isPending}>
            <Plus className="size-4" /> Cadastrar
          </Button>

          <div className="space-y-2 border-t border-border pt-3">
            <Label className="text-xs uppercase text-muted-foreground">Importar CSV</Label>
            <Input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleCsv(file);
                e.target.value = "";
              }}
            />
            <p className="text-xs text-muted-foreground">
              Colunas: nome, telefone, empresa, tags (separadas por |), consentimento (sim/nao).
            </p>
            <Button variant="outline" className="w-full" onClick={exportCsv}>
              <Upload className="size-4 rotate-180" /> Exportar lista atual
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-3">
          <CardTitle className="text-base">Contatos ({contacts.data?.length ?? 0})</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Input
              className="max-w-xs"
              placeholder="Buscar por nome, empresa ou número"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os status</SelectItem>
                {CONTACT_STATUS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {contacts.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (contacts.data ?? []).length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhum contato encontrado.</p>
          ) : (
            (contacts.data ?? []).map((contact) => (
              <div
                key={contact.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{contact.name ?? "Sem nome"}</p>
                  <p className="text-xs text-muted-foreground">
                    {PhoneNormalizationService.format(contact.whatsapp)}
                    {contact.company_name ? ` · ${contact.company_name}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {(contact.tags ?? []).slice(0, 3).map((tag: string) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                  <Badge variant={contact.status === "ATIVO" ? "secondary" : "outline"}>{contact.status}</Badge>
                  {contact.opt_in ? <Badge>opt-in</Badge> : null}
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() =>
                      deleteFn({ data: { ids: [contact.id] } })
                        .then(() => {
                          toast.success("Contato excluído.");
                          void queryClient.invalidateQueries({ queryKey: ["broadcast"] });
                        })
                        .catch((error: Error) => toast.error(error.message))
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Mensagens                                                         */
/* ---------------------------------------------------------------- */

function MessagesTab({ messages }: { messages: Message[] }) {
  const queryClient = useQueryClient();
  const saveFn = useServerFn(saveBroadcastMessage);
  const deleteFn = useServerFn(deleteBroadcastMessage);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");

  const unknownVars = useMemo(
    () =>
      [...content.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)]
        .map((m) => (m[1] ?? "").toLowerCase())
        .filter((v) => !["nome", "primeiro_nome"].includes(v)),
    [content],
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">Novo modelo</CardTitle>
          <CardDescription>Variáveis aceitas: {"{{nome}}"} e {"{{primeiro_nome}}"}.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Nome interno" value={name} onChange={(e) => setName(e.target.value)} />
          <Textarea
            rows={7}
            placeholder="Olá {{primeiro_nome}}, tudo bem?"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          {unknownVars.length ? (
            <p className="text-xs text-destructive">
              Variáveis não suportadas: {[...new Set(unknownVars)].map((v) => `{{${v}}}`).join(", ")}
            </p>
          ) : null}
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm whitespace-pre-wrap">
            {content
              .replace(/\{\{nome\}\}/g, "Maria Silva")
              .replace(/\{\{primeiro_nome\}\}/g, "Maria") || "Prévia da mensagem"}
          </div>
          <Button
            className="w-full"
            disabled={unknownVars.length > 0}
            onClick={() =>
              saveFn({ data: { name, content } })
                .then(() => {
                  toast.success("Mensagem salva.");
                  setName("");
                  setContent("");
                  void queryClient.invalidateQueries({ queryKey: ["broadcast"] });
                })
                .catch((error: Error) => toast.error(error.message))
            }
          >
            <Plus className="size-4" /> Salvar mensagem
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Modelos cadastrados</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {messages.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhum modelo cadastrado.</p>
          ) : (
            messages.map((m) => (
              <div key={m.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{m.name}</p>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{m.status}</Badge>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() =>
                        deleteFn({ data: { id: m.id } })
                          .then(() => {
                            toast.success("Mensagem excluída.");
                            void queryClient.invalidateQueries({ queryKey: ["broadcast"] });
                          })
                          .catch((error: Error) => toast.error(error.message))
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{m.content}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Criada em {formatDate(m.created_at)} · atualizada em {formatDate(m.updated_at)}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Instâncias                                                        */
/* ---------------------------------------------------------------- */

function InstancesTab({ instances, loading }: { instances: Instance[]; loading: boolean }) {
  const queryClient = useQueryClient();
  const setTypeFn = useServerFn(setInstanceConnectionType);
  const connectFn = useServerFn(connectBroadcastInstance);
  const refreshFn = useServerFn(refreshBroadcastInstance);
  const disconnectFn = useServerFn(disconnectBroadcastInstance);
  const [qr, setQr] = useState<{ id: string; code: string } | null>(null);

  function run(promise: Promise<unknown>, message: string) {
    promise
      .then(() => {
        toast.success(message);
        void queryClient.invalidateQueries({ queryKey: ["broadcast"] });
      })
      .catch((error: Error) => toast.error(error.message));
  }

  if (loading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Marque uma conexão já provisionada como instância de disparo. O NexaAtende não cria instâncias novas
        automaticamente.
      </p>
      {instances.map((instance) => (
        <Card key={instance.id}>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">
                {instance.name ?? `Instância ${instance.instanceNumber ?? ""}`}
              </CardTitle>
              <CardDescription>
                {instance.phoneNumber
                  ? PhoneNormalizationService.format(instance.phoneNumber)
                  : "número não conectado"}{" "}
                · última conexão {formatDate(instance.lastConnectedAt)}
              </CardDescription>
            </div>
            {instance.isTrunk ? (
              <Badge variant="secondary" className="bg-primary/15 text-primary">
                TRONCO — USO EXCLUSIVO DO ATENDIMENTO
              </Badge>
            ) : (
              <Badge variant={instance.connectionType === "BROADCAST" ? "default" : "outline"}>
                {instance.connectionType === "BROADCAST" ? "Disparo" : "Atendimento"}
              </Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Smartphone className="size-3.5" /> Status: {instance.status}
              </span>
              <span>Campanhas: {instance.campaigns}</span>
              <span>Enviadas: {instance.sent}</span>
              <span>Erros: {instance.failed}</span>
            </div>

            {instance.isTrunk ? (
              <p className="text-xs text-muted-foreground">
                Esta instância nunca pode ser usada em disparos.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {instance.connectionType === "BROADCAST" ? (
                  <>
                    <Button
                      size="sm"
                      onClick={() =>
                        connectFn({ data: { connectionId: instance.id } })
                          .then((result) => {
                            if (result.qrCode) setQr({ id: instance.id, code: result.qrCode });
                            toast.success("Solicitação enviada. Escaneie o QR Code se necessário.");
                            void queryClient.invalidateQueries({ queryKey: ["broadcast"] });
                          })
                          .catch((error: Error) => toast.error(error.message))
                      }
                    >
                      Conectar
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        run(refreshFn({ data: { connectionId: instance.id } }), "Situação atualizada.")
                      }
                    >
                      <RefreshCw className="size-4" /> Atualizar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        run(disconnectFn({ data: { connectionId: instance.id } }), "Instância desconectada.")
                      }
                    >
                      Desconectar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        run(
                          setTypeFn({ data: { connectionId: instance.id, type: "TRUNK" } }),
                          "Instância devolvida ao atendimento.",
                        )
                      }
                    >
                      Remover dos disparos
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    onClick={() =>
                      run(
                        setTypeFn({ data: { connectionId: instance.id, type: "BROADCAST" } }),
                        "Instância marcada como disparo.",
                      )
                    }
                  >
                    Usar em disparos
                  </Button>
                )}
              </div>
            )}

            {qr?.id === instance.id ? (
              <img
                src={qr.code.startsWith("data:") ? qr.code : `data:image/png;base64,${qr.code}`}
                alt="QR Code para conectar a instância de disparo"
                className="size-56 rounded-lg border border-border bg-white p-2"
              />
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Histórico                                                         */
/* ---------------------------------------------------------------- */

function HistoryTab({ campaigns, instances }: { campaigns: Campaign[]; instances: Instance[] }) {
  const historyFn = useServerFn(listBroadcastHistory);
  const logsFn = useServerFn(listBroadcastLogs);
  const [campaignId, setCampaignId] = useState("todas");
  const [status, setStatus] = useState("todos");
  const [instanceId, setInstanceId] = useState("todas");
  const [days, setDays] = useState("30");

  const history = useQuery({
    queryKey: ["broadcast", "history", campaignId, status, instanceId, days],
    queryFn: () =>
      historyFn({
        data: {
          ...(campaignId !== "todas" ? { campaignId } : {}),
          ...(status !== "todos" ? { status } : {}),
          ...(instanceId !== "todas" ? { instanceId } : {}),
          days: Number(days),
        },
      }),
  });

  const logs = useQuery({ queryKey: ["broadcast", "logs"], queryFn: () => logsFn({}) });

  const rows = history.data ?? [];
  const totals = {
    total: rows.length,
    sent: rows.filter((r) => r.status === "SENT").length,
    pending: rows.filter((r) => r.status === "PENDING" || r.status === "PROCESSING").length,
    failed: rows.filter((r) => r.status === "FAILED").length,
  };
  const errorRate = totals.total ? Math.round((totals.failed / totals.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="Programadas" value={totals.total} />
        <Metric label="Enviadas" value={totals.sent} />
        <Metric label="Pendentes" value={totals.pending} />
        <Metric label="Falhas" value={totals.failed} />
        <Metric label="Taxa de erro" value={`${errorRate}%`} />
      </div>

      <Card>
        <CardHeader className="space-y-3">
          <CardTitle className="text-base">Histórico de envios</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Select value={campaignId} onValueChange={setCampaignId}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas as campanhas</SelectItem>
                {campaigns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os status</SelectItem>
                {Object.entries(QUEUE_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={instanceId} onValueChange={setInstanceId}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas as instâncias</SelectItem>
                {instances.map((i) => (
                  <SelectItem key={i.id} value={i.id}>{i.name ?? "Instância"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Hoje</SelectItem>
                <SelectItem value="7">7 dias</SelectItem>
                <SelectItem value="30">30 dias</SelectItem>
                <SelectItem value="90">90 dias</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {history.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhum envio no período.</p>
          ) : (
            rows.map((row) => (
              <div key={row.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {row.contact?.name ?? "Sem nome"} ·{" "}
                    {PhoneNormalizationService.format(row.contact?.whatsapp ?? null)}
                  </span>
                  <Badge variant={row.status === "SENT" ? "default" : "secondary"}>
                    {QUEUE_LABEL[row.status] ?? row.status}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {row.campaign?.name ?? "—"} · {row.instance?.name ?? "—"} ·{" "}
                  {formatDate(row.sent_at ?? row.created_at)} · tentativas: {row.attempts} · id provedor:{" "}
                  {row.provider_message_id ?? "—"}
                </p>
                {row.error_message ? (
                  <p className="mt-1 text-xs text-destructive">{row.error_message}</p>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Auditoria</CardTitle>
          <CardDescription>Ações administrativas do módulo de disparos.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(logs.data ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma ação registrada.</p>
          ) : (
            (logs.data ?? []).map((entry) => (
              <div key={entry.id} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  <strong>{entry.action}</strong> {entry.campaign?.name ? `· ${entry.campaign.name}` : ""}
                </span>
                <span className="text-xs text-muted-foreground">
                  {entry.user_name ?? "sistema"} · {formatDate(entry.created_at)}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Configurações                                                     */
/* ---------------------------------------------------------------- */

function SettingsTab() {
  const queryClient = useQueryClient();
  const getFn = useServerFn(getBroadcastSettings);
  const saveFn = useServerFn(saveBroadcastSettings);
  const releaseFn = useServerFn(releaseEmergencyStop);
  const settings = useQuery({ queryKey: ["broadcast", "settings"], queryFn: () => getFn({}) });
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (settings.data && !draft) setDraft({ ...settings.data });
  }, [settings.data, draft]);

  if (settings.isLoading || !draft) return <Skeleton className="h-64 w-full" />;

  const field = (key: string) => ({
    value: String(draft[key] ?? ""),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setDraft({ ...draft, [key]: e.target.type === "number" ? Number(e.target.value) : e.target.value }),
  });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Proteção de envio</CardTitle>
          <CardDescription>
            Limites aplicados a todas as campanhas da empresa. São controles operacionais e não garantem
            proteção contra bloqueios do WhatsApp.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Mensagens por minuto</Label>
            <Input type="number" min={1} {...field("messages_per_minute")} />
          </div>
          <div className="space-y-2">
            <Label>Limite por hora</Label>
            <Input type="number" min={1} {...field("hourly_limit")} />
          </div>
          <div className="space-y-2">
            <Label>Limite diário</Label>
            <Input type="number" min={1} {...field("daily_limit")} />
          </div>
          <div className="space-y-2">
            <Label>Falhas seguidas para pausar</Label>
            <Input type="number" min={1} {...field("max_consecutive_failures")} />
          </div>
          <div className="space-y-2">
            <Label>Intervalo mínimo (s)</Label>
            <Input type="number" min={1} {...field("min_interval_seconds")} />
          </div>
          <div className="space-y-2">
            <Label>Intervalo máximo (s)</Label>
            <Input type="number" min={1} {...field("max_interval_seconds")} />
          </div>
          <div className="space-y-2">
            <Label>Horário inicial</Label>
            <Input type="time" value={String(draft["window_start"] ?? "08:00").slice(0, 5)} onChange={(e) => setDraft({ ...draft, window_start: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Horário final</Label>
            <Input type="time" value={String(draft["window_end"] ?? "20:00").slice(0, 5)} onChange={(e) => setDraft({ ...draft, window_end: e.target.value })} />
          </div>
          <div className="flex items-center gap-3 sm:col-span-2">
            <Switch
              checked={Boolean(draft["auto_resume"])}
              onCheckedChange={(v) => setDraft({ ...draft, auto_resume: v })}
              id="auto-resume"
            />
            <Label htmlFor="auto-resume" className="text-sm font-normal">
              Retomar automaticamente no próximo horário permitido
            </Label>
          </div>
          <Button
            className="sm:col-span-2"
            onClick={() =>
              saveFn({ data: draft as never })
                .then(() => {
                  toast.success("Configurações salvas.");
                  void queryClient.invalidateQueries({ queryKey: ["broadcast"] });
                })
                .catch((error: Error) => toast.error(error.message))
            }
          >
            Salvar configurações
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Parada de emergência</CardTitle>
          <CardDescription>
            Enquanto estiver acionada, nenhuma campanha é iniciada nem retomada.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="flex items-center gap-2 text-sm">
            <Clock className="size-4 text-muted-foreground" /> Situação:{" "}
            <strong>{draft["emergency_stop"] ? "Disparos bloqueados" : "Liberado"}</strong>
          </p>
          {draft["emergency_stop"] ? (
            <Button
              onClick={() =>
                releaseFn({})
                  .then(() => {
                    toast.success("Disparos liberados.");
                    setDraft({ ...draft, emergency_stop: false });
                    void queryClient.invalidateQueries({ queryKey: ["broadcast"] });
                  })
                  .catch((error: Error) => toast.error(error.message))
              }
            >
              Liberar disparos
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
