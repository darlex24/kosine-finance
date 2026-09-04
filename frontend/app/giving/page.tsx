"use client";

import { useCallback, useEffect, useState } from "react";

import { GivingForm } from "@/components/GivingForm";
import { api, type GivingSummary } from "@/lib/api";
import { GIVING_ARMS, REALM_LABELS, REALM_ORDER, cad } from "@/lib/givingArms";

export default function GivingPage() {
  const [summary, setSummary] = useState<GivingSummary | null>(null);

  const load = useCallback(() => {
    api.givingSummary().then(setSummary).catch(() => setSummary(null));
  }, []);

  useEffect(load, [load]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Giving &amp; <span className="gold-text">Partnership Engine</span>
        </h1>
        <p className="mt-1 text-sm text-navy-300">
          Every realm and arm of giving, with its Canadian tax treatment attached.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <GivingForm onSaved={load} />

        <aside className="space-y-4">
          <div className="card-gold">
            <p className="label">Year to date</p>
            <p className="figure mt-2 gold-text">{cad(summary?.total_given ?? 0)}</p>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-navy-300">Receiptable</dt>
                <dd className="tabular-nums">{cad(summary?.receiptable_total ?? 0)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-navy-300">Personal / alms</dt>
                <dd className="tabular-nums">{cad(summary?.non_receiptable_total ?? 0)}</dd>
              </div>
              <div className="flex justify-between border-t border-white/10 pt-2">
                <dt className="text-navy-300">Est. federal credit</dt>
                <dd className="tabular-nums text-gold-300">
                  {cad(summary?.estimated_federal_credit ?? 0)}
                </dd>
              </div>
            </dl>
          </div>

          {REALM_ORDER.map((realm) => (
            <div key={realm} className="card">
              <p className="label">{REALM_LABELS[realm]}</p>
              <ul className="mt-3 space-y-2 text-sm">
                {GIVING_ARMS.filter((a) => a.realm === realm).map((a) => (
                  <li key={a.arm} className="flex items-center justify-between gap-3">
                    <span className="text-navy-100">{a.display_name}</span>
                    <span className="tabular-nums text-navy-300">
                      {cad(summary?.by_arm?.[a.arm] ?? 0)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
