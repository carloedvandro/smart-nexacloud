import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { NexaLogo } from "@/components/nexa/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/convite/$token")({
  head: () => ({
    meta: [
      { title: "Convite de acesso — NexaAtende" },
      {
        name: "description",
        content:
          "Aceite o convite da sua empresa e crie seu acesso de consultor no NexaAtende com CPF.",
      },
      { property: "og:title", content: "Convite de acesso — NexaAtende" },
      { property: "og:description", content: "Convite único para entrar na equipe da empresa." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  ssr: false,
  component: InvitePage,
});

type InviteInfo = {
  valid: boolean;
  reason?: string;
  company_name?: string;
  role?: string;
  email?: string | null;
  expires_at?: string;
};

function InvitePage() {
  const { token } = useParams({ from: "/convite/$token" });
  const navigate = useNavigate();
  const { session, loading, refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [document, setDocument] = useState("");

  const infoQuery = useQuery({
    queryKey: ["invite-info", token],
    queryFn: async (): Promise<InviteInfo> => {
      const { data, error } = await supabase.rpc("invite_link_info", { _token: token });
      if (error) throw error;
      return (data ?? { valid: false }) as InviteInfo;
    },
  });

  const info = infoQuery.data;

  async function redeem() {
    const { error } = await supabase.rpc("redeem_invite_link", {
      _token: token,
      _document: document.replace(/\D/g, ""),
    });
    if (error) {
      toast.error(error.message);
      return false;
    }
    await refresh();
    toast.success("Convite aceito. Bem-vindo à equipe!");
    void navigate({ to: "/minha-conexao", replace: true });
    return true;
  }

  async function handleSignUp(event: React.FormEvent) {
    event.preventDefault();
    if (document.replace(/\D/g, "").length !== 11) {
      toast.error("Informe um CPF válido (11 dígitos).");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/convite/${token}`,
        data: { full_name: fullName },
      },
    });
    if (error) {
      setBusy(false);
      toast.error(error.message);
      return;
    }
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      setBusy(false);
      toast.success("Conta criada. Confirme seu e-mail e abra este link novamente para concluir.");
      return;
    }
    await redeem();
    setBusy(false);
  }

  async function handleAccept() {
    if (document.replace(/\D/g, "").length !== 11) {
      toast.error("Informe um CPF válido (11 dígitos).");
      return;
    }
    setBusy(true);
    await redeem();
    setBusy(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <NexaLogo className="mb-8" />
        <Card className="shadow-panel">
          {infoQuery.isLoading || loading ? (
            <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Validando convite...
            </CardContent>
          ) : !info?.valid ? (
            <>
              <CardHeader>
                <CardTitle>Convite indisponível</CardTitle>
                <CardDescription>
                  {info?.reason === "USED"
                    ? "Este convite já foi utilizado por outra pessoa. Cada link vale para um único cadastro."
                    : info?.reason === "EXPIRED"
                      ? "Este convite expirou. Peça ao gestor da sua empresa um novo link."
                      : "Não encontramos este convite. Confira o link com o gestor da sua empresa."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" className="w-full" onClick={() => navigate({ to: "/" })}>
                  Voltar para o início
                </Button>
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader>
                <CardTitle>Convite de {info.company_name}</CardTitle>
                <CardDescription>
                  Você foi convidado como {info.role === "ADMIN" ? "administrador" : "consultor"}.
                  Este link é pessoal, vale para um único cadastro e expira automaticamente.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {session ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="cpf">CPF</Label>
                      <Input
                        id="cpf"
                        inputMode="numeric"
                        placeholder="000.000.000-00"
                        value={document}
                        onChange={(e) => setDocument(e.target.value)}
                      />
                    </div>
                    <Button className="w-full" disabled={busy} onClick={handleAccept}>
                      {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                      Entrar na equipe
                    </Button>
                  </>
                ) : (
                  <form className="space-y-4" onSubmit={handleSignUp}>
                    <div className="space-y-2">
                      <Label htmlFor="name">Nome completo</Label>
                      <Input
                        id="name"
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cpf">CPF</Label>
                      <Input
                        id="cpf"
                        required
                        inputMode="numeric"
                        placeholder="000.000.000-00"
                        value={document}
                        onChange={(e) => setDocument(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email">E-mail</Label>
                      <Input
                        id="email"
                        type="email"
                        required
                        autoComplete="email"
                        value={email || (info.email ?? "")}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="password">Senha</Label>
                      <Input
                        id="password"
                        type="password"
                        minLength={8}
                        required
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </div>
                    <Button type="submit" className="w-full" disabled={busy}>
                      {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                      Criar acesso e entrar na equipe
                    </Button>
                    <p className="text-center text-xs text-muted-foreground">
                      Já tem conta? Entre primeiro e abra este link novamente.
                    </p>
                  </form>
                )}
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
