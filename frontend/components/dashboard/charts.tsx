"use client";

import { useMemo } from "react";

import { cx } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import type { CashFlowPoint, LedgerEntryType, NetWorthPoint } from "@/lib/types";

/** Inline SVG charts. No charting dependency: two shapes, drawn once, that
 *  inherit the brand palette and stay legible at tile size. */

const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

// Distinguishable at a glance, and giving gets the gold it deserves.
const BAND_COLOR: Record<LedgerEntryType, string> = {
  income: "#34d399",
  expense: "#8fa3c8",
  giving: "#c9a227",
  savings: "#38bdf8",
  investment: "#a78bfa",
  transfer: "#2c4372",
};

const BAND_ORDER: LedgerEntryType[] = [
  "expense",
  "giving",
  "savings",
  "investment",
  "transfer",
];

export function Sparkline({
  points,
  className,
}: {
  points: NetWorthPoint[];
  className?: string;
}) {
  const path = useMemo(() => {
    if (points.length < 2) return null;
    const values = points.map((p) => Number(p.net_worth));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const step = 100 / (values.length - 1);
    return values
      .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(2)},${(28 - ((v - min) / span) * 26).toFixed(2)}`)
      .join(" ");
  }, [points]);

  if (!path) return null;
  const rising =
    Number(points[points.length - 1].net_worth) >= Number(points[0].net_worth);

  return (
    <svg
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      role="img"
      aria-label="Net worth trend"
      className={cx("h-8 w-full", className)}
    >
      <path
        d={path}
        fill="none"
        stroke={rising ? "#c9a227" : "#8fa3c8"}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function CashFlowChart({
  points,
  currency,
}: {
  points: CashFlowPoint[];
  currency: string;
}) {
  const { months, max } = useMemo(() => {
    const byMonth = new Map<number, Partial<Record<LedgerEntryType, number>>>();
    for (const point of points) {
      const bucket = byMonth.get(point.month) ?? {};
      bucket[point.entry_type] = (bucket[point.entry_type] ?? 0) + Number(point.total);
      byMonth.set(point.month, bucket);
    }
    const rows = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      bands: byMonth.get(i + 1) ?? {},
    }));
    const peak = Math.max(
      1,
      ...rows.map((r) =>
        Math.max(
          r.bands.income ?? 0,
          BAND_ORDER.reduce((sum, key) => sum + (r.bands[key] ?? 0), 0),
        ),
      ),
    );
    return { months: rows, max: peak };
  }, [points]);

  const hasData = points.length > 0;

  return (
    <div>
      <div className="flex h-40 items-end gap-1.5" role="img" aria-label="Monthly cash flow">
        {months.map((row) => {
          const outflow = BAND_ORDER.reduce((sum, key) => sum + (row.bands[key] ?? 0), 0);
          const income = row.bands.income ?? 0;
          return (
            <div key={row.month} className="flex h-full flex-1 items-end gap-0.5">
              {/* Income to the left, the stacked outflow bands to the right. */}
              <div className="flex h-full flex-1 items-end">
                <div
                  className="w-full rounded-t bg-emerald-400/70"
                  style={{ height: `${(income / max) * 100}%` }}
                  title={`${MONTHS[row.month - 1]} income ${formatMoney(income, currency, { whole: true })}`}
                />
              </div>
              <div className="flex h-full flex-1 flex-col justify-end">
                {BAND_ORDER.map((key) => {
                  const value = row.bands[key] ?? 0;
                  if (!value) return null;
                  return (
                    <div
                      key={key}
                      style={{
                        height: `${(value / max) * 100}%`,
                        backgroundColor: BAND_COLOR[key],
                      }}
                      title={`${MONTHS[row.month - 1]} ${key} ${formatMoney(value, currency, { whole: true })}`}
                      className="w-full first:rounded-t"
                    />
                  );
                })}
                {outflow === 0 && <div className="h-px w-full bg-white/5" />}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex justify-between text-[10px] text-navy-300">
        {MONTHS.map((label, i) => (
          <span key={i} className="flex-1 text-center">
            {label}
          </span>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-3 text-[11px] text-navy-300">
        <Legend color="#34d399" label="Income" />
        {BAND_ORDER.map((key) => (
          <Legend key={key} color={BAND_COLOR[key]} label={key} />
        ))}
      </div>

      {!hasData && (
        <p className="mt-3 text-xs text-navy-300">
          Nothing logged for this year yet — the ledger fills this in as you go.
        </p>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 capitalize">
      <span
        aria-hidden
        className="h-2 w-2 rounded-sm"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}
