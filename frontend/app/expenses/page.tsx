"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { CategoryTreemap, OutflowDonut, OutflowTrend } from "@/components/charts";
import { useCatalog } from "@/components/CatalogProvider";
import { Button, Card, SectionHeading, Skeleton, StatTile, cx } from "@/components/ui";
import { YearPicker, useYears } from "@/components/YearPicker";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import type { CashFlowPoint, CategorySpend } from "@/lib/types";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type Group = {
  name: string;
  total: number;
  count: number;
  children: { id: string | null; name: string; total: number; count: number }[];
};

/** Where the money actually went.
 *
 * Expenses and giving only — savings and investment are money moving into your
 * own pocket, and folding them in would overstate what you spent.
 */
export default function ExpensesPage() {
  const { baseCurrency, ready, dataVersion } = useCatalog();
  const { years } = useYears();
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState<number | null>(null);
  const [rows, setRows] = useState<CategorySpend[]>([]);
  const [flow, setFlow] = useState<CashFlowPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  // Set by clicking a donut slice; narrows the list beneath it.
  const [focusGroup, setFocusGroup] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    setLoading(true);
    Promise.all([api.categorySpend(year, month ?? undefined), api.cashFlow(year)])
      .then(([data, points]) => {
        setRows(data);
        setFlow(points);
        setError(null);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Could not load your spending"),
      )
      .finally(() => setLoading(false));
  }, [ready, year, month, dataVersion]);

  const { groups, total, givingTotal } = useMemo(() => {
    const byGroup = new Map<string, Group>();
    let sum = 0;
    let giving = 0;

    for (const row of rows) {
      const amount = Number(row.total);
      sum += amount;
      if (row.entry_type === "giving") giving += amount;

      const group = byGroup.get(row.category_group) ?? {
        name: row.category_group,
        total: 0,
        count: 0,
        children: [],
      };
      group.total += amount;
      group.count += row.entry_count;

      // The same category can appear twice (expense and giving rows); merge them.
      const existing = group.children.find((c) => c.name === row.category_name);
      if (existing) {
        existing.total += amount;
        existing.count += row.entry_count;
      } else {
        group.children.push({
          id: row.category_id,
          name: row.category_name,
          total: amount,
          count: row.entry_count,
        });
      }
      byGroup.set(row.category_group, group);
    }

    const sorted = [...byGroup.values()].sort((a, b) => b.total - a.total);
    for (const g of sorted) g.children.sort((a, b) => b.total - a.total);
    return { groups: sorted, total: sum, givingTotal: giving };
  }, [rows]);

  const money = (value: number) => formatMoney(value, baseCurrency, { whole: true });
  const share = (value: number) => (total > 0 ? (value / total) * 100 : 0);
  const periodLabel = month ? `${MONTHS[month - 1]} ${year}` : String(year);

  const toggle = (name: string) => {
    const next = new Set(open);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setOpen(next);
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Where your <span className="gold-text">money goes</span>
          </h1>
          <p className="mt-1 text-sm text-navy-300">
            Every outflow for {periodLabel}, grouped by category. Savings and
            investments are excluded — they are not spending.
          </p>
        </div>
        <YearPicker years={years} value={year} onChange={setYear} />
      </header>

      {error && <Card className="border-red-400/20 text-sm text-red-300">{error}</Card>}

      {/* ------------------------------------------------------ month filter */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setMonth(null)}
          className={cx(
            "rounded-full px-3 py-1 text-xs transition",
            month === null
              ? "bg-gold-500/15 text-gold-200"
              : "text-navy-300 hover:bg-white/5 hover:text-gold-300",
          )}
        >
          Whole year
        </button>
        {MONTHS.map((label, i) => (
          <button
            key={label}
            onClick={() => setMonth(i + 1)}
            className={cx(
              "rounded-full px-3 py-1 text-xs transition",
              month === i + 1
                ? "bg-gold-500/15 text-gold-200"
                : "text-navy-300 hover:bg-white/5 hover:text-gold-300",
            )}
          >
            {label.slice(0, 3)}
          </button>
        ))}
      </div>

      {/* ----------------------------------------------------------- totals */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label={`Total out · ${periodLabel}`}
          value={money(total)}
          accent
          hint={`${rows.reduce((n, r) => n + r.entry_count, 0)} entries`}
        />
        <StatTile
          label="Of which giving"
          value={money(givingTotal)}
          hint={total > 0 ? `${share(givingTotal).toFixed(1)}% of outflow` : "—"}
        />
        <StatTile
          label="Categories used"
          value={String(groups.reduce((n, g) => n + g.children.length, 0))}
          hint={`across ${groups.length} group${groups.length === 1 ? "" : "s"}`}
        />
      </div>

      {/* ---------------------------------------------------------- charts */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionHeading
            title="Split by group"
            hint="Click a slice to filter the breakdown below"
          />
          <OutflowDonut
            rows={rows}
            currency={baseCurrency}
            selectedGroup={focusGroup}
            onSelectGroup={setFocusGroup}
          />
        </Card>

        <Card>
          <SectionHeading title="Across the year" hint={`Monthly outflow by type, ${year} · ${baseCurrency}`} />
          <OutflowTrend points={flow} currency={baseCurrency} />
        </Card>

        <Card className="lg:col-span-2">
          <SectionHeading
            title="Every category, sized by spend"
            hint="The biggest blocks are where the money actually goes"
          />
          <CategoryTreemap rows={rows} currency={baseCurrency} />
        </Card>
      </section>

      {/* ------------------------------------------------------- breakdown */}
      <section>
        <SectionHeading
          title="By category"
          hint="Click a group to open it, or a category to see those entries in the ledger"
        />

        {loading && rows.length === 0 && (
          <div className="space-y-2">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        )}

        {!loading && groups.length === 0 && (
          <Card className="text-sm text-navy-300">
            Nothing spent in {periodLabel}. Log entries in the{" "}
            <Link href="/ledger" className="text-gold-300 hover:underline">
              ledger
            </Link>{" "}
            and they will break down here.
          </Card>
        )}

        <div className="space-y-2">
          {groups
            .filter((g) => !focusGroup || g.name === focusGroup)
            .map((group) => {
            const expanded = open.has(group.name);
            return (
              <div
                key={group.name}
                className="overflow-hidden rounded-2xl border border-white/5 bg-navy-900/60 shadow-card backdrop-blur"
              >
                <button
                  onClick={() => toggle(group.name)}
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition hover:bg-white/[0.03]"
                >
                  <span
                    aria-hidden
                    className={cx(
                      "text-navy-300 transition-transform",
                      expanded && "rotate-90",
                    )}
                  >
                    ›
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm text-navy-50">{group.name}</span>
                      <span className="shrink-0 text-sm tabular-nums text-navy-50">
                        {money(group.total)}
                      </span>
                    </span>
                    <span className="mt-1.5 block h-1.5 rounded-full bg-white/5">
                      <span
                        className="block h-1.5 rounded-full bg-gold-500/70"
                        style={{ width: `${share(group.total)}%` }}
                      />
                    </span>
                    <span className="mt-1 block text-[11px] text-navy-300">
                      {share(group.total).toFixed(1)}% · {group.count}{" "}
                      {group.count === 1 ? "entry" : "entries"} ·{" "}
                      {group.children.length}{" "}
                      {group.children.length === 1 ? "category" : "categories"}
                    </span>
                  </span>
                </button>

                {expanded && (
                  <ul className="border-t border-white/5 bg-navy-950/40 px-5 py-2">
                    {group.children.map((child) => (
                      <li key={child.name}>
                        <Link
                          href={
                            child.id
                              ? `/ledger?category_id=${child.id}&date_from=${year}-${String(month ?? 1).padStart(2, "0")}-01&date_to=${year}-${String(month ?? 12).padStart(2, "0")}-31`
                              : "/ledger"
                          }
                          className="flex items-baseline justify-between gap-3 rounded-lg px-2 py-2 text-sm transition hover:bg-white/5"
                        >
                          <span className="truncate text-navy-100">{child.name}</span>
                          <span className="flex shrink-0 items-baseline gap-3">
                            <span className="text-[11px] text-navy-300">
                              {share(child.total).toFixed(1)}%
                            </span>
                            <span className="tabular-nums text-navy-50">
                              {money(child.total)}
                            </span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {groups.length > 0 && (
        <div className="flex justify-center">
          <Button onClick={() => setOpen(new Set(groups.map((g) => g.name)))}>
            Expand all
          </Button>
        </div>
      )}
    </div>
  );
}
