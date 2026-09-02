import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, EyeOff, KeyRound, ShieldCheck, Trash2 } from "lucide-react";

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
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { PasswordInput } from "@/components/nexa/password-input";

type Row = {
  company_id: string;
  company_name: string | null;
  max_delete_admins: number;
  user_id: string | null;
  display_name: string | null;
  password_plain: string | null;
  full_name: string | null;
  email: string | null;
  updated_at: string | null;
};

type CompanyGroup = {
  id: string;
  name: string;
  limit: number;
  members: Row[];
};

export function PlatformDeleteAdminsCard() {
  const queryClient = useQueryClient();
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [targetUser, setTargetUser] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState<Record<string, string>>({});
  const [newPass, setNewPass] = useState<Record<string, string>>({});

  const list = useQuery({
    queryKey: ["platform-delete-credentials"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("platform_list_delete_credentials");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const groups = useMemo<CompanyGroup[]>(() => {
    const map = new Map<string, CompanyGroup>();
    for (const row of list.data ?? []) {
      const group = map.get(row.company_id) ?? {
        id: row.company_id,
        name: row.company_name ?? "Empresa sem nome",
        limit: row.max_delete_admins ?? 2,
        members: [],
      };
      if (row.user_id) group.members.push(row);
      map.set(row.company_id, group);
    }
    return [...map.values()];
  }, [list.data]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["platform-delete-credentials"] });

  const saveLimit = useMutation({
    mutationFn: async ({ companyId, limit }: { companyId: string; limit: number }) => {
      const { error } = await supabase.rpc("platform_set_delete_admin_limit", {
        _company_id: companyId,
        _limit: limit,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Limite atualizado");
      void invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setCredential = useMutation({
    mutationFn: async ({ userId, name, password }: { userId: string; name: string; password: string }) => {
      const { error } = await supabase.rpc("platform_set_delete_credential", {
        _user_id: userId,
        _display_name: name,
        _password: password,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Responsável de exclusão salvo");
      void invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeCredential = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc("platform_remove_delete_credential", { _user_id: userId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Acesso de exclusão removido");
      void invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (list.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <div className="space-y-6">
      <Card className="shadow-panel">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4 text-primary" /> Responsáveis por exclusão (todas as empresas)
          </CardTitle>
          <CardDescription>
            Visão exclusiva do super administrador: veja quem pode excluir conversas em cada empresa,
            consulte ou redefina a senha pessoal dessas pessoas e ajuste quantos responsáveis cada
            empresa pode ter.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {groups.map((group) => (
            <div key={group.id} className="rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{group.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {group.members.length} de {group.limit} responsáveis cadastrados
                  </p>
                </div>
                <div className="flex items-end gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs" htmlFor={`limit-${group.id}`}>
                      Limite
                    </Label>
                    <Input
                      id={`limit-${group.id}`}
                      type="number"
                      min={0}
                      max={20}
                      className="w-24"
                      value={limits[group.id] ?? String(group.limit)}
                      onChange={(e) => setLimits((prev) => ({ ...prev, [group.id]: e.target.value }))}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={saveLimit.isPending}
                    onClick={() =>
                      saveLimit.mutate({
                        companyId: group.id,
                        limit: Number(limits[group.id] ?? group.limit),
                      })
                    }
                  >
                    Salvar limite
                  </Button>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {group.members.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhum responsável com senha de exclusão nesta empresa.
                  </p>
                ) : (
                  group.members.map((member) => {
                    const key = member.user_id as string;
                    const show = revealed[key] ?? false;
                    return (
                      <div
                        key={key}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border p-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{member.display_name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {member.full_name ?? "—"} · {member.email ?? "—"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="font-mono text-xs">
                            {show ? member.password_plain ?? "senha antiga (não visível)" : "••••••••"}
                          </Badge>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setRevealed((prev) => ({ ...prev, [key]: !show }))}
                            aria-label={show ? "Ocultar senha" : "Mostrar senha"}
                          >
                            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => removeCredential.mutate(key)}
                            disabled={removeCredential.isPending}
                            aria-label="Remover acesso"
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <CompanyCredentialForm
                companyId={group.id}
                targetUser={targetUser[group.id] ?? ""}
                onTargetUser={(v) => setTargetUser((prev) => ({ ...prev, [group.id]: v }))}
                name={newName[group.id] ?? ""}
                onName={(v) => setNewName((prev) => ({ ...prev, [group.id]: v }))}
                password={newPass[group.id] ?? ""}
                onPassword={(v) => setNewPass((prev) => ({ ...prev, [group.id]: v }))}
                pending={setCredential.isPending}
                onSubmit={() => {
                  const userId = targetUser[group.id];
                  if (!userId) {
                    toast.error("Selecione o administrador");
                    return;
                  }
                  setCredential.mutate(
                    {
                      userId,
                      name: newName[group.id] ?? "",
                      password: newPass[group.id] ?? "",
                    },
                    {
                      onSuccess: () => {
                        setNewPass((prev) => ({ ...prev, [group.id]: "" }));
                      },
                    },
                  );
                }}
              />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function CompanyCredentialForm({
  companyId,
  targetUser,
  onTargetUser,
  name,
  onName,
  password,
  onPassword,
  pending,
  onSubmit,
}: {
  companyId: string;
  targetUser: string;
  onTargetUser: (v: string) => void;
  name: string;
  onName: (v: string) => void;
  password: string;
  onPassword: (v: string) => void;
  pending: boolean;
  onSubmit: () => void;
}) {
  const admins = useQuery({
    queryKey: ["platform-company-admins", companyId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("platform_list_company_admins", {
        _company_id: companyId,
      });
      if (error) throw error;
      return (data ?? []) as { user_id: string; full_name: string | null; email: string | null }[];
    },
  });

  return (
    <div className="mt-4 grid gap-3 rounded-lg bg-muted/40 p-3 sm:grid-cols-4">
      <div className="space-y-1 sm:col-span-2">
        <Label className="text-xs">Administrador</Label>
        <Select value={targetUser} onValueChange={onTargetUser}>
          <SelectTrigger>
            <SelectValue placeholder="Selecionar administrador" />
          </SelectTrigger>
          <SelectContent>
            {(admins.data ?? []).map((a) => (
              <SelectItem key={a.user_id} value={a.user_id}>
                {a.full_name ?? a.email ?? a.user_id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Nome de confirmação</Label>
        <Input value={name} onChange={(e) => onName(e.target.value)} placeholder="Nome exibido" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Senha</Label>
        <PasswordInput
          value={password}
          autoComplete="new-password"
          onChange={(e) => onPassword(e.target.value)}
        />
      </div>
      <div className="sm:col-span-4">
        <Button size="sm" onClick={onSubmit} disabled={pending}>
          <KeyRound className="mr-2 size-4" /> Definir senha de exclusão
        </Button>
      </div>
    </div>
  );
}
