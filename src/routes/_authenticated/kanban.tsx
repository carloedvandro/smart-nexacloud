import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { MessagesSquare, Search, UserCircle2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/nexa/app-shell";
import { AdminOnly } from "@/components/nexa/admin-only";
import { LeadDetailSheet } from "@/components/nexa/lead-detail-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getKnowledgeScope } from "@/lib/ai/ai.functions";
import { useAuth } from "@/hooks/use-auth";
import {
  LEAD_SOURCE_LABEL,
  LEAD_STATUS_LABEL,
  type LeadStatus,
} from "@/lib/nexa/domain";
import {
  assignLeadAndService,
  getOrCreateConversation,
  listConsultants,
  setLeadStage,
  type LeadRow,
} from "@/lib/nexa/crm";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/kanban")({
  head: () => ({
    meta: [
      { title: "Kanban de leads — NexaAtende" },
      {
        name: "description",
        content:
          "Funil visual em tempo real: veja em qual etapa cada lead está e com qual consultor ele se encontra.",
      },
      { property: "og:title", content: "Kanban de leads — NexaAtende" },
      { property: "og:description", content: "Funil visual de leads do NexaAtende." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: KanbanRoute,
});

/** Colunas do funil, na ordem comercial. */
const COLUMNS: { status: LeadStatus; accent: string }[] = [
  { status: "NEW", accent: "bg-slate-400" },
  { status: "AI_QUALIFYING", accent: "bg-violet-500" },
  { status: "QUALIFIED", accent: "bg-sky-500" },
  { status: "WAITING_HUMAN", accent: "bg-amber-500" },
  { status: "IN_SERVICE", accent: "bg-primary" },
  { status: "WAITING_CUSTOMER", accent: "bg-orange-500" },
  { status: "WON", accent: "bg-emerald-500" },
  { status: "LOST", accent: "bg-destructive" },
];

function KanbanRoute() {
  return (
    <AdminOnly title="Kanban" description="Funil visual de leads">
      <KanbanPage />
    </AdminOnly>
  );
}

async function fetchKanbanLeads(companyId: string) {
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("company_id", companyId)
    .neq("status", "ARCHIVED")
    .order("last_interaction_at", { ascending: false, nullsFirst: false })
    .limit(400);
  if (error) throw new Error(error.message);
  return (data ?? []) as LeadRow[];
}

function KanbanPage() {
  const { companyId: myCompanyId, roles } = useAuth();
  const isPlatformAdmin = roles.includes("PLATFORM_ADMIN");
  const fetchScope = useServerFn(getKnowledgeScope);
  const { data: scope } = useQuery({ queryKey: ["kanban-scope"], queryFn: () => fetchScope() });
  const [companyOverride, setCompanyOverride] = useState<string | null>(null);
  const companyId = companyOverride ?? myCompanyId ?? scope?.companyId ?? null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [consultantFilter, setConsultantFilter] = useState("ALL");
  const [selectedLead, setSelectedLead] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<LeadStatus | null>(null);

  const { data: leads, isLoading } = useQuery({
    queryKey: ["kanban-leads", companyId],
    queryFn: () => fetchKanbanLeads(companyId as string),
    enabled: Boolean(companyId),
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });

  const { data: consultants } = useQuery({
    queryKey: ["consultants", companyId],
    queryFn: () => listConsultants(companyId as string),
    enabled: Boolean(companyId),
  });

  useEffect(() => {
    if (!companyId) return;
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ["kanban-leads", companyId] });
    };
    const channel = supabase
      .channel("kanban-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "assignment_attempts" }, invalidate)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [companyId, queryClient]);

  const consultantName = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of consultants ?? []) map.set(c.id, c.full_name ?? c.email ?? "Consultor");
    return map;
  }, [consultants]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const digits = search.replace(/\D/g, "");
    return (leads ?? []).filter((lead) => {
      if (consultantFilter === "NONE" && lead.assigned_user_id) return false;
      if (consultantFilter !== "ALL" && consultantFilter !== "NONE" && lead.assigned_user_id !== consultantFilter)
        return false;
      if (!term) return true;
      const haystack = `${lead.name ?? ""} ${lead.email ?? ""}`.toLowerCase();
      if (haystack.includes(term)) return true;
      return Boolean(digits) && `${lead.whatsapp ?? ""}${lead.phone ?? ""}`.includes(digits);
    });
  }, [leads, search, consultantFilter]);

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["kanban-leads", companyId] });
    void queryClient.invalidateQueries({ queryKey: ["leads"] });
    void queryClient.invalidateQueries({ queryKey: ["conversations"] });
  };

  const moveLead = useMutation({
    mutationFn: ({ leadId, status }: { leadId: string; status: LeadStatus }) =>
      setLeadStage(leadId, status),
    onSuccess: () => {
      refreshAll();
      toast.success("Etapa atualizada");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const changeOwner = useMutation({
    mutationFn: ({ leadId, consultantId }: { leadId: string; consultantId: string | null }) =>
      assignLeadAndService(leadId, consultantId),
    onSuccess: (result) => {
      refreshAll();
      if (result?.notification && !result.notification.notified && result.notification.reason) {
        toast.warning(result.notification.reason);
      } else {
        toast.success("Responsável atualizado e atendimento em andamento");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const openConversation = useMutation({
    mutationFn: (leadId: string) => getOrCreateConversation(leadId),
    onSuccess: (conversationId) => {
      void navigate({ to: "/conversas", search: { c: conversationId } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell
      title="Kanban de leads"
      description={`${filtered.length} lead(s) no funil — atualização em tempo real`}
    >
      {isPlatformAdmin && (scope?.companies?.length ?? 0) > 0 ? (
        <div className="mb-3 flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Empresa</span>
          <Select value={companyId ?? ""} onValueChange={(v) => setCompanyOverride(v)}>
            <SelectTrigger className="sm:w-72"><SelectValue placeholder="Selecionar empresa" /></SelectTrigger>
            <SelectContent>
              {(scope?.companies ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, telefone ou e-mail"
            className="pl-9"
          />
        </div>
        <Select value={consultantFilter} onValueChange={setConsultantFilter}>
          <SelectTrigger className="sm:w-60"><SelectValue placeholder="Consultor" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Todos os consultores</SelectItem>
            <SelectItem value="NONE">Sem responsável</SelectItem>
            {(consultants ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.full_name ?? c.email}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {COLUMNS.map((col) => (
            <Skeleton key={col.status} className="h-64 w-72 shrink-0" />
          ))}
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {COLUMNS.map((col) => {
            const items = filtered.filter((lead) => lead.status === col.status);
            return (
              <section
                key={col.status}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDropTarget(col.status);
                }}
                onDragLeave={() => setDropTarget((s) => (s === col.status ? null : s))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDropTarget(null);
                  const leadId = dragging ?? e.dataTransfer.getData("text/plain");
                  setDragging(null);
                  const lead = (leads ?? []).find((l) => l.id === leadId);
                  if (!lead || lead.status === col.status) return;
                  moveLead.mutate({ leadId, status: col.status });
                }}
                className={cn(
                  "flex w-72 shrink-0 flex-col rounded-xl border border-border bg-muted/40 transition-colors",
                  dropTarget === col.status && "border-primary bg-primary/5",
                )}
              >
                <header className="flex items-center gap-2 border-b border-border px-3 py-2">
                  <span className={cn("size-2.5 rounded-full", col.accent)} />
                  <h2 className="flex-1 truncate text-sm font-semibold">
                    {LEAD_STATUS_LABEL[col.status]}
                  </h2>
                  <Badge variant="secondary">{items.length}</Badge>
                </header>

                <div className="flex-1 space-y-2 overflow-y-auto p-2" style={{ maxHeight: "calc(100vh - 260px)" }}>
                  {items.length === 0 ? (
                    <p className="px-2 py-6 text-center text-xs text-muted-foreground">Sem leads nesta etapa</p>
                  ) : null}

                  {items.map((lead) => (
                    <article
                      key={lead.id}
                      draggable
                      onDragStart={(e) => {
                        setDragging(lead.id);
                        e.dataTransfer.setData("text/plain", lead.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setDropTarget(null);
                      }}
                      onClick={() => setSelectedLead(lead.id)}
                      className={cn(
                        "cursor-pointer rounded-lg border border-border bg-card p-3 shadow-sm transition hover:border-primary/50 hover:shadow-panel",
                        dragging === lead.id && "opacity-50",
                      )}
                    >
                      <p className="truncate text-sm font-medium">
                        {lead.name ?? lead.whatsapp ?? lead.phone ?? "Lead sem nome"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {lead.whatsapp ?? lead.phone ?? "—"} · {LEAD_SOURCE_LABEL[lead.source] ?? lead.source}
                      </p>

                      <div className="mt-2 flex items-center gap-1.5 text-xs">
                        <UserCircle2 className="size-3.5 text-muted-foreground" />
                        <span className={cn("truncate", !lead.assigned_user_id && "text-muted-foreground")}>
                          {lead.assigned_user_id
                            ? consultantName.get(lead.assigned_user_id) ?? "Consultor"
                            : "Sem responsável"}
                        </span>
                      </div>

                      <div
                        className="mt-2 flex items-center gap-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Select
                          value={lead.assigned_user_id ?? "NONE"}
                          onValueChange={(v) =>
                            changeOwner.mutate({ leadId: lead.id, consultantId: v === "NONE" ? null : v })
                          }
                        >
                          <SelectTrigger className="h-8 flex-1 text-xs">
                            <SelectValue placeholder="Atribuir" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="NONE">Sem responsável</SelectItem>
                            {(consultants ?? []).map((c) => (
                              <SelectItem key={c.id} value={c.id}>{c.full_name ?? c.email}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          title="Abrir conversa"
                          onClick={() => openConversation.mutate(lead.id)}
                        >
                          <MessagesSquare className="size-4" />
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <LeadDetailSheet
        leadId={selectedLead}
        onOpenChange={(open) => {
          if (!open) setSelectedLead(null);
        }}
        onOpenConversation={(leadId) => openConversation.mutate(leadId)}
      />
    </AppShell>
  );
}
