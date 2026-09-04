"use client";

import { Card, SectionHeading, cx } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import type { AnnualSummary } from "@/lib/types";

/** The yearly record: every year you have entries for, side by side.
 *
 * Nothing here is archived. Each line is recomputed from the ledger, so
 * correcting an entry from three years ago moves that year's figures with it —
 * which is the point of having full CRUD on the ledger in the first place.
 */
export function YearlyRecord({
  rows,
  selectedYear,
  onSelectYear,
}: {
  rows: AnnualSummary[];
  selectedYear: number;
  onSelectYear: (year: number) => void;
}) {
  if (rows.length === 0) return null;

  const currency = rows[0].base_currency;
  const money = (value: number) => formatMoney(value, currency, { whole: true });

  return (
    <Card>
      <SectionHeading
        title="Yearly record"
        hint="Recalculated from the ledger — edit an old entry and its year moves with it"
      />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left">
              {["Year", "Income", "Expenses", "Giving", "Saved", "Net", "Giving %"].map(
                (heading, i) => (
                  <th
                    key={heading}
                    className={cx(
                      "px-3 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-navy-300",
                      i > 0 && "text-right",
                    )}
                  >
                    {heading}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const active = row.year === selectedYear;
              return (
                <tr
                  key={row.year}
                  onClick={() => onSelectYear(row.year)}
                  className={cx(
                    "cursor-pointer border-b border-white/5 transition-colors",
                    active ? "bg-gold-500/[0.07]" : "hover:bg-white/[0.03]",
                  )}
                >
                  <td className="px-3 py-2.5">
                    <span
                      className={cx(
                        "tabular-nums",
                        active ? "font-semibold text-gold-200" : "text-navy-50",
                      )}
                    >
                      {row.year}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-emerald-300">
                    {money(row.income)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-navy-100">
                    {money(row.expenses)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gold-300">
                    {money(row.giving)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-sky-300">
                    {money(row.saved)}
                  </td>
                  <td
                    className={cx(
                      "px-3 py-2.5 text-right tabular-nums",
                      row.net >= 0 ? "text-navy-50" : "text-red-300",
                    )}
                  >
                    {formatMoney(row.net, currency, { whole: true, signed: true })}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-navy-300">
                    {row.giving_rate != null ? `${row.giving_rate.toFixed(1)}%` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] text-navy-300">
        Net excludes transfers between your own accounts. Click a year to load it above.
      </p>
    </Card>
  );
}
