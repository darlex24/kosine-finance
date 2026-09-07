"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useCatalog } from "@/components/CatalogProvider";
import { Button, Card, Field, SectionHeading, Toast, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import type { Profile } from "@/lib/types";

const ROLES: Profile["ministry_role"][] = ["minister", "pastor", "leader", "member"];

export default function SettingsPage() {
  const { profile, currencies, refresh, ready } = useCatalog();
  const { signOut } = useAuth();
  const router = useRouter();
  const toast = useToast();

  const [draft, setDraft] = useState<Partial<Profile>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) setDraft(profile);
  }, [profile]);

  const set = (patch: Partial<Profile>) => setDraft((d) => ({ ...d, ...patch }));

  async function save() {
    setSaving(true);
    try {
      await api.updateMe({
        full_name: draft.full_name ?? null,
        home_church: draft.home_church ?? null,
        ministry_role: draft.ministry_role,
        country_code: draft.country_code,
        base_currency: draft.base_currency,
      });
      await refresh();
      toast.show("Profile saved");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Could not save your profile");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-navy-300">
          Your profile, and how figures across the app are denominated.
        </p>
      </header>

      <Card>
        <SectionHeading title="Profile" hint={profile?.email ?? ""} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name">
            <input
              className="input"
              value={draft.full_name ?? ""}
              onChange={(e) => set({ full_name: e.target.value })}
            />
          </Field>
          <Field label="Home church">
            <input
              className="input"
              value={draft.home_church ?? ""}
              onChange={(e) => set({ home_church: e.target.value })}
            />
          </Field>
          <Field label="Role">
            <select
              className="input"
              value={draft.ministry_role ?? "member"}
              onChange={(e) =>
                set({ ministry_role: e.target.value as Profile["ministry_role"] })
              }
            >
              {ROLES.map((r) => (
                <option key={r} value={r} className="capitalize">
                  {r}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Country"
            hint="Two-letter code. Controls which region's tax module appears."
          >
            <input
              className="input uppercase"
              maxLength={2}
              value={draft.country_code ?? ""}
              onChange={(e) => set({ country_code: e.target.value.toUpperCase() })}
            />
          </Field>
          <Field
            label="Base currency"
            hint="Every figure in the app is converted into this, at each entry's own date."
          >
            <select
              className="input"
              value={draft.base_currency ?? "CAD"}
              onChange={(e) => set({ base_currency: e.target.value })}
            >
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="mt-5">
          <Button variant="gold" onClick={() => void save()} disabled={saving || !ready}>
            {saving ? "Saving…" : "Save profile"}
          </Button>
        </div>
      </Card>

      <DangerZone
        email={profile?.email ?? ""}
        onDeleted={async () => {
          toast.show("Account deleted");
          await signOut();
          router.replace("/sign-in");
        }}
      />

      <Toast message={toast.message} action={toast.action} onDismiss={toast.dismiss} />
    </div>
  );
}

/** Deleting an account is irreversible and cascades everything.
 *
 * Deliberately awkward: it is visually separated, it names exactly what goes,
 * and it will not enable until the account's own email has been typed back. The
 * server checks that again against the token, so this is a speed bump for the
 * user rather than the actual guard.
 */
function DangerZone({ email, onDeleted }: { email: string; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = typed.trim().toLowerCase() === email.trim().toLowerCase() && !!email;

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount(typed.trim());
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the account");
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-red-400/25 bg-red-500/[0.04] p-5">
      <h2 className="text-lg font-semibold tracking-tight text-red-200">Danger zone</h2>
      <p className="mt-1 text-sm text-navy-300">
        Deleting your account is permanent. There is no undo and no grace period.
      </p>

      {!open ? (
        <Button variant="danger" className="mt-4" onClick={() => setOpen(true)}>
          Delete my account
        </Button>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="rounded-xl border border-red-400/20 bg-navy-950/50 p-4 text-sm">
            <p className="text-navy-100">This will permanently remove:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-navy-300">
              <li>Every ledger entry, and the receipt images attached to them</li>
              <li>All giving records, including tax-receiptable history</li>
              <li>Assets, liabilities and every net-worth snapshot</li>
              <li>Budgets, and any categories, platforms or giving arms you created</li>
              <li>Your sign-in — you will not be able to log back in</li>
            </ul>
            <p className="mt-3 text-xs text-gold-300">
              If you may need this for tax, export or screenshot what you need first.
              Nothing is recoverable afterwards.
            </p>
          </div>

          <Field label={`Type ${email} to confirm`}>
            <input
              className="input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={email}
              autoComplete="off"
              aria-label="Confirm your email address"
            />
          </Field>

          {error && <p className="text-xs text-red-300">{error}</p>}

          <div className="flex items-center gap-3">
            <Button
              variant="danger"
              disabled={!matches || busy}
              onClick={() => void remove()}
            >
              {busy ? "Deleting…" : "Permanently delete"}
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                setOpen(false);
                setTyped("");
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
