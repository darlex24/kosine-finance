"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useCatalog } from "@/components/CatalogProvider";
import { Button, Card, SectionHeading, Skeleton, StatTile, Toast, cx, useToast } from "@/components/ui";
import { YearPicker, useYears } from "@/components/YearPicker";
import { api } from "@/lib/api";
import { MONTH_LABELS, SERIES } from "@/lib/chartTheme";
import { formatMoney, parseAmount } from "@/lib/money";
import type { BudgetLine, BudgetMonth } from "@/lib/types";

const now = new Date();

/** Envelope budgeting.
 *
 * The old page was three sliders over four fixed buckets, pinned to the current
 * month, with no idea what had actually been spent. This budgets per category
 * and puts the actual next to the plan, because a budget you cannot check
 * against reality is just a wish.
 */
export default function BudgetPage() {
  const { baseCurrency, ready, invalidate, dataVersion } = useCatalog();
  const { years } = useYears();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<BudgetMonth | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const money = (v: number) => formatMoney(v, data?.base_currency ?? baseCurrency, { whole: true });

  const load = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    try {
      const month_ = await api.budgetMonth(year, month);
      setData(month_);
      // Seed the inputs from what is saved, so typing starts from reality.
      setDrafts(
        Object.fromEntries(
          month_.lines
            .filter((l) => l.category_id && Number(l.allocated) > 0)
            .map((l) => [l.category_id as string, String(l.allocated)]),
        ),
      );
      // Open the first group on arrival. Everything collapsed meant the
      // allocation inputs were invisible, and nothing on screen said they
      // existed at all.
      setOpen((current) => {
        if (current.size > 0) return current;
        const first = month_.lines[0]?.category_group;
        return first ? new Set([first]) : current;
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this month");
    } finally {
      setLoading(false);
    }
  }, [ready, year, month, dataVersion]);

  useEffect(() => {
    void load();
  }, [load]);

  // Group the lines so the page reads as sections rather than 100 rows.
  const groups = useMemo(() => {
    const byGroup = new Map<string, BudgetLine[]>();
    for (const line of data?.lines ?? []) {
      byGroup.set(line.category_group, [...(byGroup.get(line.category_group) ?? []), line]);
    }
    return [...byGroup.entries()]
      .map(([name, lines]) => ({
        name,
        lines,
        allocated: lines.reduce((s, l) => s + Number(l.allocated), 0),
        actual: lines.reduce((s, l) => s + Number(l.actual), 0),
      }))
      .sort((a, b) => b.actual - a.actual || a.name.localeCompare(b.name));
  }, [data]);

  // Draft totals, so the headline moves as you type rather than only on save.
  const draftAllocated = useMemo(
    () =>
      Object.values(drafts).reduce((sum, raw) => sum + (parseAmount(raw) ?? 0), 0),
    [drafts],
  );

  async function save() {
    if (!data) return;
    setBusy(true);
    try {
      const allocations = Object.entries(drafts)
        .map(([category_id, raw]) => ({ category_id, allocated: parseAmount(raw) ?? 0 }))
        .filter((a) => a.allocated >= 0);
      const saved = await api.saveAllocations(year, month, allocations);
      setData(saved);
      invalidate();
      toast.show(`Budget saved for ${MONTH_LABELS[month - 1]} ${year}`);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Could not save the budget");
    } finally {
      setBusy(false);
    }
  }

  async function copyForward() {
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    setBusy(true);
    try {
      const saved = await api.copyBudgetForward(
        { year: prevYear, month: prevMonth },
        { year, month },
      );
      setData(saved);
      setDrafts(
        Object.fromEntries(
          saved.lines
            .filter((l) => l.category_id && Number(l.allocated) > 0)
            .map((l) => [l.category_id as string, String(l.allocated)]),
        ),
      );
      toast.show(`Copied ${MONTH_LABELS[prevMonth - 1]}'s envelopes forward`);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Nothing to copy from last month");
    } finally {
      setBusy(false);
    }
  }

  const toggle = (name: string) => {
    const next = new Set(open);
    next.has(name) ? next.delete(name) : next.add(name);
    setOpen(next);
  };

  const unallocated = (data?.total_income ?? 0) - draftAllocated;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Monthly <span className="gold-text">budget</span>
          </h1>
          <p className="mt-1 text-sm text-navy-300">
            Plan per category, then see it against what you actually spent.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <YearPicker years={years} value={year} onChange={setYear} />
          <Button onClick={() => void copyForward()} disabled={busy}>
            Copy last month
          </Button>
          <Button variant="gold" onClick={() => void save()} disabled={busy || !data}>
            {busy ? "Saving…" : "Save budget"}
          </Button>
        </div>
      </header>

      {error && <Card className="border-red-400/20 text-sm text-red-300">{error}</Card>}

      {/* ------------------------------------------------------ month tabs */}
      <div className="flex flex-wrap gap-1.5">
        {MONTH_LABELS.map((label, i) => (
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
            {label}
          </button>
        ))}
      </div>

      {/* --------------------------------------------------------- headline */}
      <div className="grid gap-4 sm:grid-cols-4">
        <StatTile label="Income" value={money(data?.total_income ?? 0)} hint="From this month's budget" />
        <StatTile label="Budgeted" value={money(draftAllocated)} hint="Across all envelopes" />
        <StatTile label="Actually spent" value={money(data?.total_actual ?? 0)} hint="From the ledger" />
        <StatTile
          label="Unallocated"
          value={money(unallocated)}
          accent={unallocated >= 0}
          delta={
            unallocated < 0
              ? { text: "Over-committed", positive: false }
              : { text: "Left to assign", positive: true }
          }
        />
      </div>

      {/* -------------------------------------------------------- envelopes */}
      {loading && !data ? (
        <div className="space-y-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : groups.length === 0 ? (
        <Card className="text-sm text-navy-300">
          Nothing to budget yet — log some entries in the ledger and the categories
          you use will appear here.
        </Card>
      ) : (
        <section className="space-y-2">
          <SectionHeading
            title="Envelopes"
            hint="Open a group, type a planned amount beside any category, then Save budget"
            action={
              <Button
                variant="quiet"
                onClick={() =>
                  setOpen(
                    open.size === groups.length
                      ? new Set()
                      : new Set(groups.map((g) => g.name)),
                  )
                }
              >
                {open.size === groups.length ? "Collapse all" : "Expand all"}
              </Button>
            }
          />
          {groups.map((group) => {
            const expanded = open.has(group.name);
            const over = group.actual > group.allocated && group.allocated > 0;
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
                    className={cx("text-navy-300 transition-transform", expanded && "rotate-90")}
                  >
                    ›
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm text-navy-50">{group.name}</span>
                      <span className="shrink-0 text-sm tabular-nums">
                        <span className={over ? "text-red-300" : "text-navy-50"}>
                          {money(group.actual)}
                        </span>
                        <span className="text-navy-300"> / {money(group.allocated)}</span>
                      </span>
                    </span>
                    <span className="mt-1 block text-[11px] text-navy-300">
                      {group.lines.filter((l) => Number(l.allocated) > 0).length} of{" "}
                      {group.lines.length} budgeted
                    </span>
                    <span className="mt-1.5 block h-1.5 rounded-full bg-white/5">
                      <span
                        className="block h-1.5 rounded-full"
                        style={{
                          width: `${
                            group.allocated > 0
                              ? Math.min(100, (group.actual / group.allocated) * 100)
                              : 0
                          }%`,
                          backgroundColor: over ? "#c34f4b" : SERIES.expense,
                        }}
                      />
                    </span>
                  </span>
                </button>

                {expanded && (
                  <ul className="border-t border-white/5 bg-navy-950/40 px-5 py-2">
                    <li className="flex flex-wrap items-center gap-3 border-b border-white/10 pb-1.5 text-[10px] uppercase tracking-[0.14em] text-navy-300">
                      <span className="min-w-[9rem] flex-1">Category</span>
                      <span className="w-28 shrink-0">Used</span>
                      <span className="w-24 shrink-0 text-right">Spent</span>
                      <span className="w-24 shrink-0 text-right">Planned</span>
                    </li>
                    {group.lines.map((line) => (
                      <BudgetRow
                        key={line.category_id ?? line.category_name}
                        line={line}
                        draft={drafts[line.category_id ?? ""] ?? ""}
                        currency={data?.base_currency ?? baseCurrency}
                        onChange={(value) =>
                          line.category_id &&
                          setDrafts((d) => ({ ...d, [line.category_id as string]: value }))
                        }
                      />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </section>
      )}

      <p className="text-xs text-navy-300">
        Savings and investments are budgeted here too — they are money leaving your
        current account even though they stay yours.
      </p>

      <Toast message={toast.message} action={toast.action} onDismiss={toast.dismiss} />
    </div>
  );
}

function BudgetRow({
  line,
  draft,
  currency,
  onChange,
}: {
  line: BudgetLine;
  draft: string;
  currency: string;
  onChange: (value: string) => void;
}) {
  const planned = parseAmount(draft) ?? 0;
  const actual = Number(line.actual);
  const over = planned > 0 && actual > planned;
  const pct = planned > 0 ? Math.min(100, (actual / planned) * 100) : 0;

  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-white/5 py-2.5 last:border-0">
      <span className="min-w-[9rem] flex-1 truncate text-sm text-navy-100">
        {line.category_name}
        {line.entry_count > 0 && (
          <span className="ml-2 text-[10px] text-navy-300">
            {line.entry_count} {line.entry_count === 1 ? "entry" : "entries"}
          </span>
        )}
      </span>

      <span className="w-28 shrink-0">
        <span className="block h-1.5 rounded-full bg-white/5">
          <span
            className="block h-1.5 rounded-full"
            style={{ width: `${pct}%`, backgroundColor: over ? "#c34f4b" : SERIES.savings }}
          />
        </span>
      </span>

      <span
        className={cx(
          "w-24 shrink-0 text-right text-sm tabular-nums",
          over ? "text-red-300" : "text-navy-50",
        )}
        title="Actually spent"
      >
        {formatMoney(actual, currency, { whole: true })}
      </span>

      <input
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        placeholder="—"
        inputMode="decimal"
        aria-label={`Planned amount for ${line.category_name}`}
        disabled={!line.category_id}
        className="input w-24 shrink-0 text-right tabular-nums disabled:opacity-40"
      />
    </li>
  );
}
