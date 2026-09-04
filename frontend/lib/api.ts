"use client";

import { accessToken } from "./supabase";
import type {
  Account,
  AnnualSummary,
  Asset,
  Budget,
  CashFlowPoint,
  Category,
  CategorySpend,
  Currency,
  LedgerDraft,
  LedgerFilters,
  LedgerPage,
  LedgerRow,
  Liability,
  NetWorth,
  Platform,
  Profile,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${res.status} ${detail}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

function qs(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export type GivingSummary = {
  tax_year: number;
  total_given: number;
  receiptable_total: number;
  non_receiptable_total: number;
  by_arm: Record<string, number>;
  by_realm: Record<string, number>;
  estimated_federal_credit: number;
  outstanding_pledges: number;
};

export type OcrResult = {
  document_type: string;
  merchant: string | null;
  charity_registration_number: string | null;
  date: string | null;
  total: number | null;
  currency: string;
  line_items: { description: string; amount: number; suggested_giving_arm: string | null }[];
  suggested_category: string | null;
  suggested_category_slug: string | null;
  suggested_giving_arm: string | null;
  tax_deductible_flag: boolean;
  confidence: number;
  notes: string | null;
};

export const api = {
  // ------------------------------------------------------------- profile
  me: () => request<Profile>("/api/me"),
  updateMe: (body: Partial<Profile>) =>
    request<Profile>("/api/me", { method: "PATCH", body: JSON.stringify(body) }),

  // ------------------------------------------------------------- catalog
  currencies: () => request<Currency[]>("/api/currencies"),
  categories: () => request<Category[]>("/api/categories"),
  createCategory: (body: { name: string; group: string; parent_id?: string | null }) =>
    request<Category>("/api/categories", { method: "POST", body: JSON.stringify(body) }),
  platforms: () => request<Platform[]>("/api/platforms"),
  createPlatform: (body: { name: string; kind: string; country_code?: string | null }) =>
    request<Platform>("/api/platforms", { method: "POST", body: JSON.stringify(body) }),
  refreshFx: () => request<{ base: string; rate_date: string; pairs: number }>(
    "/api/fx/refresh",
    { method: "POST" },
  ),

  // -------------------------------------------------------------- ledger
  ledger: (filters: LedgerFilters & { cursor?: string; limit?: number } = {}) =>
    request<LedgerPage>(`/api/ledger${qs(filters)}`),
  createLedgerRow: (body: LedgerDraft) =>
    request<LedgerRow>("/api/ledger", { method: "POST", body: JSON.stringify(body) }),
  createLedgerRows: (body: LedgerDraft[]) =>
    request<LedgerRow[]>("/api/ledger/bulk", { method: "POST", body: JSON.stringify(body) }),
  updateLedgerRow: (id: string, body: Partial<LedgerDraft>) =>
    request<LedgerRow>(`/api/ledger/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteLedgerRow: (id: string) =>
    request<void>(`/api/ledger/${id}`, { method: "DELETE" }),
  deleteLedgerRows: (ids: string[]) =>
    request<void>("/api/ledger/bulk-delete", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),

  // --------------------------------------------------- assets & net worth
  assets: () => request<Asset[]>("/api/assets"),
  createAsset: (body: Partial<Asset>) =>
    request<Asset>("/api/assets", { method: "POST", body: JSON.stringify(body) }),
  updateAsset: (id: string, body: Partial<Asset>) =>
    request<Asset>(`/api/assets/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteAsset: (id: string) => request<void>(`/api/assets/${id}`, { method: "DELETE" }),

  liabilities: () => request<Liability[]>("/api/liabilities"),
  createLiability: (body: Partial<Liability>) =>
    request<Liability>("/api/liabilities", { method: "POST", body: JSON.stringify(body) }),
  updateLiability: (id: string, body: Partial<Liability>) =>
    request<Liability>(`/api/liabilities/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteLiability: (id: string) =>
    request<void>(`/api/liabilities/${id}`, { method: "DELETE" }),

  netWorth: () => request<NetWorth>("/api/networth"),
  snapshotNetWorth: () =>
    request<{ captured_on: string; net_worth: number }>("/api/networth/snapshot", {
      method: "POST",
    }),
  cashFlow: (year?: number) => request<CashFlowPoint[]>(`/api/cashflow${qs({ year })}`),
  years: () => request<number[]>("/api/years"),
  annualSummary: () => request<AnnualSummary[]>("/api/annual-summary"),
  categorySpend: (year?: number) =>
    request<CategorySpend[]>(`/api/spend-by-category${qs({ year })}`),

  // ------------------------------------------------------- accounts, giving
  accounts: () => request<Account[]>("/api/accounts"),

  budgets: (year?: number) => request<Budget[]>(`/api/budgets${qs({ year })}`),
  saveBudget: (body: Omit<Budget, "id">) =>
    request<Budget>("/api/budgets", { method: "PUT", body: JSON.stringify(body) }),

  givingSummary: (year?: number) =>
    request<GivingSummary>(`/api/giving/summary${qs({ tax_year: year })}`),
  arms: () => request<unknown[]>("/api/giving/arms"),
  recordGiving: (body: Record<string, unknown>) =>
    request<unknown>("/api/giving", { method: "POST", body: JSON.stringify(body) }),

  limits: (year?: number) => request<Record<string, number>>(`/api/canada/limits${qs({ tax_year: year })}`),

  // ----------------------------------------------------------------- OCR
  scan: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<OcrResult>("/api/ocr/scan", { method: "POST", body: form });
  },

  /** Store the image and write the reviewed extraction straight into the ledger. */
  commitScan: (row: LedgerDraft, file?: File) => {
    const form = new FormData();
    form.append("row", JSON.stringify(row));
    if (file) form.append("file", file);
    return request<LedgerRow>("/api/ocr/commit", { method: "POST", body: form });
  },
};
