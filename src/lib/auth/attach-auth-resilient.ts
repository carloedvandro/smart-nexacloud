import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";

/**
 * Fallback bearer attacher: right after a hard reload the Supabase session can
 * still be hydrating from storage, so `getSession()` briefly returns null and
 * server functions are called without an Authorization header (401).
 * This middleware retries briefly and refreshes the session before giving up.
 */
export const attachSupabaseAuthResilient = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    if (typeof window === "undefined") return next();

    let token: string | undefined;
    for (let attempt = 0; attempt < 3 && !token; attempt += 1) {
      const { data } = await supabase.auth.getSession();
      token = data.session?.access_token;
      if (token) break;
      if (attempt === 1) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        token = refreshed.session?.access_token;
        if (token) break;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    return next(token ? { headers: { Authorization: `Bearer ${token}` } } : {});
  },
);
