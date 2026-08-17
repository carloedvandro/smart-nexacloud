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
import { purgeCompanyConversations } from "@/lib/nexa/maintenance.functions";

export function PurgeConversationsButton() {
  const [open, setOpen] = useState(false);
  const [alsoLeads, setAlsoLeads] = useState(false);
  const queryClient = useQueryClient();
  const purge = useServerFn(purgeCompanyConversations);

  const mutation = useMutation({
    mutationFn: () => purge({ data: { alsoDeleteLeads: alsoLeads } }),
    onSuccess: (result) => {
      toast.success(
        `${result.conversationsDeleted} conversa(s) apagada(s)${
          result.leadsDeleted ? ` e ${result.leadsDeleted} lead(s)` : ""
        }.`,
      );
      setOpen(false);
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

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={alsoLeads} onCheckedChange={(v) => setAlsoLeads(v === true)} />
            Apagar também os leads e suas anotações
          </label>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={mutation.isPending}
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
