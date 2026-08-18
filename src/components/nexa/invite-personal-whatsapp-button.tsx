import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Smartphone } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { inviteLeadToPersonalWhatsApp } from "@/lib/whatsapp/whatsapp.functions";
import { PhoneNormalizationService } from "@/lib/nexa/phone";

/**
 * Envia ao lead, pelo número da empresa, um convite com o WhatsApp pessoal do
 * consultor e abre o chat direto para ele. A ação fica registrada para a empresa.
 */
export function InvitePersonalWhatsAppButton({
  conversationId,
  onSent,
}: {
  conversationId: string;
  onSent?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const invite = useServerFn(inviteLeadToPersonalWhatsApp);

  const send = useMutation({
    mutationFn: () => invite({ data: { conversationId } }),
    onSuccess: (result) => {
      setOpen(false);
      onSent?.();
      toast.success("Convite enviado ao lead", {
        description: `Seu número ${PhoneNormalizationService.format(result.consultantPhone)} foi compartilhado.`,
        duration: 12_000,
        ...(result.waMeUrl
          ? {
              action: {
                label: "Abrir no WhatsApp",
                onClick: () => window.open(result.waMeUrl!, "_blank", "noopener"),
              },
            }
          : {}),
      });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Smartphone className="size-4" /> Convidar para meu WhatsApp
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Convidar o lead para o seu WhatsApp?</AlertDialogTitle>
          <AlertDialogDescription>
            O lead vai receber, pelo número da empresa, uma mensagem com o seu WhatsApp pessoal e um
            link para falar com você. O convite fica registrado na conversa e no histórico da
            empresa.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={send.isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              send.mutate();
            }}
            disabled={send.isPending}
          >
            {send.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Enviar convite
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
