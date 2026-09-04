"use client";

import { createBrowserClient } from "@supabase/ssr";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// These are inlined at build time, so a missing or placeholder value means the
// dev server was started before .env.local was filled in — fail loudly here
// rather than hanging on a request that can never succeed.
if (!url || !anonKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
      "Set them in frontend/.env.local and restart `npm run dev`.",
  );
}
if (url.includes("placeholder")) {
  throw new Error(
    `NEXT_PUBLIC_SUPABASE_URL is still the placeholder (${url}). ` +
      "Put your real project URL in frontend/.env.local and restart `npm run dev`.",
  );
}

export const supabase = createBrowserClient(url, anonKey);

export async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
