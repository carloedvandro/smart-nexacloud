import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Copy,
  Eye,
  Link as LinkIcon,
  Loader2,
  Power,
  Search,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";

import { AppShell } from "@/components/nexa/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { AVAILABILITY_LABEL, type Availability } from "@/lib/nexa/domain";
import { buildInviteUrl } from "@/lib/nexa/public-url";

export const Route = createFileRoute("/_authenticated/consultores")({
  head: () => ({
    meta: [
      { title: "Consultores — NexaAtende" },
      {
        name: "description",
        content:
          "Equipe de consultores: convites por link de uso único, papéis de acesso, ativação e disponibilidade em tempo real.",
      },
      { property: "og:title", content: "Consultores — NexaAtende" },
      { property: "og:description", content: "Gestão da equipe de atendimento." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ConsultantsPage,
});

type MemberRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  availability: Availability;
  is_active: boolean;
  metadata: Record<string, unknown> | null;
};


type InviteRow = { id: string; email: string | null; role: string; created_at: string };

function ConsultantsPage() {
  const { companyId, isAdmin, profile } = useAuth();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "CONSULTANT">("CONSULTANT");
  const [linkHours, setLinkHours] = useState(168);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["consultants", companyId],
    enabled: Boolean(companyId),
    queryFn: async () => {
      const [{ data: members, error: mErr }, { data: invites, error: iErr }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, email, phone, availability, is_active, metadata")
          .eq("company_id", companyId as string)
          .order("full_name", { nullsFirst: false })
          .limit(200),
        supabase
          .from("company_invites")
          .select("id, email, role, created_at")
          .eq("company_id", companyId as string)
          .eq("status", "PENDING")
          .order("created_at", { ascending: false }),
      ]);
      if (mErr) throw mErr;
      if (iErr) throw iErr;

      const ids = (members ?? []).map((m) => m.id);
      const { data: roleRows } = ids.length
        ? await supabase.from("user_roles").select("user_id, role").in("user_id", ids)
        : { data: [] as { user_id: string; role: string }[] };

      const roleMap = new Map<string, string[]>();
      for (const row of roleRows ?? []) {
        roleMap.set(row.user_id, [...(roleMap.get(row.user_id) ?? []), row.role]);
      }

      return {
        members: (members ?? []) as MemberRow[],
        invites: (invites ?? []) as InviteRow[],
        roleMap,
      };
    },
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["consultants", companyId] });
  }

  const setRole = useMutation({
    mutationFn: async (input: { userId: string; role: "ADMIN" | "CONSULTANT" }) => {
      const { error } = await supabase.rpc("company_set_member_role", {
        _user_id: input.userId,
        _role: input.role,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Permissão atualizada");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async (input: { userId: string; next: boolean }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ is_active: input.next })
        .eq("id", input.userId);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Situação do consultor atualizada");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc("company_remove_member", { _user_id: userId });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Vínculo removido");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const invite = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("company_invite_member", {
        _email: inviteEmail.trim(),
        _role: inviteRole,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setInviteEmail("");
      invalidate();
      toast.success("Convite registrado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelInvite = useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await supabase.rpc("company_cancel_invite", { _invite_id: inviteId });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Convite cancelado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createLink = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("create_invite_link", {
        _role: inviteRole,
        _expires_hours: linkHours,
      });
      if (error) throw error;
      return data as unknown as { token: string; expires_at: string };
    },
    onSuccess: (result) => {
      setInviteLink(buildInviteUrl(result.token));
      invalidate();
      toast.success("Link de convite gerado (uso único)");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const members = data?.members ?? [];
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return members.filter((m) => {
      if (statusFilter === "ACTIVE" && !m.is_active) return false;
      if (statusFilter === "INACTIVE" && m.is_active) return false;
      if (!term) return true;
      return (
        (m.full_name ?? "").toLowerCase().includes(term) ||
        (m.email ?? "").toLowerCase().includes(term)
      );
    });
  }, [members, search, statusFilter]);

  const stats = useMemo(
    () => ({
      total: members.length,
      online: members.filter((m) => m.availability === "ONLINE").length,
      inactive: members.filter((m) => !m.is_active).length,
      pending: data?.invites.length ?? 0,
    }),
    [members, data?.invites.length],
  );

  return (
    <AppShell title="Consultores" description="Equipe, papéis e disponibilidade">
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Membros" value={stats.total} />
          <StatCard label="Online agora" value={stats.online} />
          <StatCard label="Inativos" value={stats.inactive} />
          <StatCard label="Convites pendentes" value={stats.pending} />
        </div>

        {isAdmin ? (
          <>
            <Card className="shadow-panel">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <LinkIcon className="size-4 text-primary" /> Link de convite (uso único)
                </CardTitle>
                <CardDescription>
                  Gere um link exclusivo para cadastrar um consultor com CPF diretamente na sua
                  empresa. O link expira no prazo escolhido e deixa de funcionar após o primeiro uso.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="space-y-2 sm:w-48">
                    <Label>Papel</Label>
                    <Select
                      value={inviteRole}
                      onValueChange={(v) => setInviteRole(v as "ADMIN" | "CONSULTANT")}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CONSULTANT">Consultor</SelectItem>
                        <SelectItem value="ADMIN">Administrador</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 sm:w-48">
                    <Label>Validade</Label>
                    <Select value={String(linkHours)} onValueChange={(v) => setLinkHours(Number(v))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="24">24 horas</SelectItem>
                        <SelectItem value="72">3 dias</SelectItem>
                        <SelectItem value="168">7 dias</SelectItem>
                        <SelectItem value="720">30 dias</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={() => createLink.mutate()} disabled={createLink.isPending}>
                    {createLink.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                    Gerar link
                  </Button>
                </div>
                {inviteLink ? (
                  <div className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center">
                    <Input readOnly value={inviteLink} className="flex-1" />
                    <Button
                      variant="outline"
                      onClick={() => {
                        void navigator.clipboard.writeText(inviteLink);
                        toast.success("Link copiado");
                      }}
                    >
                      <Copy className="size-4" /> Copiar
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card className="shadow-panel">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <UserPlus className="size-4 text-primary" /> Convidar por e-mail
                </CardTitle>
                <CardDescription>
                  Se a pessoa já tiver conta, o vínculo é feito na hora. Caso contrário, o acesso é
                  liberado no primeiro login com este e-mail.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-2">
                  <Label htmlFor="invite_email">E-mail</Label>
                  <Input
                    id="invite_email"
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="consultor@empresa.com.br"
                  />
                </div>
                <Button
                  onClick={() => invite.mutate()}
                  disabled={invite.isPending || !inviteEmail.trim()}
                >
                  {invite.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  Convidar
                </Button>
              </CardContent>
            </Card>
          </>
        ) : null}

        <Card className="shadow-panel">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="size-4 text-primary" /> Equipe atual
            </CardTitle>
            <CardDescription>
              {isAdmin
                ? "Altere papéis, ative ou desative o acesso e acompanhe a disponibilidade em tempo real."
                : "Colegas vinculados à sua empresa e disponibilidade atual."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por nome ou e-mail"
                  aria-label="Buscar consultor"
                />
              </div>
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
              >
                <SelectTrigger className="sm:w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos</SelectItem>
                  <SelectItem value="ACTIVE">Somente ativos</SelectItem>
                  <SelectItem value="INACTIVE">Somente inativos</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum consultor encontrado.</p>
            ) : (
              filtered.map((member) => {
                const roles = data?.roleMap.get(member.id) ?? [];
                const isMemberAdmin = roles.includes("ADMIN");
                const isPlatform = roles.includes("PLATFORM_ADMIN");
                const isSelf = member.id === profile?.id;
                return (
                  <div
                    key={member.id}
                    className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {member.full_name ?? "Sem nome"}
                        {isSelf ? <span className="text-muted-foreground"> (você)</span> : null}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {member.email}
                        {member.phone ? ` · ${member.phone}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={member.availability === "ONLINE" ? "default" : "secondary"}>
                        {AVAILABILITY_LABEL[member.availability]}
                      </Badge>
                      {isPlatform ? <Badge variant="secondary">Plataforma</Badge> : null}
                      {!member.is_active ? <Badge variant="outline">Inativo</Badge> : null}
                      {isAdmin ? (
                        <>
                          <Select
                            value={isMemberAdmin ? "ADMIN" : "CONSULTANT"}
                            onValueChange={(v) =>
                              setRole.mutate({
                                userId: member.id,
                                role: v as "ADMIN" | "CONSULTANT",
                              })
                            }
                            disabled={setRole.isPending || isSelf}
                          >
                            <SelectTrigger className="w-40">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="CONSULTANT">Consultor</SelectItem>
                              <SelectItem value="ADMIN">Administrador</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={member.is_active ? "Desativar acesso" : "Ativar acesso"}
                            title={member.is_active ? "Desativar acesso" : "Ativar acesso"}
                            disabled={isSelf || toggleActive.isPending}
                            onClick={() =>
                              toggleActive.mutate({ userId: member.id, next: !member.is_active })
                            }
                          >
                            <Power className="size-4" />
                          </Button>
                          <Button asChild variant="ghost" size="icon" aria-label="Ver como usuário">
                            <Link to="/ver-como/$userId" params={{ userId: member.id }}>
                              <Eye className="size-4" />
                            </Link>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Remover vínculo"
                            disabled={isSelf || remove.isPending}
                            onClick={() => remove.mutate(member.id)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}

            {isAdmin && (data?.invites.length ?? 0) > 0 ? (
              <>
                <Separator />
                <p className="text-sm font-medium">Convites pendentes</p>
                {data?.invites.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between rounded-lg border border-dashed border-border p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm">{inv.email ?? "Link de convite"}</p>
                      <p className="text-xs text-muted-foreground">
                        {inv.role === "ADMIN" ? "Administrador" : "Consultor"}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => cancelInvite.mutate(inv.id)}
                      disabled={cancelInvite.isPending}
                    >
                      Cancelar
                    </Button>
                  </div>
                ))}
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="shadow-panel">
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      </CardContent>
    </Card>
  );
}
