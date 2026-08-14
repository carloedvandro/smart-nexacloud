import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Copy,
  Eye,
  KeyRound,
  Link as LinkIcon,
  Loader2,
  ShieldCheck,
  Trash2,
  UserPlus,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { AVAILABILITY_LABEL, type Availability } from "@/lib/nexa/domain";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — NexaAtende" },
      {
        name: "description",
        content:
          "Perfil, segurança e senha, dados da empresa e gestão de equipe: promova consultores a administradores e convide novos membros.",
      },
      { property: "og:title", content: "Configurações — NexaAtende" },
      { property: "og:description", content: "Perfil, senha, empresa e equipe do NexaAtende." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SettingsPage,
});

type MemberRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  availability: Availability;
  is_active: boolean;
};

type InviteRow = { id: string; email: string; role: string; created_at: string };

function SettingsPage() {
  const { profile, companyId, isAdmin, refresh } = useAuth();

  return (
    <AppShell title="Configurações" description="Perfil, segurança, empresa e equipe">
      <Tabs defaultValue="perfil" className="space-y-6">
        <TabsList className="flex-wrap">
          <TabsTrigger value="perfil">Meu perfil</TabsTrigger>
          <TabsTrigger value="seguranca">Segurança</TabsTrigger>
          {isAdmin ? <TabsTrigger value="empresa">Empresa</TabsTrigger> : null}
          {isAdmin ? <TabsTrigger value="equipe">Equipe e permissões</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="perfil">
          <ProfileCard onSaved={refresh} />
        </TabsContent>

        <TabsContent value="seguranca">
          <PasswordCard email={profile?.email ?? null} />
        </TabsContent>

        {isAdmin ? (
          <TabsContent value="empresa">
            <CompanyCard companyId={companyId} />
          </TabsContent>
        ) : null}

        {isAdmin ? (
          <TabsContent value="equipe">
            <TeamCard companyId={companyId} currentUserId={profile?.id ?? null} />
          </TabsContent>
        ) : null}
      </Tabs>
    </AppShell>
  );
}

function ProfileCard({ onSaved }: { onSaved: () => Promise<void> }) {
  const { profile } = useAuth();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [availability, setAvailability] = useState<Availability>("OFFLINE");

  useEffect(() => {
    if (!profile) return;
    setFullName(profile.full_name ?? "");
    setPhone(profile.phone ?? "");
    setAvailability(profile.availability);
  }, [profile]);

  const save = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Perfil indisponível");
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: fullName.trim() || null,
          phone: phone.trim() || null,
          availability,
        })
        .eq("id", profile.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await onSaved();
      toast.success("Perfil atualizado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="shadow-panel">
      <CardHeader>
        <CardTitle className="text-base">Meu perfil</CardTitle>
        <CardDescription>Nome exibido nas conversas, telefone de contato e disponibilidade para receber atendimentos.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="full_name">Nome completo</Label>
          <Input id="full_name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Telefone</Label>
          <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(00) 00000-0000" />
        </div>
        <div className="space-y-2">
          <Label>E-mail</Label>
          <Input value={profile?.email ?? ""} disabled />
        </div>
        <div className="space-y-2">
          <Label>Disponibilidade</Label>
          <Select value={availability} onValueChange={(v) => setAvailability(v as Availability)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(AVAILABILITY_LABEL) as Availability[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {AVAILABILITY_LABEL[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Salvar perfil
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PasswordCard({ email }: { email: string | null }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const change = useMutation({
    mutationFn: async () => {
      if (password.length < 8) throw new Error("A senha deve ter ao menos 8 caracteres");
      if (password !== confirm) throw new Error("As senhas não conferem");
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
    },
    onSuccess: () => {
      setPassword("");
      setConfirm("");
      toast.success("Senha alterada com sucesso");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reset = useMutation({
    mutationFn: async () => {
      if (!email) throw new Error("E-mail indisponível");
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth`,
      });
      if (error) throw error;
    },
    onSuccess: () => toast.success("Enviamos um link de redefinição para o seu e-mail"),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="shadow-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="size-4 text-primary" /> Senha e acesso
        </CardTitle>
        <CardDescription>
          Defina uma nova senha para a sua conta. Contas criadas via Google podem definir uma senha
          aqui para também entrar por e-mail.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="new_password">Nova senha</Label>
          <Input
            id="new_password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm_password">Confirmar nova senha</Label>
          <Input
            id="confirm_password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button onClick={() => change.mutate()} disabled={change.isPending}>
            {change.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Alterar senha
          </Button>
          <Button variant="outline" onClick={() => reset.mutate()} disabled={reset.isPending}>
            Enviar link de redefinição
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CompanyCard({ companyId }: { companyId: string | null }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    legal_name: "",
    document: "",
    email: "",
    phone: "",
    city: "",
    state: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["company", companyId],
    enabled: Boolean(companyId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id, name, legal_name, document, email, phone, city, state")
        .eq("id", companyId as string)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!data) return;
    setForm({
      name: data.name ?? "",
      legal_name: data.legal_name ?? "",
      document: data.document ?? "",
      email: data.email ?? "",
      phone: data.phone ?? "",
      city: data.city ?? "",
      state: data.state ?? "",
    });
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!companyId) throw new Error("Empresa indisponível");
      if (!form.name.trim()) throw new Error("Informe o nome da empresa");
      const { error } = await supabase
        .from("companies")
        .update({
          name: form.name.trim(),
          legal_name: form.legal_name.trim() || null,
          document: form.document.trim() || null,
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          city: form.city.trim() || null,
          state: form.state.trim() || null,
        })
        .eq("id", companyId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["company", companyId] });
      toast.success("Dados da empresa atualizados");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const field = (key: keyof typeof form, label: string) => (
    <div className="space-y-2">
      <Label htmlFor={key}>{label}</Label>
      <Input
        id={key}
        value={form[key]}
        onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
      />
    </div>
  );

  return (
    <Card className="shadow-panel">
      <CardHeader>
        <CardTitle className="text-base">Dados da empresa</CardTitle>
        <CardDescription>Informações cadastrais usadas em relatórios e documentos.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        {field("name", "Nome fantasia")}
        {field("legal_name", "Razão social")}
        {field("document", "CNPJ")}
        {field("email", "E-mail")}
        {field("phone", "Telefone")}
        {field("city", "Cidade")}
        {field("state", "Estado")}
        <div className="sm:col-span-2">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Salvar empresa
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TeamCard({
  companyId,
  currentUserId,
}: {
  companyId: string | null;
  currentUserId: string | null;
}) {
  const queryClient = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "CONSULTANT">("CONSULTANT");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [linkHours, setLinkHours] = useState(168);

  const { data, isLoading } = useQuery({
    queryKey: ["company-team", companyId],
    enabled: Boolean(companyId),
    queryFn: async () => {
      const [{ data: members, error: mErr }, { data: invites, error: iErr }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, email, availability, is_active")
          .eq("company_id", companyId as string)
          .order("full_name", { nullsFirst: false }),
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
    void queryClient.invalidateQueries({ queryKey: ["company-team", companyId] });
  }

  const invite = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("company_invite_member", {
        _email: inviteEmail,
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
      return data as { token: string; expires_at: string };
    },
    onSuccess: (result) => {
      setInviteLink(`${window.location.origin}/convite/${result.token}`);
      invalidate();
      toast.success("Link de convite gerado (uso único)");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <Card className="shadow-panel">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <LinkIcon className="size-4 text-primary" /> Link de indicação (uso único)
          </CardTitle>
          <CardDescription>
            Gere um link exclusivo para cadastrar um colaborador com CPF diretamente na sua empresa.
            O link vale para uma única pessoa e expira no prazo escolhido — depois de usado, deixa de
            funcionar para qualquer outra pessoa.
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
            <UserPlus className="size-4 text-primary" /> Convidar membro
          </CardTitle>
          <CardDescription>
            Se a pessoa já tiver conta no NexaAtende, o vínculo é feito na hora. Caso contrário, o
            acesso é liberado automaticamente no primeiro login com este e-mail.
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
              placeholder="pessoa@empresa.com.br"
            />
          </div>
          <div className="space-y-2 sm:w-48">
            <Label>Papel</Label>
            <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as "ADMIN" | "CONSULTANT")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CONSULTANT">Consultor</SelectItem>
                <SelectItem value="ADMIN">Administrador</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => invite.mutate()} disabled={invite.isPending || !inviteEmail.trim()}>
            {invite.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Convidar
          </Button>
        </CardContent>
      </Card>

      <Card className="shadow-panel">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4 text-primary" /> Equipe e permissões
          </CardTitle>
          <CardDescription>
            Troque um consultor para administrador (ou o contrário). A empresa sempre mantém ao
            menos um administrador.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (data?.members.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum membro vinculado ainda.</p>
          ) : (
            data?.members.map((member) => {
              const roles = data.roleMap.get(member.id) ?? [];
              const isMemberAdmin = roles.includes("ADMIN");
              const isPlatform = roles.includes("PLATFORM_ADMIN");
              const isSelf = member.id === currentUserId;
              return (
                <div
                  key={member.id}
                  className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {member.full_name ?? member.email}
                      {isSelf ? <span className="text-muted-foreground"> (você)</span> : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {member.email} · {AVAILABILITY_LABEL[member.availability]}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {isPlatform ? <Badge variant="secondary">Plataforma</Badge> : null}
                    <Select
                      value={isMemberAdmin ? "ADMIN" : "CONSULTANT"}
                      onValueChange={(v) =>
                        setRole.mutate({ userId: member.id, role: v as "ADMIN" | "CONSULTANT" })
                      }
                      disabled={setRole.isPending}
                    >
                      <SelectTrigger className="w-44">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CONSULTANT">Consultor</SelectItem>
                        <SelectItem value="ADMIN">Administrador</SelectItem>
                      </SelectContent>
                    </Select>
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
                  </div>
                </div>
              );
            })
          )}

          {(data?.invites.length ?? 0) > 0 ? (
            <>
              <Separator />
              <p className="text-sm font-medium">Convites pendentes</p>
              {data?.invites.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between rounded-lg border border-dashed border-border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">{inv.email}</p>
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
  );
}
