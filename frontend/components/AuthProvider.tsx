"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";

type AuthState = {
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  session: null,
  loading: true,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

const PUBLIC_ROUTES = ["/sign-in", "/sign-up"];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Always resolve the loading state, even when Supabase is unreachable or
    // misconfigured — otherwise the whole app sits on the loading screen with
    // no way to reach sign-in.
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) setAuthError(error.message);
        setSession(data.session);
      })
      .catch((err: unknown) => {
        setAuthError(err instanceof Error ? err.message : "Cannot reach Supabase");
        setSession(null);
      })
      .finally(() => setLoading(false));

    // Keeps the access token fresh; the API layer reads it on every request.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const isPublic = PUBLIC_ROUTES.includes(pathname);

  useEffect(() => {
    if (loading) return;
    if (!session && !isPublic) router.replace("/sign-in");
    if (session && isPublic) router.replace("/");
  }, [session, loading, isPublic, router]);

  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace("/sign-in");
  };

  if (loading) {
    return (
      <div className="grid min-h-[60vh] place-items-center text-sm text-navy-300">
        Loading…
      </div>
    );
  }

  if (authError && !session) {
    return (
      <div className="mx-auto mt-12 max-w-md card space-y-3 text-center">
        <p className="label">Cannot reach Supabase</p>
        <p className="text-sm text-navy-300">{authError}</p>
        <p className="text-xs text-navy-300">
          Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in
          frontend/.env.local, then restart the dev server.
        </p>
      </div>
    );
  }

  // Hold the protected tree back until the redirect above lands.
  if (!session && !isPublic) {
    return (
      <div className="grid min-h-[60vh] place-items-center text-sm text-navy-300">
        Redirecting to sign-in…
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ session, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
