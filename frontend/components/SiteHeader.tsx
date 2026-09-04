"use client";

import Link from "next/link";

import { useAuth } from "./AuthProvider";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/giving", label: "Giving" },
  { href: "/budget", label: "Budget" },
];

export function SiteHeader() {
  const { session, signOut } = useAuth();

  return (
    <header className="mb-8 flex items-center justify-between gap-4">
      <Link href={session ? "/" : "/sign-in"} className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-gold-sheen text-base font-bold text-navy-950">
          K
        </span>
        <span className="text-sm font-semibold tracking-[0.2em] text-navy-100">KOSINE</span>
      </Link>

      {session && (
        <div className="flex items-center gap-3">
          <nav className="flex items-center gap-1 rounded-full border border-white/5 bg-navy-900/60 p-1 text-sm">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-full px-4 py-1.5 text-navy-100 transition hover:bg-white/5 hover:text-gold-300"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <button
            onClick={signOut}
            className="text-xs text-navy-300 transition hover:text-gold-300"
            title={session.user.email ?? undefined}
          >
            Sign out
          </button>
        </div>
      )}
    </header>
  );
}
