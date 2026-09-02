import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Trash2 } from "lucide-react";
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
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/nexa/password-input";
import { purgeCompanyConversations } from "@/lib/nexa/maintenance.functions";

export function PurgeConversationsButton() {
  const [open, setOpen] = useState(false);
  const [alsoLeads, setAlsoLeads] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const queryClient = useQueryClient();
  const purge = useServerFn(purgeCompanyConversations);

  const mutation = useMutation({
    mutationFn: () => purge({ data: { alsoDeleteLeads: alsoLeads, name: name.trim(), password } }),
    onSuccess: (result) => {
      toast.success(
        `${result.conversationsDeleted} conversa(s) apagada(s)${
          result.leadsDeleted ? ` e ${result.leadsDeleted} lead(s)` : ""
        }.`,
      );
      setOpen(false);
      setName("");
      setPassword("");
      void queryClient.invalidateQueries();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <>
      <Button size="sm" variant="outline" className="text-destructive" onClick={() => setOpen(true)}>
        <Trash2 className="mr-1 size-4" />
        Limpar conversas
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Limpar todas as conversas?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação apaga definitivamente todas as conversas, mensagens, mídias registradas e eventos de
              atendimento desta empresa. Não é possível desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="purge_admin_name">Nome do administrador</Label>
              <Input
                id="purge_admin_name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Como você cadastrou em Configurações"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="purge_admin_password">Senha de administrador</Label>
              <PasswordInput
                id="purge_admin_password"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={alsoLeads} onCheckedChange={(v) => setAlsoLeads(v === true)} />
            Apagar também os leads e suas anotações
          </label>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={mutation.isPending || !name.trim() || !password}
              onClick={(e) => {
                e.preventDefault();
                mutation.mutate();
              }}
            >
              {mutation.isPending ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
              Apagar tudo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
