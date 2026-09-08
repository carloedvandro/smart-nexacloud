import { useState } from "react";
import { Bell, BellOff, Loader2, Smartphone } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { usePushNotifications } from "@/hooks/use-push-notifications";

export function PushNotificationsCard() {
  const push = usePushNotifications();
  const [working, setWorking] = useState(false);

  const handleEnable = async () => {
    setWorking(true);
    try {
      await push.enable();
      toast.success("Avisos ativados neste aparelho.");
      const result = await push.test();
      if (!result?.sent) {
        toast.warning("Ativado, mas o aviso de teste não foi entregue. Tente novamente em instantes.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível ativar os avisos.");
    } finally {
      setWorking(false);
    }
  };

  const handleDisable = async () => {
    setWorking(true);
    try {
      await push.disable();
      toast.success("Avisos desativados neste aparelho.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível desativar.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-4 w-4" /> Avisos no celular
          </CardTitle>
          {push.enabled ? (
            <Badge variant="secondary">Ativado neste aparelho</Badge>
          ) : (
            <Badge variant="outline">Desativado</Badge>
          )}
        </div>
        <CardDescription>
          Receba aviso com som e vibração quando o cliente mandar mensagem, quando um lead cair na
          sua fila ou quando ninguém assumir um atendimento — mesmo com a tela bloqueada.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!push.supported ? (
          <p className="text-sm text-muted-foreground">
            Este navegador não permite avisos. Use o Chrome no Android ou o Safari no iPhone
            (iOS 16.4 ou mais novo).
          </p>
        ) : null}

        {push.needsInstall ? (
          <div className="rounded-lg border border-dashed p-4 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <Smartphone className="h-4 w-4" /> No iPhone, adicione o NexaAtende à tela de início
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>Abra este site no Safari.</li>
              <li>Toque no botão Compartilhar (quadrado com seta para cima).</li>
              <li>Escolha “Adicionar à Tela de Início” e confirme.</li>
              <li>Abra o NexaAtende pelo ícone criado e volte aqui para ativar os avisos.</li>
            </ol>
            <p className="mt-2 text-muted-foreground">
              O iPhone só entrega avisos quando o sistema é aberto pelo ícone.
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {push.enabled ? (
            <>
              <Button variant="outline" onClick={handleDisable} disabled={working}>
                {working ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BellOff className="mr-2 h-4 w-4" />}
                Desativar neste aparelho
              </Button>
              <Button
                variant="secondary"
                onClick={async () => {
                  const result = await push.test();
                  toast[result?.sent ? "success" : "error"](
                    result?.sent ? "Aviso de teste enviado." : "Nenhum aparelho recebeu o teste.",
                  );
                }}
                disabled={working}
              >
                Enviar aviso de teste
              </Button>
            </>
          ) : (
            <Button onClick={handleEnable} disabled={working || !push.supported || push.needsInstall}>
              {working ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bell className="mr-2 h-4 w-4" />}
              Ativar avisos neste aparelho
            </Button>
          )}
        </div>

        {push.permission === "denied" ? (
          <p className="text-sm text-destructive">
            As notificações estão bloqueadas nas configurações do navegador para este site. Libere a
            permissão e tente novamente.
          </p>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Ative em cada aparelho que você usa (celular e computador).
        </p>
      </CardContent>
    </Card>
  );
}
