"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import type { Account, Category, Currency, Platform, Profile } from "@/lib/types";

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
  ready: boolean;
  error: string | null;
  categoryById: Map<string, Category>;
  refresh: () => Promise<void>;
  setBaseCurrency: (code: string) => Promise<void>;
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
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const [me, cats, plats, curr, accs] = await Promise.all([
        api.me(),
        api.categories(),
        api.platforms(),
        api.currencies(),
        api.accounts(),
      ]);
      setProfile(me);
      setCategories(cats);
      setPlatforms(plats);
      setCurrencies(curr);
      setAccounts(accs);
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

  const setBaseCurrency = useCallback(async (code: string) => {
    const updated = await api.updateMe({ base_currency: code });
    setProfile(updated);
  }, []);

  const value = useMemo<CatalogState>(
    () => ({
      profile,
      baseCurrency: profile?.base_currency ?? "CAD",
      categories,
      platforms,
      currencies,
      accounts,
      ready,
      error,
      categoryById: new Map(categories.map((c) => [c.id, c])),
      refresh,
      setBaseCurrency,
    }),
    [profile, categories, platforms, currencies, accounts, ready, error, refresh, setBaseCurrency],
  );

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}
