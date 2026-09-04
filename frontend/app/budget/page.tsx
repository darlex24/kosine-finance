"use client";

import { useState } from "react";

import { cad } from "@/lib/givingArms";

/**
 * Kingdom-first budgeting: giving is allocated off the top, and living and
 * savings share what remains.
 */
export default function BudgetPage() {
  const [income, setIncome] = useState(6000);
  const [givingPct, setGivingPct] = useState(15);
  const [savingsPct, setSavingsPct] = useState(20);

  const giving = (income * givingPct) / 100;
  const savings = (income * savingsPct) / 100;
  const living = Math.max(income - giving - savings, 0);
  const tithe = income * 0.1;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Monthly <span className="gold-text">allocation</span>
        </h1>
        <p className="mt-1 text-sm text-navy-300">Giving first, then savings, then living.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card space-y-5">
          <label className="block">
            <span className="label">Monthly income (CAD)</span>
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
              Below the tithe — 10% of this income is {cad(tithe)}.
            </p>
          )}
        </div>

        <div className="card space-y-4">
          <Row label="Kingdom giving" value={giving} accent />
          <Row label="Savings & registered accounts" value={savings} />
          <Row label="Living" value={living} />
          <div className="h-3 overflow-hidden rounded-full bg-navy-950">
            <div className="flex h-full">
              <span style={{ width: `${givingPct}%` }} className="bg-gold-500" />
              <span style={{ width: `${savingsPct}%` }} className="bg-navy-500" />
              <span className="flex-1 bg-navy-700" />
            </div>
          </div>
          <p className="text-xs text-navy-300">
            Annualised giving: {cad(giving * 12)} — of which the tithe portion alone is{" "}
            {cad(tithe * 12)}.
          </p>
        </div>
      </div>
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

function Row({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-sm text-navy-100">{label}</span>
      <span
        className={`text-xl font-semibold tabular-nums ${accent ? "gold-text" : "text-white"}`}
      >
        {cad(value)}
      </span>
    </div>
  );
}
