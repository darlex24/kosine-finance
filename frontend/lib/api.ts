"use client";

import { accessToken } from "./supabase";

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
  line_items: { description: string; amount: number; suggested_giving_arm: string | null }[];
  suggested_category: string | null;
  suggested_giving_arm: string | null;
  tax_deductible_flag: boolean;
  confidence: number;
  notes: string | null;
};

export const api = {
  givingSummary: (year?: number) =>
    request<GivingSummary>(`/api/giving/summary${year ? `?tax_year=${year}` : ""}`),

  arms: () => request<any[]>("/api/giving/arms"),

  recordGiving: (body: Record<string, unknown>) =>
    request<any>("/api/giving", { method: "POST", body: JSON.stringify(body) }),

  accounts: () => request<any[]>("/api/accounts"),

  transactions: (limit = 25) => request<any[]>(`/api/transactions?limit=${limit}`),

  limits: (year?: number) =>
    request<any>(`/api/canada/limits${year ? `?tax_year=${year}` : ""}`),

  scan: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<OcrResult>("/api/ocr/scan", { method: "POST", body: form });
  },
};
