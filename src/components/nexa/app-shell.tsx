import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { LogOut, Menu, Moon, Sun, X } from "lucide-react";
import { toast } from "sonner";

import { NexaLogo } from "@/components/nexa/logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { supabase } from "@/integrations/supabase/client";
import { AVAILABILITY_LABEL } from "@/lib/nexa/domain";
import { NAV_ITEMS } from "@/lib/nexa/navigation";
import { cn } from "@/lib/utils";

export function AppShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { profile, isAdmin, roles, loading, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const isPlatformAdminGuard = roles.includes("PLATFORM_ADMIN");

  useEffect(() => {
    if (loading || !profile || profile.company_id) return;
    // Administrador da plataforma não precisa de vínculo operacional com empresa.
    if (isPlatformAdminGuard) {
      if (pathname !== "/plataforma") void navigate({ to: "/plataforma", replace: true });
      return;
    }
    void navigate({ to: "/onboarding", replace: true });
  }, [loading, profile, navigate, isPlatformAdminGuard, pathname]);


  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel(`queue-offers-${profile.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "assignment_attempts" },
        (payload) => {
          const offer = payload.new as { consultant_id?: string };
          if (offer.consultant_id === profile.id) {
            toast.info("Novo atendimento disponível", {
              description: "Você tem 60 segundos para abrir a conversa e responder.",
            });
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [profile?.id]);

  const isPlatformAdmin = roles.includes("PLATFORM_ADMIN");
  const items = NAV_ITEMS.filter((item) =>
    item.roles.includes("PLATFORM_ADMIN") && item.roles.length === 1
      ? isPlatformAdmin
      : isAdmin
        ? true
        : item.roles.includes("CONSULTANT"),
  );

  async function handleSignOut() {
    await signOut();
    void navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-sidebar text-sidebar-foreground transition-transform lg:static lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-4">
          <NexaLogo inverted />
          <button
            className="text-sidebar-foreground/70 lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Fechar menu"
          >
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {items.map((item) => {
            const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )}
              >
                <item.icon className={cn("size-4", active && "text-sidebar-primary")} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <div className="rounded-lg bg-sidebar-accent/50 p-3">
            {loading ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <>
                <p className="truncate text-sm font-medium">{profile?.full_name ?? profile?.email}</p>
                <p className="text-xs text-sidebar-foreground/60">
                  {isAdmin ? "Administrador" : "Consultor"} ·{" "}
                  {AVAILABILITY_LABEL[profile?.availability ?? "OFFLINE"]}
                </p>
              </>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full justify-start text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={handleSignOut}
          >
            <LogOut className="size-4" /> Sair
          </Button>
        </div>
      </aside>

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-30 bg-foreground/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-card/85 px-4 backdrop-blur lg:px-8">
          <button className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Abrir menu">
            <Menu className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold tracking-tight">{title}</h1>
            {description ? (
              <p className="truncate text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {actions}
            <Badge variant="secondary" className="hidden sm:inline-flex">
              Tempo real ativo
            </Badge>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
