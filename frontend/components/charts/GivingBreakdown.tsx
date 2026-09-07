"use client";

import { useMemo, useState } from "react";

import { rampColor } from "@/lib/chartTheme";
import { formatMoney } from "@/lib/money";
import type { GivingByArm } from "@/lib/types";

const money = (v: number, c: string) => formatMoney(v, c, { whole: true });

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-full min-h-[8rem] place-items-center text-center text-sm text-navy-300">
      {children}
    </div>
  );
}

// ------------------------------------------------------------ giving chart

/** Giving by arm.
 *
 * Reads v_giving_by_arm, so a church's own custom arms appear by their display
 * name rather than a raw slug.
 */
export function GivingBreakdown({
  rows,
  currency,
}: {
  rows: GivingByArm[];
  currency: string;
}) {
  const [showTable, setShowTable] = useState(false);

  const { arms, total } = useMemo(() => {
    const byArm = new Map<string, { name: string; realm: string; total: number }>();
    for (const r of rows) {
      const hit = byArm.get(r.giving_arm) ?? {
        name: r.display_name,
        realm: r.realm,
        total: 0,
      };
      hit.total += Number(r.total);
      byArm.set(r.giving_arm, hit);
    }
    const list = [...byArm.values()].sort((a, b) => b.total - a.total);
    return { arms: list, total: list.reduce((s, a) => s + a.total, 0) };
  }, [rows]);

  if (total <= 0) return <EmptyState>No giving recorded for this year.</EmptyState>;

  return (
    <div>
      <ul className="space-y-2.5">
        {arms.slice(0, 10).map((arm, i) => (
          <li key={arm.name}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-navy-100">{arm.name}</span>
              <span className="shrink-0 tabular-nums text-navy-50">
                {money(arm.total, currency)}
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/5">
              <div
                className="h-2 rounded-full"
                style={{
                  width: `${(arm.total / total) * 100}%`,
                  backgroundColor: rampColor(Math.min(i, 5)),
                }}
              />
            </div>
          </li>
        ))}
      </ul>

      {/* A table view is part of the accessibility contract, not an extra. */}
      <button
        onClick={() => setShowTable((v) => !v)}
        className="mt-4 text-xs text-gold-300 hover:underline"
      >
        {showTable ? "Hide" : "Show"} as a table
      </button>

      {showTable && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left">
                <th className="px-2 py-1.5 text-[11px] uppercase tracking-wide text-navy-300">
                  Arm
                </th>
                <th className="px-2 py-1.5 text-[11px] uppercase tracking-wide text-navy-300">
                  Realm
                </th>
                <th className="px-2 py-1.5 text-right text-[11px] uppercase tracking-wide text-navy-300">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {arms.map((arm) => (
                <tr key={arm.name} className="border-b border-white/5">
                  <td className="px-2 py-1.5 text-navy-100">{arm.name}</td>
                  <td className="px-2 py-1.5 text-xs capitalize text-navy-300">
                    {arm.realm.replace(/_/g, " ")}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-navy-50">
                    {money(arm.total, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
