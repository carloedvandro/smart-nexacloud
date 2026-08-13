import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { MessagesSquare, Plus } from "lucide-react";
import { toast } from "sonner";

import { LeadStatusBadge } from "@/components/nexa/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import {
  CONVERSATION_STATUS_LABEL,
  LEAD_SOURCE_LABEL,
  LEAD_STATUS_LABEL,
  type ConversationStatus,
  type LeadStatus,
} from "@/lib/nexa/domain";
import {
  addLeadNote,
  assignLead,
  getLead,
  listConsultants,
  listLeadConversations,
  listLeadMemory,
  listLeadNotes,
  setLeadStatus,
  upsertLeadMemory,
} from "@/lib/nexa/crm";
import { PhoneNormalizationService } from "@/lib/nexa/phone";

export function LeadDetailSheet({
  leadId,
  onOpenChange,
  onOpenConversation,
}: {
  leadId: string | null;
  onOpenChange: (open: boolean) => void;
  onOpenConversation?: (leadId: string) => void;
}) {
  const { companyId, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const enabled = Boolean(leadId);

  const { data: lead, isLoading } = useQuery({
    queryKey: ["lead", leadId],
    queryFn: () => getLead(leadId as string),
    enabled,
  });
  const { data: memory } = useQuery({
    queryKey: ["lead-memory", leadId],
    queryFn: () => listLeadMemory(leadId as string),
    enabled,
  });
  const { data: notes } = useQuery({
    queryKey: ["lead-notes", leadId],
    queryFn: () => listLeadNotes(leadId as string),
    enabled,
  });
  const { data: conversations } = useQuery({
    queryKey: ["lead-conversations", leadId],
    queryFn: () => listLeadConversations(leadId as string),
    enabled,
  });
  const { data: consultants } = useQuery({
    queryKey: ["consultants", companyId],
    queryFn: () => listConsultants(companyId as string),
    enabled: Boolean(companyId),
  });

  const invalidate = (keys: string[]) =>
    keys.forEach((k) => void queryClient.invalidateQueries({ queryKey: [k, leadId] }));

  const statusMutation = useMutation({
    mutationFn: (status: LeadStatus) => setLeadStatus(leadId as string, status),
    onSuccess: () => {
      toast.success("Situação atualizada");
      invalidate(["lead"]);
      void queryClient.invalidateQueries({ queryKey: ["leads", companyId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const assignMutation = useMutation({
    mutationFn: (consultantId: string) =>
      assignLead(leadId as string, consultantId === "NONE" ? null : consultantId),
    onSuccess: () => {
      toast.success("Consultor atualizado");
      invalidate(["lead"]);
      void queryClient.invalidateQueries({ queryKey: ["leads", companyId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Sheet open={enabled} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {isLoading || !lead ? (
          <div className="space-y-3 p-6">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-3">
                {lead.name ?? "Lead sem nome"}
                <LeadStatusBadge status={lead.status as LeadStatus} />
              </SheetTitle>
              <SheetDescription>
                {PhoneNormalizationService.format(lead.whatsapp)} ·{" "}
                {LEAD_SOURCE_LABEL[lead.source] ?? lead.source}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-5 px-4 pb-8">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Situação</Label>
                  <Select
                    value={lead.status}
                    onValueChange={(v) => statusMutation.mutate(v as LeadStatus)}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(LEAD_STATUS_LABEL).map(([key, label]) => (
                        <SelectItem key={key} value={key}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Consultor responsável</Label>
                  <Select
                    value={lead.assigned_user_id ?? "NONE"}
                    onValueChange={(v) => assignMutation.mutate(v)}
                    disabled={!isAdmin}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">Sem consultor</SelectItem>
                      {(consultants ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.full_name ?? c.email}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {onOpenConversation ? (
                <Button className="w-full" onClick={() => onOpenConversation(lead.id)}>
                  <MessagesSquare className="size-4" /> Abrir conversa
                </Button>
              ) : null}

              <Separator />

              <Tabs defaultValue="memoria">
                <TabsList className="w-full">
                  <TabsTrigger value="memoria" className="flex-1">Memória</TabsTrigger>
                  <TabsTrigger value="notas" className="flex-1">Anotações</TabsTrigger>
                  <TabsTrigger value="historico" className="flex-1">Histórico</TabsTrigger>
                  <TabsTrigger value="campanha" className="flex-1">Campanha</TabsTrigger>
                </TabsList>

                <TabsContent value="memoria" className="space-y-3 pt-4">
                  <MemoryForm leadId={lead.id} onSaved={() => invalidate(["lead-memory"])} />
                  {(memory ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Nenhuma informação memorizada ainda. A memória é separada do histórico bruto de mensagens.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {(memory ?? []).map((m) => (
                        <li key={m.id} className="rounded-lg border border-border p-3">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">{m.key}</p>
                          <p className="text-sm">{m.value ?? "—"}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>

                <TabsContent value="notas" className="space-y-3 pt-4">
                  <NoteForm
                    leadId={lead.id}
                    companyId={companyId as string}
                    onSaved={() => invalidate(["lead-notes"])}
                  />
                  {(notes ?? []).map((n) => (
                    <div key={n.id} className="rounded-lg border border-border p-3">
                      <p className="text-sm whitespace-pre-wrap">{n.content}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Date(n.created_at).toLocaleString("pt-BR")}
                      </p>
                    </div>
                  ))}
                </TabsContent>

                <TabsContent value="historico" className="space-y-2 pt-4">
                  {(conversations ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhuma conversa registrada.</p>
                  ) : (
                    (conversations ?? []).map((c) => (
                      <div key={c.id} className="rounded-lg border border-border p-3 text-sm">
                        <p className="font-medium">
                          {CONVERSATION_STATUS_LABEL[c.status as ConversationStatus]}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Início {new Date(c.started_at).toLocaleString("pt-BR")}
                          {c.closed_at ? ` · Encerrada ${new Date(c.closed_at).toLocaleString("pt-BR")}` : ""}
                        </p>
                        {c.summary ? <p className="mt-2 text-muted-foreground">{c.summary}</p> : null}
                      </div>
                    ))
                  )}
                </TabsContent>

                <TabsContent value="campanha" className="space-y-2 pt-4 text-sm">
                  {[
                    ["Origem", LEAD_SOURCE_LABEL[lead.source] ?? lead.source],
                    ["utm_source", lead.utm_source],
                    ["utm_medium", lead.utm_medium],
                    ["utm_campaign", lead.utm_campaign],
                    ["utm_content", lead.utm_content],
                    ["Campanha", lead.campaign_id],
                    ["Anúncio", lead.ad_id],
                    ["Cidade", lead.city],
                    ["UF", lead.state],
                    ["E-mail", lead.email],
                  ].map(([label, value]) => (
                    <div key={label as string} className="flex justify-between gap-4 border-b border-border py-1">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="text-right">{(value as string) || "—"}</span>
                    </div>
                  ))}
                </TabsContent>
              </Tabs>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function MemoryForm({ leadId, onSaved }: { leadId: string; onSaved: () => void }) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");

  const mutation = useMutation({
    mutationFn: () => upsertLeadMemory({ leadId, key, value }),
    onSuccess: () => {
      setKey("");
      setValue("");
      onSaved();
      toast.success("Memória atualizada");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-32 flex-1">
        <Label htmlFor="mem-key">Chave</Label>
        <Input id="mem-key" value={key} onChange={(e) => setKey(e.target.value)} placeholder="dependentes" />
      </div>
      <div className="min-w-32 flex-1">
        <Label htmlFor="mem-value">Valor</Label>
        <Input id="mem-value" value={value} onChange={(e) => setValue(e.target.value)} placeholder="2" />
      </div>
      <Button
        size="sm"
        disabled={!key.trim() || !value.trim() || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        <Plus className="size-4" /> Salvar
      </Button>
    </div>
  );
}

function NoteForm({
  leadId,
  companyId,
  onSaved,
}: {
  leadId: string;
  companyId: string;
  onSaved: () => void;
}) {
  const [content, setContent] = useState("");
  const mutation = useMutation({
    mutationFn: () => addLeadNote({ companyId, leadId, content }),
    onSuccess: () => {
      setContent("");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-2">
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Anotação interna (não vai para o cliente)"
        rows={3}
      />
      <Button size="sm" disabled={!content.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
        Adicionar anotação
      </Button>
    </div>
  );
}
