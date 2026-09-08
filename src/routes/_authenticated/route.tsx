import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { session, loading, profile, profileLoaded, roles } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isPlatformAdmin = roles.includes("PLATFORM_ADMIN");

  useEffect(() => {
    if (!loading && !session) void navigate({ to: "/auth", replace: true });
  }, [loading, session, navigate]);

  const statusQuery = useQuery({
    queryKey: ["my-company-status"],
    enabled: Boolean(session) && profileLoaded && Boolean(profile?.company_id) && !isPlatformAdmin,
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await supabase.rpc("my_company_status");
      return (data as string | null) ?? null;
    },
  });

  const blocked =
    !isPlatformAdmin &&
    Boolean(statusQuery.data) &&
    statusQuery.data !== "ACTIVE" &&
    pathname !== "/aguardando-aprovacao";

  useEffect(() => {
    if (blocked) void navigate({ to: "/aguardando-aprovacao", replace: true });
  }, [blocked, navigate]);

  if (loading || !session || blocked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="size-8 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  return <Outlet />;
}
