import type { ReactNode } from "react";
import { ShieldAlert } from "lucide-react";

import { AppShell } from "@/components/nexa/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";

/**
 * Restringe páginas administrativas: consultores só acessam as áreas
 * operacionais (conversas e leads atribuídos a eles).
 */
export function AdminOnly({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const { isAdmin, roles, loading } = useAuth();
  const allowed = isAdmin || roles.includes("PLATFORM_ADMIN");

  if (loading) return null;
  if (allowed) return <>{children}</>;

  return (
    <AppShell title={title} description={description ?? ""}>
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <ShieldAlert className="size-8 text-muted-foreground" />
          <p className="text-base font-medium">Área restrita a administradores</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Você tem acesso apenas às conversas e aos leads transferidos para o seu atendimento.
          </p>
        </CardContent>
      </Card>
    </AppShell>
  );
}
