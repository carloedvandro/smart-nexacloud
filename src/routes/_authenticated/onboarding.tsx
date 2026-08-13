import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { NexaLogo } from "@/components/nexa/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({
    meta: [
      { title: "Configurar empresa — NexaAtende" },
      { name: "description", content: "Cadastro inicial da empresa no NexaAtende." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OnboardingPage,
});

function OnboardingPage() {
  const { profile, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [document, setDocument] = useState("");

  useEffect(() => {
    if (!loading && profile?.company_id) void navigate({ to: "/dashboard", replace: true });
  }, [loading, profile, navigate]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const args: { _name: string; _legal_name?: string; _document?: string } = { _name: name };
    if (legalName) args._legal_name = legalName;
    if (document) args._document = document;
    const { error } = await supabase.rpc("bootstrap_company", args);
    if (error) {
      setBusy(false);
      toast.error(error.message);
      return;
    }
    await refresh();
    setBusy(false);
    toast.success("Empresa criada. Você é o administrador.");
    void navigate({ to: "/dashboard", replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-lg">
        <NexaLogo className="mb-8" />
        <Card className="shadow-panel">
          <CardHeader>
            <CardTitle>Configurar sua empresa</CardTitle>
            <CardDescription>
              Este cadastro cria o espaço da empresa, define você como administrador e aplica as
              configurações iniciais de fila (SLA de 60 segundos) e horário de atendimento.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="company">Nome da empresa</Label>
                <Input id="company" required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="legal">Razão social</Label>
                <Input id="legal" value={legalName} onChange={(e) => setLegalName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="doc">CNPJ</Label>
                <Input id="doc" value={document} onChange={(e) => setDocument(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                Criar empresa
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
