"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import type { Account, ArmRule, Category, Currency, Platform, Profile } from "@/lib/types";

import { useAuth } from "./AuthProvider";

/** Reference data every screen needs, fetched once per session.
 *
 * Categories, platforms and currencies are seeded server-side and change rarely;
 * holding them here keeps the ledger grid's comboboxes instant.
 */
type CatalogState = {
  profile: Profile | null;
  baseCurrency: string;
  categories: Category[];
  platforms: Platform[];
  currencies: Currency[];
  accounts: Account[];
  /** Seeded giving arms plus the user's own. Fetched, not hardcoded — a church
   *  outside Loveworld defines its own and they must appear in every picker. */
  arms: ArmRule[];
  ready: boolean;
  error: string | null;
  categoryById: Map<string, Category>;
  refresh: () => Promise<void>;
  setBaseCurrency: (code: string) => Promise<void>;
  /** Bumped by every write anywhere in the app, and on window focus. Screens
   *  showing derived figures depend on it, so the dashboard reflects an edit
   *  made on the ledger without needing a manual reload. */
  dataVersion: number;
  invalidate: () => void;
};

const CatalogContext = createContext<CatalogState | null>(null);

export function useCatalog(): CatalogState {
  const value = useContext(CatalogContext);
  if (!value) throw new Error("useCatalog must be used inside <CatalogProvider>");
  return value;
}

export function CatalogProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [arms, setArms] = useState<ArmRule[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState(0);

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const [me, cats, plats, curr, accs, armList] = await Promise.all([
        api.me(),
        api.categories(),
        api.platforms(),
        api.currencies(),
        api.accounts(),
        api.arms(),
      ]);
      setProfile(me);
      setCategories(cats);
      setPlatforms(plats);
      setCurrencies(curr);
      setAccounts(accs);
      setArms(armList);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load reference data");
    } finally {
      setReady(true);
    }
  }, [session]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const invalidate = useCallback(() => setDataVersion((v) => v + 1), []);

  // Coming back to the tab should not show figures from an hour ago.
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === "visible") invalidate();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [invalidate]);

  const setBaseCurrency = useCallback(
    async (code: string) => {
      const updated = await api.updateMe({ base_currency: code });
      setProfile(updated);
      // Every figure in the app is denominated in this — re-read them all.
      invalidate();
    },
    [invalidate],
  );

  const value = useMemo<CatalogState>(
    () => ({
      profile,
      baseCurrency: profile?.base_currency ?? "CAD",
      categories,
      platforms,
      currencies,
      accounts,
      arms,
      ready,
      error,
      categoryById: new Map(categories.map((c) => [c.id, c])),
      refresh,
      setBaseCurrency,
      dataVersion,
      invalidate,
    }),
    [
      profile,
      categories,
      platforms,
      currencies,
      accounts,
      arms,
      ready,
      error,
      refresh,
      setBaseCurrency,
      dataVersion,
      invalidate,
    ],
  );

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}
