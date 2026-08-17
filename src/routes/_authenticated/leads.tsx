import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Plus, Search, MessagesSquare, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/nexa/app-shell";
import { LeadStatusBadge } from "@/components/nexa/status-badge";
import { LeadDetailSheet } from "@/components/nexa/lead-detail-sheet";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  LEAD_SOURCE_LABEL,
  LEAD_STATUS_LABEL,
  PAGE_SIZE,
  type LeadStatus,
} from "@/lib/nexa/domain";
import {
  getOrCreateConversation,
  listConsultants,
  listLeads,
  upsertLead,
  type LeadRow,
  type LeadSource,
} from "@/lib/nexa/crm";
import { PhoneNormalizationService } from "@/lib/nexa/phone";

export const Route = createFileRoute("/_authenticated/leads")({
  head: () => ({
    meta: [
      { title: "Leads — NexaAtende" },
      {
        name: "description",
        content: "CRM de leads com origem de campanha, memória do cliente e histórico de atendimento.",
      },
      { property: "og:title", content: "Leads — NexaAtende" },
      { property: "og:description", content: "CRM de leads do NexaAtende." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LeadsPage,
});

function LeadsPage() {
  const { companyId } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState<LeadStatus | "ALL">("ALL");
  const [source, setSource] = useState("ALL");
  const [assignedTo, setAssignedTo] = useState("ALL");
  const [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search);
      setPage(0);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const queryKey = ["leads", companyId, debounced, status, source, assignedTo, page];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      listLeads({
        companyId: companyId as string,
        search: debounced,
        status,
        source,
        assignedTo,
        page,
        pageSize: PAGE_SIZE,
      }),
    enabled: Boolean(companyId),
  });

  const { data: consultants } = useQuery({
    queryKey: ["consultants", companyId],
    queryFn: () => listConsultants(companyId as string),
    enabled: Boolean(companyId),
  });

  useEffect(() => {
    if (!companyId) return;
    const channel = supabase
      .channel("leads-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["leads", companyId] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [companyId, queryClient]);

  const openConversation = useMutation({
    mutationFn: (leadId: string) => getOrCreateConversation(leadId),
    onSuccess: (conversationId) => {
      void navigate({ to: "/conversas", search: { c: conversationId } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const total = data?.total ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <AppShell
      title="Leads"
      description={`${total} lead(s) na sua empresa`}
      actions={
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" /> Novo lead
        </Button>
      }
    >
      <Card className="shadow-panel">
        <CardContent className="space-y-4 pt-6">
          <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto_auto]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome, telefone ou e-mail"
                className="pl-9"
              />
            </div>

            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v as LeadStatus | "ALL");
                setPage(0);
              }}
            >
              <SelectTrigger className="lg:w-52"><SelectValue placeholder="Situação" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todas as situações</SelectItem>
                {Object.entries(LEAD_STATUS_LABEL).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={source} onValueChange={(v) => { setSource(v); setPage(0); }}>
              <SelectTrigger className="lg:w-44"><SelectValue placeholder="Origem" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todas as origens</SelectItem>
                {Object.entries(LEAD_SOURCE_LABEL).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={assignedTo} onValueChange={(v) => { setAssignedTo(v); setPage(0); }}>
              <SelectTrigger className="lg:w-52"><SelectValue placeholder="Consultor" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos os consultores</SelectItem>
                <SelectItem value="NONE">Sem consultor</SelectItem>
                {(consultants ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.full_name ?? c.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lead</TableHead>
                  <TableHead>WhatsApp</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Última interação</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={6}><Skeleton className="h-6 w-full" /></TableCell>
                    </TableRow>
                  ))
                ) : (data?.rows.length ?? 0) === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                      Nenhum lead encontrado com estes filtros.
                    </TableCell>
                  </TableRow>
                ) : (
                  data?.rows.map((lead) => <LeadRowView key={lead.id} lead={lead} onOpen={() => setSelectedLead(lead.id)} onChat={() => openConversation.mutate(lead.id)} />)
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Página {page + 1} de {lastPage + 1}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Anterior
              </Button>
              <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>
                Próxima
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => queryClient.invalidateQueries({ queryKey: ["leads", companyId] })}
              >
                <RefreshCw className="size-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <CreateLeadDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(leadId) => {
          void queryClient.invalidateQueries({ queryKey: ["leads", companyId] });
          setSelectedLead(leadId);
        }}
      />

      <LeadDetailSheet
        leadId={selectedLead}
        onOpenChange={(open) => !open && setSelectedLead(null)}
        onOpenConversation={(leadId) => openConversation.mutate(leadId)}
      />
    </AppShell>
  );
}

function LeadRowView({
  lead,
  onOpen,
  onChat,
}: {
  lead: LeadRow;
  onOpen: () => void;
  onChat: () => void;
}) {
  return (
    <TableRow className="cursor-pointer" onClick={onOpen}>
      <TableCell>
        <p className="font-medium">{lead.name ?? "Sem nome"}</p>
        <p className="text-xs text-muted-foreground">{lead.email ?? "—"}</p>
      </TableCell>
      <TableCell className="text-sm">{PhoneNormalizationService.formatContact(lead.phone, lead.whatsapp)}</TableCell>
      <TableCell><LeadStatusBadge status={lead.status as LeadStatus} /></TableCell>
      <TableCell className="text-sm">{LEAD_SOURCE_LABEL[lead.source] ?? lead.source}</TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {lead.last_interaction_at
          ? new Date(lead.last_interaction_at).toLocaleString("pt-BR")
          : "—"}
      </TableCell>
      <TableCell className="text-right">
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onChat();
          }}
        >
          <MessagesSquare className="size-4" /> Conversa
        </Button>
      </TableCell>
    </TableRow>
  );
}

function CreateLeadDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (leadId: string) => void;
}) {
  const [form, setForm] = useState({ name: "", phone: "", email: "", city: "", state: "", source: "outro" });

  const normalized = useMemo(() => PhoneNormalizationService.normalize(form.phone), [form.phone]);

  const mutation = useMutation({
    mutationFn: () =>
      upsertLead({
        name: form.name,
        phone: form.phone,
        email: form.email,
        city: form.city,
        state: form.state,
        source: form.source as LeadSource,
      }),
    onSuccess: (leadId) => {
      toast.success("Lead salvo. Números repetidos são unificados automaticamente.");
      onOpenChange(false);
      setForm({ name: "", phone: "", email: "", city: "", state: "", source: "outro" });
      onCreated(leadId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo lead</DialogTitle>
          <DialogDescription>
            O telefone é normalizado e usado para evitar leads duplicados na mesma empresa.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="lead-name">Nome</Label>
            <Input id="lead-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="lead-phone">WhatsApp</Label>
            <Input
              id="lead-phone"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="(11) 99999-9999"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {form.phone ? (normalized ? PhoneNormalizationService.format(form.phone) : "Número inválido") : "Opcional se houver nome"}
            </p>
          </div>
          <div>
            <Label htmlFor="lead-email">E-mail</Label>
            <Input id="lead-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="lead-city">Cidade</Label>
            <Input id="lead-city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="lead-state">UF</Label>
            <Input id="lead-state" maxLength={2} value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase() })} />
          </div>
          <div className="sm:col-span-2">
            <Label>Origem</Label>
            <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(LEAD_SOURCE_LABEL).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            disabled={mutation.isPending || (!form.name.trim() && !normalized) || (Boolean(form.phone) && !normalized)}
            onClick={() => mutation.mutate()}
          >
            Salvar lead
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
