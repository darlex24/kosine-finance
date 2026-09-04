"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { supabase } from "@/lib/supabase";

/** Email + password sign-in / sign-up against Supabase Auth. */
export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const isSignUp = mode === "sign-up";
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [ministryRole, setMinistryRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);

    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          // handle_new_user() copies full_name into public.users on insert.
          options: { data: { full_name: fullName, ministry_role: ministryRole } },
        });
        if (error) throw error;
        if (!data.session) {
          setNotice("Check your inbox to confirm your email, then sign in.");
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="mx-auto w-full max-w-sm"
    >
      <div className="mb-8 text-center">
        <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-gold-sheen text-lg font-bold text-navy-950">
          K
        </span>
        <h1 className="text-xl font-semibold tracking-tight">
          {isSignUp ? "Begin your stewardship" : "Welcome back"}
        </h1>
        <p className="mt-1 text-sm text-navy-300">
          {isSignUp
            ? "Track every realm of giving, and what CRA will receipt."
            : "Sign in to Kosine Finance."}
        </p>
      </div>

      <form onSubmit={submit} className="card space-y-4">
        {isSignUp && (
          <>
            <label className="block">
              <span className="label">Full name</span>
              <input
                className="input mt-1.5"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
                required
              />
            </label>
            <label className="block">
              <span className="label">Ministry role</span>
              <select
                className="input mt-1.5"
                value={ministryRole}
                onChange={(e) => setMinistryRole(e.target.value)}
              >
                <option value="member">Member</option>
                <option value="leader">Leader</option>
                <option value="pastor">Pastor</option>
                <option value="minister">Minister</option>
              </select>
            </label>
          </>
        )}

        <label className="block">
          <span className="label">Email</span>
          <input
            className="input mt-1.5"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>

        <label className="block">
          <span className="label">Password</span>
          <input
            className="input mt-1.5"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSignUp ? "new-password" : "current-password"}
            minLength={8}
            required
          />
          {isSignUp && (
            <span className="mt-1.5 block text-xs text-navy-300">
              At least 8 characters.
            </span>
          )}
        </label>

        {error && <p className="text-xs text-red-300">{error}</p>}
        {notice && <p className="text-xs text-gold-300">{notice}</p>}

        <button className="btn-gold w-full" disabled={busy}>
          {busy ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-navy-300">
        {isSignUp ? "Already have an account? " : "New to Kosine? "}
        <Link
          href={isSignUp ? "/sign-in" : "/sign-up"}
          className="text-gold-300 hover:underline"
        >
          {isSignUp ? "Sign in" : "Create one"}
        </Link>
      </p>
    </motion.div>
  );
}
