"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useCatalog } from "@/components/CatalogProvider";
import { Button, Card, Field, SectionHeading, Toast, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { formatMoney, parseAmount } from "@/lib/money";
import type { Asset, AssetClass, Liability, LiabilityKind } from "@/lib/types";

const ASSET_CLASSES: { value: AssetClass; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "equity", label: "Equities" },
  { value: "fund", label: "Funds & ETFs" },
  { value: "crypto", label: "Crypto" },
  { value: "bond", label: "Bonds" },
  { value: "real_estate", label: "Real estate" },
  { value: "business", label: "Business" },
  { value: "retirement", label: "Retirement" },
  { value: "insurance", label: "Insurance" },
  { value: "collectible", label: "Collectibles" },
  { value: "other", label: "Other" },
];

const LIABILITY_KINDS: { value: LiabilityKind; label: string }[] = [
  { value: "mortgage", label: "Mortgage" },
  { value: "credit_card", label: "Credit card" },
  { value: "student_loan", label: "Student loan" },
  { value: "personal_loan", label: "Personal loan" },
  { value: "auto_loan", label: "Auto loan" },
  { value: "business_loan", label: "Business loan" },
  { value: "tax_owing", label: "Tax owing" },
  { value: "other", label: "Other" },
];

export default function AssetsPage() {
  // Assets and liabilities ARE net worth, so every write here has to reach the
  // dashboard.
  const { platforms, currencies, baseCurrency, ready, invalidate, dataVersion } =
    useCatalog();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [liabilities, setLiabilities] = useState<Liability[]>([]);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const [a, l] = await Promise.all([api.assets(), api.liabilities()]);
      setAssets(a);
      setLiabilities(l);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your holdings");
    }
  }, []);

  useEffect(() => {
    if (ready) void load();
    // dataVersion so a base-currency switch or a focus return re-reads.
  }, [ready, load, dataVersion]);

  const grouped = useMemo(() => {
    const map = new Map<AssetClass, Asset[]>();
    for (const asset of assets) {
      map.set(asset.asset_class, [...(map.get(asset.asset_class) ?? []), asset]);
    }
    return map;
  }, [assets]);

  const platformName = (id: string | null) =>
    platforms.find((p) => p.id === id)?.name ?? null;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Assets &amp; liabilities</h1>
        <p className="mt-1 text-sm text-navy-300">
          What you hold, wherever you hold it. Each line converts into {baseCurrency} at
          its own as-of date to build your net worth.
        </p>
      </header>

      {error && <Card className="border-red-400/20 text-sm text-red-300">{error}</Card>}

      <section className="space-y-4">
        <SectionHeading
          title="Assets"
          hint={`${assets.length} holding${assets.length === 1 ? "" : "s"}`}
        />

        <AssetForm
          onCreated={(asset) => {
            setAssets((current) => [...current, asset]);
            invalidate();
            toast.show(`${asset.name} added`);
          }}
        />

        <div className="space-y-6">
          {[...grouped.entries()].map(([assetClass, items]) => (
            <div key={assetClass}>
              <p className="label mb-2">
                {ASSET_CLASSES.find((c) => c.value === assetClass)?.label ?? assetClass}
              </p>
              <Card className="divide-y divide-white/5 p-0">
                {items.map((asset) => (
                  <HoldingRow
                    key={asset.id}
                    name={asset.name}
                    detail={[platformName(asset.platform_id), `as of ${asset.as_of}`]
                      .filter(Boolean)
                      .join(" · ")}
                    value={formatMoney(asset.current_value, asset.currency)}
                    onChangeValue={async (next) => {
                      const saved = await api.updateAsset(asset.id, { current_value: next });
                      setAssets((current) =>
                        current.map((a) => (a.id === asset.id ? saved : a)),
                      );
                      invalidate();
                    }}
                    onDelete={async () => {
                      await api.deleteAsset(asset.id);
                      setAssets((current) => current.filter((a) => a.id !== asset.id));
                      invalidate();
                      toast.show(`${asset.name} removed`);
                    }}
                  />
                ))}
              </Card>
            </div>
          ))}
          {assets.length === 0 && (
            <Card className="text-sm text-navy-300">
              No holdings yet. Add a brokerage position, a property, a pension — anything
              you own.
            </Card>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeading
          title="Liabilities"
          hint={`${liabilities.length} obligation${liabilities.length === 1 ? "" : "s"}`}
        />

        <LiabilityForm
          onCreated={(liability) => {
            setLiabilities((current) => [...current, liability]);
            invalidate();
            toast.show(`${liability.name} added`);
          }}
        />

        <Card className="divide-y divide-white/5 p-0">
          {liabilities.map((liability) => (
            <HoldingRow
              key={liability.id}
              name={liability.name}
              detail={`${
                LIABILITY_KINDS.find((k) => k.value === liability.liability_kind)?.label ??
                liability.liability_kind
              } · as of ${liability.as_of}`}
              value={formatMoney(liability.current_balance, liability.currency)}
              onChangeValue={async (next) => {
                const saved = await api.updateLiability(liability.id, {
                  current_balance: next,
                });
                setLiabilities((current) =>
                  current.map((l) => (l.id === liability.id ? saved : l)),
                );
                invalidate();
              }}
              onDelete={async () => {
                await api.deleteLiability(liability.id);
                setLiabilities((current) => current.filter((l) => l.id !== liability.id));
                invalidate();
                toast.show(`${liability.name} removed`);
              }}
            />
          ))}
          {liabilities.length === 0 && (
            <p className="p-5 text-sm text-navy-300">
              Nothing owed on record. Add a mortgage, loan or card balance to complete the
              picture.
            </p>
          )}
        </Card>
      </section>

      <Toast message={toast.message} action={toast.action} onDismiss={toast.dismiss} />

      <p className="text-xs text-navy-300">
        Values are what you enter — this is a stewardship record, not a live market feed.
        Update a holding and your net worth moves with it.
      </p>
    </div>
  );

  // ------------------------------------------------------------ sub-forms

  function AssetForm({ onCreated }: { onCreated: (asset: Asset) => void }) {
    const [name, setName] = useState("");
    const [assetClass, setAssetClass] = useState<AssetClass>("equity");
    const [platformId, setPlatformId] = useState("");
    const [currency, setCurrency] = useState(baseCurrency);
    const [value, setValue] = useState("");
    const [busy, setBusy] = useState(false);

    const parsed = parseAmount(value);

    async function submit() {
      if (!name.trim() || parsed == null) return;
      setBusy(true);
      try {
        onCreated(
          await api.createAsset({
            name: name.trim(),
            asset_class: assetClass,
            platform_id: platformId || null,
            currency,
            current_value: parsed,
          }),
        );
        setName("");
        setValue("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not add that holding");
      } finally {
        setBusy(false);
      }
    }

    return (
      <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-gold-500/20 bg-navy-900/60 p-3">
        <Field label="Name">
          <input
            className="input w-48"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Vanguard S&P 500"
          />
        </Field>
        <Field label="Class">
          <select
            className="input w-40"
            value={assetClass}
            onChange={(e) => setAssetClass(e.target.value as AssetClass)}
          >
            {ASSET_CLASSES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Platform">
          <select
            className="input w-44"
            value={platformId}
            onChange={(e) => setPlatformId(e.target.value)}
          >
            <option value="">None</option>
            {platforms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Currency">
          <select
            className="input w-24"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {currencies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Value">
          <input
            className="input w-32 text-right tabular-nums"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="0.00"
          />
        </Field>
        <Button
          variant="gold"
          disabled={busy || !name.trim() || parsed == null}
          onClick={() => void submit()}
        >
          Add asset
        </Button>
      </div>
    );
  }

  function LiabilityForm({ onCreated }: { onCreated: (liability: Liability) => void }) {
    const [name, setName] = useState("");
    const [kind, setKind] = useState<LiabilityKind>("credit_card");
    const [currency, setCurrency] = useState(baseCurrency);
    const [balance, setBalance] = useState("");
    const [busy, setBusy] = useState(false);

    const parsed = parseAmount(balance);

    async function submit() {
      if (!name.trim() || parsed == null) return;
      setBusy(true);
      try {
        onCreated(
          await api.createLiability({
            name: name.trim(),
            liability_kind: kind,
            currency,
            current_balance: Math.abs(parsed),
          }),
        );
        setName("");
        setBalance("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not add that liability");
      } finally {
        setBusy(false);
      }
    }

    return (
      <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-white/10 bg-navy-900/60 p-3">
        <Field label="Name">
          <input
            className="input w-48"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Home mortgage"
          />
        </Field>
        <Field label="Kind">
          <select
            className="input w-40"
            value={kind}
            onChange={(e) => setKind(e.target.value as LiabilityKind)}
          >
            {LIABILITY_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Currency">
          <select
            className="input w-24"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {currencies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Balance owed">
          <input
            className="input w-32 text-right tabular-nums"
            inputMode="decimal"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            placeholder="0.00"
          />
        </Field>
        <Button
          disabled={busy || !name.trim() || parsed == null}
          onClick={() => void submit()}
        >
          Add liability
        </Button>
      </div>
    );
  }
}

function HoldingRow({
  name,
  detail,
  value,
  onChangeValue,
  onDelete,
}: {
  name: string;
  detail: string;
  value: string;
  onChangeValue: (next: number) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm text-navy-50">{name}</p>
        <p className="truncate text-xs text-navy-300">{detail}</p>
      </div>
      <div className="flex items-center gap-3">
        {editing ? (
          <input
            autoFocus
            className="input w-32 text-right tabular-nums"
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={async () => {
              const parsed = parseAmount(draft);
              setEditing(false);
              if (parsed != null) await onChangeValue(parsed);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <button
            onClick={() => {
              setDraft(value.replace(/[^\d.,-]/g, ""));
              setEditing(true);
            }}
            className="text-sm tabular-nums text-navy-50 hover:text-gold-300"
          >
            {value}
          </button>
        )}
        <button
          onClick={() => void onDelete()}
          className="text-xs text-navy-300 transition hover:text-red-300"
        >
          Remove
        </button>
      </div>
    </div>
  );
}
