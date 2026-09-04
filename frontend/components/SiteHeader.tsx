"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { useAuth } from "./AuthProvider";
import { useCatalog } from "./CatalogProvider";
import { cx } from "./ui";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/ledger", label: "Ledger" },
  { href: "/assets", label: "Assets" },
  { href: "/giving", label: "Giving" },
  { href: "/budget", label: "Budget" },
];

export function SiteHeader() {
  const { session, signOut } = useAuth();
  const pathname = usePathname();

  return (
    <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
      <Link href={session ? "/" : "/sign-in"} className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-gold-sheen text-base font-bold text-navy-950">
          K
        </span>
        <span className="text-sm font-semibold tracking-[0.2em] text-navy-100">KOSINE</span>
      </Link>

      {session && (
        <div className="flex items-center gap-3">
          <nav className="flex items-center gap-1 rounded-full border border-white/5 bg-navy-900/60 p-1 text-sm">
            {NAV.map((item) => {
              const active =
                item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "rounded-full px-4 py-1.5 transition",
                    active
                      ? "bg-gold-500/15 text-gold-200"
                      : "text-navy-100 hover:bg-white/5 hover:text-gold-300",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <BaseCurrencyPicker />

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

/** Switching this re-denominates every figure in the app — net worth, cash flow
 *  and the ledger's base column all read `users.base_currency`. */
function BaseCurrencyPicker() {
  const { currencies, baseCurrency, setBaseCurrency, ready } = useCatalog();
  const [busy, setBusy] = useState(false);

  if (!ready || currencies.length === 0) return null;

  return (
    <select
      aria-label="Base currency"
      value={baseCurrency}
      disabled={busy}
      onChange={async (e) => {
        setBusy(true);
        try {
          await setBaseCurrency(e.target.value);
        } finally {
          setBusy(false);
        }
      }}
      className="rounded-full border border-white/5 bg-navy-900/60 px-3 py-1.5 text-xs text-navy-100 outline-none focus:border-gold-500/40"
    >
      {currencies.map((c) => (
        <option key={c.code} value={c.code}>
          {c.code}
        </option>
      ))}
    </select>
  );
}
