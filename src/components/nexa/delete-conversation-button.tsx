import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import { PasswordInput } from "@/components/nexa/password-input";
import { deleteConversationAsAdmin } from "@/lib/nexa/conversation-delete.functions";
import { cn } from "@/lib/utils";

export function DeleteConversationButton({
  conversationId,
  leadName,
  onDeleted,
  className,
}: {
  conversationId: string;
  leadName?: string | null;
  onDeleted?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const deleteFn = useServerFn(deleteConversationAsAdmin);

  const queryClient = useQueryClient();

  const remove = useMutation({
    mutationFn: async () => deleteFn({ data: { conversationId, name, password, reason } }),
    onSuccess: (result) => {
      setOpen(false);
      setName("");
      setPassword("");
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      void queryClient.invalidateQueries({ queryKey: ["kanban"] });
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      toast.success(
        result?.leadDeleted
          ? "Conversa e lead excluídos e registrados no log do sistema"
          : "Conversa excluída e registrada no log do sistema",
      );
      onDeleted?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });


  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Excluir conversa"
        title="Excluir conversa (somente administrador)"
        className={cn("size-8 shrink-0 text-muted-foreground hover:text-destructive", className)}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Trash2 className="size-4" />
      </Button>

      <Dialog open={open} onOpenChange={(v) => (remove.isPending ? null : setOpen(v))}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-destructive" /> Excluir conversa
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-left">
                <p>
                  Você vai excluir definitivamente a conversa
                  {leadName ? ` de ${leadName}` : ""}, incluindo todas as mensagens. Esta ação não pode
                  ser desfeita.
                </p>
                <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                  Esta ação ficará registrada no log do sistema, mostrando <strong>quando</strong> a
                  conversa foi excluída e <strong>por quem</strong>. O log fica em Configurações ›
                  Senha de administrador.
                </p>
                <p className="text-xs">
                  Para confirmar, informe o seu <strong>nome de administrador</strong> e a sua{" "}
                  <strong>senha pessoal de exclusão</strong>.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="admin_delete_name">Nome do administrador</Label>
              <Input
                id="admin_delete_name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Como você cadastrou em Configurações"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin_delete_password">Senha de administrador</Label>
              <PasswordInput
                id="admin_delete_password"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin_delete_reason">Motivo (opcional)</Label>
              <Input
                id="admin_delete_reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex.: conversa duplicada"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={remove.isPending}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => remove.mutate()}
              disabled={remove.isPending || !name.trim() || !password}
            >
              {remove.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Confirmar exclusão
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
