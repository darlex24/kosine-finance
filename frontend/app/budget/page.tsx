"use client";

import { useEffect, useState } from "react";

import { useCatalog } from "@/components/CatalogProvider";
import { Button, Toast, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/money";

const now = new Date();
const YEAR = now.getFullYear();
const MONTH = now.getMonth() + 1;

/**
 * Kingdom-first budgeting: giving is allocated off the top, and living and
 * savings share what remains. The allocation is persisted to `monthly_budgets`
 * so the ledger can be reconciled against what was planned.
 */
export default function BudgetPage() {
  const { baseCurrency, ready, invalidate } = useCatalog();
  const [income, setIncome] = useState(6000);
  const [givingPct, setGivingPct] = useState(15);
  const [savingsPct, setSavingsPct] = useState(20);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const giving = (income * givingPct) / 100;
  const savings = (income * savingsPct) / 100;
  const living = Math.max(income - giving - savings, 0);
  const tithe = income * 0.1;

  const money = (value: number) => formatMoney(value, baseCurrency, { whole: true });

  // Seed the sliders from whatever was saved for this month.
  useEffect(() => {
    if (!ready) return;
    api
      .budgets(YEAR)
      .then((budgets) => {
        const saved = budgets.find((b) => b.month === MONTH);
        if (!saved || !saved.total_income) return;
        setIncome(Number(saved.total_income));
        setGivingPct(
          Math.round((Number(saved.allocated_giving) / Number(saved.total_income)) * 100),
        );
        setSavingsPct(
          Math.round((Number(saved.allocated_savings) / Number(saved.total_income)) * 100),
        );
      })
      .catch(() => {
        /* An unsaved month is the normal case, not an error worth showing. */
      });
  }, [ready]);

  async function save() {
    setBusy(true);
    try {
      await api.saveBudget({
        year: YEAR,
        month: MONTH,
        total_income: income,
        allocated_giving: giving,
        allocated_living: living,
        allocated_savings: savings,
        notes: null,
      });
      invalidate();
      toast.show("Allocation saved for this month");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Could not save the allocation");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Monthly <span className="gold-text">allocation</span>
          </h1>
          <p className="mt-1 text-sm text-navy-300">
            Giving first, then savings, then living.
          </p>
        </div>
        <Button variant="gold" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : "Save allocation"}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card space-y-5">
          <label className="block">
            <span className="label">Monthly income ({baseCurrency})</span>
            <input
              className="input mt-1.5"
              inputMode="decimal"
              value={income}
              onChange={(e) => setIncome(Number(e.target.value) || 0)}
            />
          </label>

          <Slider label="Giving" value={givingPct} onChange={setGivingPct} max={50} />
          <Slider label="Savings" value={savingsPct} onChange={setSavingsPct} max={60} />

          {givingPct < 10 && (
            <p className="text-xs text-gold-300">
              Below the tithe — 10% of this income is {money(tithe)}.
            </p>
          )}
        </div>

        <div className="card space-y-4">
          <Row label="Kingdom giving" value={money(giving)} accent />
          <Row label="Savings & investments" value={money(savings)} />
          <Row label="Living" value={money(living)} />
          <div className="h-3 overflow-hidden rounded-full bg-navy-950">
            <div className="flex h-full">
              <span style={{ width: `${givingPct}%` }} className="bg-gold-500" />
              <span style={{ width: `${savingsPct}%` }} className="bg-navy-500" />
              <span className="flex-1 bg-navy-700" />
            </div>
          </div>
          <p className="text-xs text-navy-300">
            Annualised giving: {money(giving * 12)} — of which the tithe portion alone is{" "}
            {money(tithe * 12)}.
          </p>
        </div>
      </div>

      <Toast message={toast.message} action={toast.action} onDismiss={toast.dismiss} />
    </div>
  );
}

function Slider({
  label,
  value,
  onChange,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  max: number;
}) {
  return (
    <label className="block">
      <span className="label">
        {label} — {value}%
      </span>
      <input
        type="range"
        min={0}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-gold-500"
      />
    </label>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-sm text-navy-100">{label}</span>
      <span
        className={`text-xl font-semibold tabular-nums ${accent ? "gold-text" : "text-white"}`}
      >
        {value}
      </span>
    </div>
  );
}
