import type { ReactNode } from "react";
import { CircleDashed } from "lucide-react";

import { AppShell } from "@/components/nexa/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Página de módulo já roteado e protegido, cuja implementação funcional
 * entra na fase indicada do plano de entrega.
 */
export function ModulePage({
  title,
  description,
  phase,
  scope,
  children,
}: {
  title: string;
  description: string;
  phase: string;
  scope: string[];
  children?: ReactNode;
}) {
  return (
    <AppShell title={title} description={description}>
      <div className="space-y-6">
        {children}
        <Card className="shadow-panel">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-3">
              <CardTitle className="text-base">Escopo deste módulo</CardTitle>
              <Badge variant="secondary">{phase}</Badge>
            </div>
            <CardDescription>
              Rota, permissões e isolamento por empresa já ativos. As funcionalidades abaixo serão
              implementadas nesta fase, sempre com as regras críticas no backend.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 sm:grid-cols-2">
              {scope.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <CircleDashed className="mt-0.5 size-4 shrink-0 text-primary" />
                  {item}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
