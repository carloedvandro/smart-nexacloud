import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Building2, Loader2, Plus, ShieldCheck } from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import { WHATSAPP_INSTANCE_STATUS_LABEL } from "@/lib/nexa/domain";
import { PhoneNormalizationService } from "@/lib/nexa/phone";
import {
  configurePlatformWebhook,
  createPlatformCompany,
  getPlatformWebhookUrl,
  inviteCompanyMember,
  listCompanyMembers,
  listPlatformCompanies,
  listPlatformInstances,
  provisionInstanceForCompany,
  removeCompanyMember,
  setCompanyMemberRole,
  updateInstanceCredentials,

} from "@/lib/platform/platform.functions";


export const Route = createFileRoute("/_authenticated/plataforma")({
  head: () => ({
    meta: [
      { title: "Painel do super administrador — NexaAtende" },
      {
        name: "description",
        content:
          "Cadastro de empresas e provisionamento das instâncias de WhatsApp contratadas na plataforma NexaAtende.",
      },
      { property: "og:title", content: "Painel do super administrador — NexaAtende" },
      { property: "og:description", content: "Empresas e instâncias contratadas da plataforma." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PlatformPage,
});

function PlatformPage() {
  const queryClient = useQueryClient();
  const fetchCompanies = useServerFn(listPlatformCompanies);
  const fetchInstances = useServerFn(listPlatformInstances);
  const createCompanyFn = useServerFn(createPlatformCompany);
  const provisionFn = useServerFn(provisionInstanceForCompany);
  const webhookFn = useServerFn(getPlatformWebhookUrl);
  const configureWebhookFn = useServerFn(configurePlatformWebhook);
  const updateCredentialsFn = useServerFn(updateInstanceCredentials);

  const [companyOpen, setCompanyOpen] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [document, setDocument] = useState("");

  const [instanceOpen, setInstanceOpen] = useState(false);
  const [targetCompany, setTargetCompany] = useState("");
  const [instanceKey, setInstanceKey] = useState("");
  const [instanceName, setInstanceName] = useState("");
  const [instanceToken, setInstanceToken] = useState("");
  const [tokenTarget, setTokenTarget] = useState<{ id: string; name: string } | null>(null);
  const [tokenValue, setTokenValue] = useState("");
  const [webhook, setWebhook] = useState<{ id: string; url: string } | null>(null);

  const membersFn = useServerFn(listCompanyMembers);
  const inviteFn = useServerFn(inviteCompanyMember);
  const setRoleFn = useServerFn(setCompanyMemberRole);
  const removeMemberFn = useServerFn(removeCompanyMember);
  const [membersTarget, setMembersTarget] = useState<{ id: string; name: string } | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "CONSULTANT">("ADMIN");

  const membersQuery = useQuery({
    queryKey: ["company-members", membersTarget?.id],
    enabled: Boolean(membersTarget?.id),
    queryFn: () => membersFn({ data: { companyId: membersTarget!.id } }),
  });

  const refreshMembers = () =>
    queryClient.invalidateQueries({ queryKey: ["company-members", membersTarget?.id] });

  const inviteMutation = useMutation({
    mutationFn: () =>
      inviteFn({
        data: { companyId: membersTarget?.id ?? "", email: inviteEmail.trim(), role: inviteRole },
      }),
    onSuccess: (result) => {
      toast.success(
        result.linked
          ? "Usuário existente vinculado à empresa com o papel escolhido."
          : "Convite registrado: ao criar a conta com este e-mail o acesso é liberado automaticamente.",
      );
      setInviteEmail("");
      void refreshMembers();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const roleMutation = useMutation({
    mutationFn: (vars: { userId: string; role: "ADMIN" | "CONSULTANT" }) =>
      setRoleFn({ data: { userId: vars.userId, companyId: membersTarget?.id ?? "", role: vars.role } }),
    onSuccess: () => {
      toast.success("Papel atualizado.");
      void refreshMembers();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) =>
      removeMemberFn({ data: { userId, companyId: membersTarget?.id ?? "" } }),
    onSuccess: () => {
      toast.success("Vínculo operacional removido.");
      void refreshMembers();
    },
    onError: (error: Error) => toast.error(error.message),
  });




  const platformAdminQuery = useQuery({
    queryKey: ["is-platform-admin"],
    queryFn: async () => {
      const { data } = await supabase.rpc("is_platform_admin");
      return Boolean(data);
    },
  });
  const isPlatformAdmin = platformAdminQuery.data === true;

  const companiesQuery = useQuery({
    queryKey: ["platform-companies"],
    enabled: isPlatformAdmin,
    queryFn: () => fetchCompanies(),
  });

  const instancesQuery = useQuery({
    queryKey: ["platform-instances"],
    enabled: isPlatformAdmin,
    queryFn: () => fetchInstances(),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["platform-companies"] });
    void queryClient.invalidateQueries({ queryKey: ["platform-instances"] });
    void queryClient.invalidateQueries({ queryKey: ["whatsapp-instances"] });
  };

  const createCompanyMutation = useMutation({
    mutationFn: () =>
      createCompanyFn({
        data: {
          name: companyName,
          ...(legalName.trim() ? { legalName: legalName.trim() } : {}),
          ...(document.trim() ? { document: document.trim() } : {}),
        },
      }),
    onSuccess: (result) => {
      toast.success(`Empresa "${result.name}" cadastrada.`);
      setCompanyOpen(false);
      setCompanyName("");
      setLegalName("");
      setDocument("");
      setTargetCompany(result.id);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const provisionMutation = useMutation({
    mutationFn: () =>
      provisionFn({
        data: {
          companyId: targetCompany,
          instanceKey,
          ...(instanceName.trim() ? { name: instanceName.trim() } : {}),
          ...(instanceToken.trim() ? { apiToken: instanceToken.trim() } : {}),
        },
      }),
    onSuccess: () => {
      toast.success("Instância provisionada e disponível para vinculação.");
      setInstanceOpen(false);
      setInstanceKey("");
      setInstanceName("");
      setInstanceToken("");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const tokenMutation = useMutation({
    mutationFn: () =>
      updateCredentialsFn({
        data: { connectionId: tokenTarget?.id ?? "", apiToken: tokenValue.trim() },
      }),
    onSuccess: () => {
      toast.success("Token da MEGA API atualizado para esta instância.");
      setTokenTarget(null);
      setTokenValue("");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });


  if (platformAdminQuery.isLoading) {
    return (
      <AppShell title="Painel do super administrador">
        <Skeleton className="h-40 w-full" />
      </AppShell>
    );
  }

  if (!isPlatformAdmin) {
    return (
      <AppShell title="Painel do super administrador">
        <Card className="shadow-panel">
          <CardHeader>
            <CardTitle className="text-base">Acesso restrito</CardTitle>
            <CardDescription>
              Somente o administrador da plataforma pode cadastrar empresas e provisionar instâncias.
            </CardDescription>
          </CardHeader>
        </Card>
      </AppShell>
    );
  }

  const companies = companiesQuery.data ?? [];
  const instances = instancesQuery.data ?? [];

  return (
    <AppShell
      title="Painel do super administrador"
      description="Cadastro de empresas contratantes e provisionamento das instâncias de WhatsApp adquiridas na MEGA API."
      actions={
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setCompanyOpen(true)}>
            <Building2 className="mr-1.5 size-3.5" /> Nova empresa
          </Button>
          <Button size="sm" onClick={() => setInstanceOpen(true)}>
            <Plus className="mr-1.5 size-3.5" /> Provisionar instância
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        <Card className="shadow-panel">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Empresas contratantes</CardTitle>
            <CardDescription>
              A empresa pode ser cadastrada antes do primeiro acesso: as instâncias ficam reservadas e
              o administrador dela apenas vincula os colaboradores.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {companiesQuery.isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : companies.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma empresa cadastrada ainda.</p>
            ) : (
              companies.map((company) => (
                <div
                  key={company.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium">{company.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {company.legalName ?? "sem razão social"}
                      {company.document ? ` · ${company.document}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{company.instanceCount} instâncias</Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setTargetCompany(company.id);
                        setInstanceOpen(true);
                      }}
                    >
                      Provisionar
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="shadow-panel">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Instâncias provisionadas</CardTitle>
            <CardDescription>
              Todas as instâncias usam a MESMA URL central de webhook — a MEGA API envia a
              instance_key no payload e o sistema identifica a conexão. Use "Configurar" para
              aplicar a URL automaticamente na instância.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {instancesQuery.isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : instances.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma instância provisionada.</p>
            ) : (
              instances.map((instance) => (
                <div key={instance.id} className="space-y-2 rounded-lg border border-border px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{instance.name ?? "Instância"}</p>
                      <p className="text-xs text-muted-foreground">
                        {instance.companyName} ·{" "}
                        {instance.assignedUserName ?? "sem colaborador vinculado"} ·{" "}
                        {instance.phoneNumber
                          ? PhoneNormalizationService.format(instance.phoneNumber)
                          : "sem número"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={instance.hasCredentials ? "secondary" : "destructive"}>
                        {WHATSAPP_INSTANCE_STATUS_LABEL[instance.status] ?? instance.status}
                      </Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          try {
                            const result = await webhookFn({});
                            setWebhook({ id: instance.id, url: result.url });
                            await navigator.clipboard
                              .writeText(result.url)
                              .catch(() => undefined);
                            toast.success("URL central do webhook copiada.");
                          } catch (error) {
                            toast.error(
                              error instanceof Error ? error.message : "Falha ao obter a URL.",
                            );
                          }
                        }}
                      >
                        Webhook
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          try {
                            const result = await configureWebhookFn({
                              data: { connectionId: instance.id },
                            });
                            setWebhook({ id: instance.id, url: result.current ?? result.url });
                            toast.success("Webhook configurado na MEGA API.");
                          } catch (error) {
                            toast.error(
                              error instanceof Error ? error.message : "Falha ao configurar.",
                            );
                          }
                        }}
                      >
                        Configurar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setTokenTarget({ id: instance.id, name: instance.name ?? "Instância" });
                          setTokenValue("");
                        }}
                      >
                        Token
                      </Button>
                    </div>

                  </div>
                  {webhook?.id === instance.id ? (
                    <p className="break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">
                      {webhook.url}
                    </p>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="shadow-panel">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4" /> Eventos a habilitar na MEGA API
            </CardTitle>
            <CardDescription>
              Marque exatamente estes eventos no painel da MEGA API para cada instância.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-1.5 text-sm sm:grid-cols-2">
            <p>✅ Mensagens Recebidas</p>
            <p>✅ Mensagens Enviadas</p>
            <p>✅ Mensagens Atualizadas</p>
            <p>✅ Status mensagens enviadas</p>
            <p>✅ Mensagens receipt</p>
            <p>✅ QR Code</p>
            <p className="text-muted-foreground">❌ Mensagem grupo recebida</p>
            <p className="text-muted-foreground">❌ Mensagem grupo atualizada</p>
            <p className="text-muted-foreground">❌ Atualização participantes</p>
            <p className="text-muted-foreground">❌ Atualização de contatos</p>
            <p className="text-muted-foreground">❌ Reações (opcional — não é tratado hoje)</p>
          </CardContent>
        </Card>
      </div>

      <Dialog open={companyOpen} onOpenChange={setCompanyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cadastrar empresa</DialogTitle>
            <DialogDescription>
              A empresa é criada já com fila e horário comercial padrão.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                placeholder="APSP"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Razão social (opcional)</Label>
              <Input value={legalName} onChange={(event) => setLegalName(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>CNPJ (opcional)</Label>
              <Input value={document} onChange={(event) => setDocument(event.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={!companyName.trim() || createCompanyMutation.isPending}
              onClick={() => createCompanyMutation.mutate()}
            >
              {createCompanyMutation.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : null}
              Cadastrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={instanceOpen} onOpenChange={setInstanceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Provisionar instância contratada</DialogTitle>
            <DialogDescription>
              A instance_key fica guardada apenas no backend e nunca é exibida no painel da empresa.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Empresa</Label>
              <Select value={targetCompany} onValueChange={setTargetCompany}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a empresa" />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((company) => (
                    <SelectItem key={company.id} value={company.id}>
                      {company.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Nome da instância</Label>
              <Input
                value={instanceName}
                onChange={(event) => setInstanceName(event.target.value)}
                placeholder="Deixe em branco para numerar automaticamente (ex.: APSP — Instância 1)"
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
            <div className="space-y-1.5">
              <Label>Token da MEGA API (opcional)</Label>
              <Input
                value={instanceToken}
                onChange={(event) => setInstanceToken(event.target.value)}
                autoComplete="off"
                type="password"
                placeholder="Bearer token da instância — em branco usa o token padrão da plataforma"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={!targetCompany || !instanceKey.trim() || provisionMutation.isPending}
              onClick={() => provisionMutation.mutate()}
            >
              {provisionMutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Provisionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={tokenTarget !== null}
        onOpenChange={(open) => {
          if (!open) setTokenTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Token da MEGA API</DialogTitle>
            <DialogDescription>
              Guarde aqui o Bearer token de {tokenTarget?.name ?? "instância"}. Ele fica somente no
              backend e nunca é exibido novamente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Token</Label>
            <Input
              value={tokenValue}
              onChange={(event) => setTokenValue(event.target.value)}
              autoComplete="off"
              type="password"
              placeholder="token da instância na MEGA API"
            />
          </div>
          <DialogFooter>
            <Button
              disabled={!tokenValue.trim() || tokenMutation.isPending}
              onClick={() => tokenMutation.mutate()}
            >
              {tokenMutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Salvar token
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>

  );
}
