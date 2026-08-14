import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import type { AppRole, Availability } from "@/lib/nexa/domain";

export type NexaProfile = {
  id: string;
  company_id: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  availability: Availability;
  is_active: boolean;
};

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  profile: NexaProfile | null;
  roles: AppRole[];
  isAdmin: boolean;
  companyId: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<NexaProfile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadContext(userId: string | undefined) {
    if (!userId) {
      setProfile(null);
      setRoles([]);
      return;
    }
    let [{ data: profileRow }, { data: roleRows }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, company_id, full_name, email, phone, avatar_url, availability, is_active")
        .eq("id", userId)
        .maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);

    // Sem empresa: tenta aceitar um convite pendente para este e-mail.
    if (profileRow && !(profileRow as NexaProfile).company_id) {
      const { data: claimed } = await supabase.rpc("claim_company_invite");
      if (claimed) {
        const [{ data: freshProfile }, { data: freshRoles }] = await Promise.all([
          supabase
            .from("profiles")
            .select("id, company_id, full_name, email, phone, avatar_url, availability, is_active")
            .eq("id", userId)
            .maybeSingle(),
          supabase.from("user_roles").select("role").eq("user_id", userId),
        ]);
        profileRow = freshProfile;
        roleRows = freshRoles;
      }
    }

    setProfile((profileRow as NexaProfile | null) ?? null);
    setRoles(((roleRows ?? []) as { role: AppRole }[]).map((r) => r.role));

  }

  useEffect(() => {
    let active = true;

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      // Nunca chamar o backend dentro do callback: agendar fora do ciclo.
      setTimeout(() => {
        void loadContext(nextSession?.user?.id).finally(() => active && setLoading(false));
      }, 0);
    });

    void supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      await loadContext(data.session?.user?.id);
      if (active) setLoading(false);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      roles,
      isAdmin: roles.includes("ADMIN"),
      companyId: profile?.company_id ?? null,
      loading,
      refresh: () => loadContext(session?.user?.id),
      signOut: async () => {
        await supabase.auth.signOut();
        setProfile(null);
        setRoles([]);
      },
    }),
    [session, profile, roles, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
}
