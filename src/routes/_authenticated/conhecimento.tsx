import { createFileRoute } from "@tanstack/react-router";
import { AdminOnly } from "@/components/nexa/admin-only";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Bot, Pencil, Plus, Trash2 } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import {
  deleteKnowledge,
  getAiConfig,
  listKnowledge,
  saveAiConfig,
  saveKnowledge,
  testAiReply,
  type AiConfig,
  type KnowledgeItem,
} from "@/lib/ai/ai.functions";

const CATEGORIES = [
  "faq",
  "processos",
  "institucional",
  "carencias",
  "precos",
  "coberturas",
  "planos",
  "operadoras",
  "outros",
] as const;

const STATUSES = [
  { value: "ACTIVE", label: "Ativo" },
  { value: "DRAFT", label: "Rascunho" },
  { value: "ARCHIVED", label: "Arquivado" },
];

export const Route = createFileRoute("/_authenticated/conhecimento")({
  head: () => ({
    meta: [
      { title: "Conhecimento IA — NexaAtende" },
      {
        name: "description",
        content:
          "Base de conhecimento oficial consultada pela IA do NexaAtende no atendimento de leads.",
      },
      { property: "og:title", content: "Conhecimento IA — NexaAtende" },
      { property: "og:description", content: "Base de conhecimento da inteligência artificial." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: GuardedConhecimentoPage,
});

const EMPTY: KnowledgeItem = {
  id: "",
  title: "",
  category: "faq",
  content: "",
  status: "ACTIVE",
  updatedAt: "",
};

function ConhecimentoPage() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<KnowledgeItem | null>(null);

  const fetchList = useServerFn(listKnowledge);
  const fetchConfig = useServerFn(getAiConfig);
  const persist = useServerFn(saveKnowledge);
  const remove = useServerFn(deleteKnowledge);
  const persistConfig = useServerFn(saveAiConfig);
  const runTest = useServerFn(testAiReply);

  const { data: items, isLoading } = useQuery({ queryKey: ["knowledge"], queryFn: () => fetchList() });
  const { data: config } = useQuery({ queryKey: ["ai-config"], queryFn: () => fetchConfig() });

  const [form, setForm] = useState<AiConfig>({
    enabled: false,
    agentName: "Assistente",
    companyName: "",
    extraInstructions: "",
  });
  useEffect(() => {
    if (config) setForm(config);
  }, [config]);

  const saveConfig = useMutation({
    mutationFn: (value: AiConfig) => persistConfig({ data: value }),
    onSuccess: () => {
      toast.success("Configuração da IA salva.");
      void queryClient.invalidateQueries({ queryKey: ["ai-config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const testIa = useMutation({
    mutationFn: () => runTest({ data: undefined as never }),
    onSuccess: (result: { status: string; reason: string }) => {
      if (result.status === "replied") toast.success("A IA respondeu a última conversa.");
      else if (result.status === "handoff")
        toast.warning(`Transferido para humano: ${result.reason || "sem motivo"}`);
      else toast.error(`IA não respondeu: ${result.reason || "sem motivo"}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveItem = useMutation({
    mutationFn: (item: KnowledgeItem) =>
      persist({
        data: {
          ...(item.id ? { id: item.id } : {}),
          title: item.title,
          category: item.category,
          content: item.content,
          status: item.status,
        },
      }),
    onSuccess: () => {
      toast.success("Conteúdo salvo.");
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ["knowledge"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeItem = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      toast.success("Conteúdo removido.");
      void queryClient.invalidateQueries({ queryKey: ["knowledge"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activeCount = (items ?? []).filter((i) => i.status === "ACTIVE").length;

  return (
    <AppShell title="Conhecimento IA" description="Base oficial consultada pela inteligência artificial">
      <div className="space-y-6">
        <Card className="shadow-panel">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className="size-4" /> Atendimento por IA
            </CardTitle>
            <CardDescription>
              Quando ativo, a IA responde os leads no WhatsApp usando apenas os conteúdos ativos abaixo e
              transfere para um consultor humano sempre que faltar informação confiável.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border p-3 md:col-span-2">
              <div>
                <p className="text-sm font-medium">IA ativa</p>
                <p className="text-xs text-muted-foreground">
                  {activeCount} conteúdo(s) ativo(s) na base.
                </p>
              </div>
              <Switch
                checked={form.enabled}
                disabled={!isAdmin}
                onCheckedChange={(enabled) => setForm((f) => ({ ...f, enabled }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Nome do atendente virtual</Label>
              <Input
                value={form.agentName}
                disabled={!isAdmin}
                onChange={(e) => setForm((f) => ({ ...f, agentName: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Nome da empresa nas mensagens</Label>
              <Input
                value={form.companyName}
                disabled={!isAdmin}
                onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>Instruções adicionais</Label>
              <Textarea
                rows={3}
                value={form.extraInstructions}
                disabled={!isAdmin}
                placeholder="Ex.: sempre oferecer análise gratuita e pedir o melhor horário para contato."
                onChange={(e) => setForm((f) => ({ ...f, extraInstructions: e.target.value }))}
              />
            </div>
            {isAdmin ? (
              <div className="flex flex-wrap gap-2 md:col-span-2">
                <Button onClick={() => saveConfig.mutate(form)} disabled={saveConfig.isPending}>
                  Salvar configuração
                </Button>
                <Button
                  variant="outline"
                  onClick={() => testIa.mutate()}
                  disabled={testIa.isPending}
                >
                  {testIa.isPending ? "Testando..." : "Testar IA na última conversa"}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="shadow-panel">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Conteúdos</CardTitle>
              <CardDescription>A IA nunca inventa informação fora desta base.</CardDescription>
            </div>
            {isAdmin ? (
              <Button size="sm" onClick={() => setEditing({ ...EMPTY })}>
                <Plus className="mr-1 size-4" /> Novo conteúdo
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
            ) : (items ?? []).length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nenhum conteúdo cadastrado.
              </p>
            ) : (
              (items ?? []).map((item) => (
                <div key={item.id} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{item.title}</span>
                        <Badge variant="outline">{item.category}</Badge>
                        <Badge variant={item.status === "ACTIVE" ? "default" : "secondary"}>
                          {STATUSES.find((s) => s.value === item.status)?.label ?? item.status}
                        </Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.content}</p>
                    </div>
                    {isAdmin ? (
                      <div className="flex shrink-0 gap-1">
                        <Button size="icon" variant="ghost" onClick={() => setEditing(item)}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => removeItem.mutate(item.id)}
                          disabled={removeItem.isPending}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Editar conteúdo" : "Novo conteúdo"}</DialogTitle>
            <DialogDescription>
              Escreva de forma objetiva: este texto é a única fonte usada pela IA.
            </DialogDescription>
          </DialogHeader>
          {editing ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Título</Label>
                <Input
                  value={editing.title}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Categoria</Label>
                  <Select
                    value={editing.category}
                    onValueChange={(category) => setEditing({ ...editing, category })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Situação</Label>
                  <Select
                    value={editing.status}
                    onValueChange={(status) => setEditing({ ...editing, status })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Conteúdo</Label>
                <Textarea
                  rows={12}
                  value={editing.content}
                  onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button
              onClick={() => editing && saveItem.mutate(editing)}
              disabled={saveItem.isPending}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function GuardedConhecimentoPage() {
  return (
    <AdminOnly title="Conhecimento IA" description="Base usada pela inteligência artificial">
      <ConhecimentoPage />
    </AdminOnly>
  );
}
