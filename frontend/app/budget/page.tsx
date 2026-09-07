"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useCatalog } from "@/components/CatalogProvider";
import {
  Button,
  Card,
  Combobox,
  SectionHeading,
  Skeleton,
  StatTile,
  Toast,
  cx,
  useToast,
  type Option,
} from "@/components/ui";
import { YearPicker, useYears } from "@/components/YearPicker";
import { api } from "@/lib/api";
import { MONTH_LABELS, SERIES } from "@/lib/chartTheme";
import { formatMoney, parseAmount } from "@/lib/money";
import type { BudgetLine, BudgetMonth, BudgetYear } from "@/lib/types";

const now = new Date();

/** Envelope budgeting.
 *
 * Two views on the same data. The month answers "am I on track"; the year
 * answers "what does this category actually cost me", which is the number you
 * budget from next time.
 */
export default function BudgetPage() {
  const { baseCurrency, categories, ready, invalidate, dataVersion } = useCatalog();
  const { years } = useYears();

  const [view, setView] = useState<"month" | "year">("month");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const [data, setData] = useState<BudgetMonth | null>(null);
  const [annual, setAnnual] = useState<BudgetYear | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // Categories the user has explicitly pulled into this month's budget, on top
  // of whatever already has an allocation or actual spend.
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const currency = data?.base_currency ?? annual?.base_currency ?? baseCurrency;
  const money = (v: number) => formatMoney(v, currency, { whole: true });

  const load = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    try {
      if (view === "month") {
        const m = await api.budgetMonth(year, month);
        setData(m);
        setDrafts(
          Object.fromEntries(
            m.lines
              .filter((l) => l.category_id && Number(l.allocated) > 0)
              .map((l) => [l.category_id as string, String(l.allocated)]),
          ),
        );
      } else {
        setAnnual(await api.budgetYear(year));
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the budget");
    } finally {
      setLoading(false);
    }
  }, [ready, view, year, month, dataVersion]);

  useEffect(() => {
    void load();
  }, [load]);

  const lineByCategory = useMemo(() => {
    const map = new Map<string, BudgetLine>();
    for (const l of data?.lines ?? []) if (l.category_id) map.set(l.category_id, l);
    return map;
  }, [data]);

  /** Only the envelopes that matter: budgeted, spent, or explicitly added.
   *
   * Showing all 99 categories at once is not a budget, it is a data-entry form.
   * You pick what you plan for; everything else stays one search away.
   */
  const envelopes = useMemo(() => {
    const keys = new Set<string>(picked);
    for (const l of data?.lines ?? []) {
      if (!l.category_id) continue;
      if (Number(l.allocated) > 0 || Number(l.actual) > 0) keys.add(l.category_id);
    }
    return [...keys]
      .map((id) => lineByCategory.get(id))
      .filter((l): l is BudgetLine => Boolean(l))
      .sort(
        (a, b) =>
          a.category_group.localeCompare(b.category_group) ||
          b.actual - a.actual ||
          a.category_name.localeCompare(b.category_name),
      );
  }, [picked, data, lineByCategory]);

  const categoryOptions = useMemo<Option[]>(
    () =>
      categories
        .filter((c) => c.parent_id !== null)
        .map((c) => ({ value: c.id, label: c.name, group: c.group })),
    [categories],
  );

  const draftAllocated = useMemo(
    () => Object.values(drafts).reduce((sum, raw) => sum + (parseAmount(raw) ?? 0), 0),
    [drafts],
  );

  async function save() {
    setBusy(true);
    try {
      const allocations = Object.entries(drafts).map(([category_id, raw]) => ({
        category_id,
        allocated: parseAmount(raw) ?? 0,
      }));
      const saved = await api.saveAllocations(year, month, allocations);
      setData(saved);
      invalidate();
      toast.show(`Saved ${MONTH_LABELS[month - 1]} ${year}`);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Could not save the budget");
    } finally {
      setBusy(false);
    }
  }

  async function copyForward() {
    const pm = month === 1 ? 12 : month - 1;
    const py = month === 1 ? year - 1 : year;
    setBusy(true);
    try {
      const saved = await api.copyBudgetForward({ year: py, month: pm }, { year, month });
      setData(saved);
      setDrafts(
        Object.fromEntries(
          saved.lines
            .filter((l) => l.category_id && Number(l.allocated) > 0)
            .map((l) => [l.category_id as string, String(l.allocated)]),
        ),
      );
      toast.show(`Copied ${MONTH_LABELS[pm - 1]} forward`);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Nothing to copy from last month");
    } finally {
      setBusy(false);
    }
  }

  const unallocated = (data?.total_income ?? 0) - draftAllocated;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Monthly <span className="gold-text">budget</span>
          </h1>
          <p className="mt-1 text-sm text-navy-300">
            Pick a category, set what you plan to spend, and see it against what you did.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-full border border-white/5 bg-navy-900/60 p-1 text-sm">
            {(["month", "year"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cx(
                  "rounded-full px-3.5 py-1 capitalize transition",
                  view === v
                    ? "bg-gold-500/15 text-gold-200"
                    : "text-navy-300 hover:bg-white/5 hover:text-gold-300",
                )}
              >
                {v}
              </button>
            ))}
          </div>
          <YearPicker years={years} value={year} onChange={setYear} />
          {view === "month" && (
            <>
              <Button onClick={() => void copyForward()} disabled={busy}>
                Copy last month
              </Button>
              <Button variant="gold" onClick={() => void save()} disabled={busy}>
                {busy ? "Saving…" : "Save budget"}
              </Button>
            </>
          )}
        </div>
      </header>

      {error && <Card className="border-red-400/20 text-sm text-red-300">{error}</Card>}

      {view === "month" ? (
        <>
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

          <div className="grid gap-4 sm:grid-cols-4">
            <StatTile label="Income" value={money(data?.total_income ?? 0)} hint="This month" />
            <StatTile label="Budgeted" value={money(draftAllocated)} hint="Across all envelopes" />
            <StatTile
              label="Actually spent"
              value={money(data?.total_actual ?? 0)}
              hint="From the ledger"
            />
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

          {/* ------------------------------------------------ add a category */}
          <Card accent>
            <SectionHeading
              title="Add a category to this month"
              hint="Search any of your categories, then set what you plan to spend"
            />
            <Combobox
              options={categoryOptions.filter(
                (o) => !envelopes.some((e) => e.category_id === o.value),
              )}
              value={null}
              onChange={(id) => {
                if (!id) return;
                setPicked((p) => (p.includes(id) ? p : [...p, id]));
                setDrafts((d) => ({ ...d, [id]: d[id] ?? "" }));
              }}
              placeholder="Search categories — groceries, tithe, rent…"
            />
          </Card>

          {/* ---------------------------------------------------- envelopes */}
          {loading && !data ? (
            <div className="space-y-2">
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </div>
          ) : envelopes.length === 0 ? (
            <Card className="text-sm text-navy-300">
              No envelopes yet. Use the search above to add a category, type what you plan
              to spend, then <span className="text-gold-300">Save budget</span>.
            </Card>
          ) : (
            <Card className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-left">
                      <th className="px-4 py-2.5 text-[10px] uppercase tracking-[0.14em] text-navy-300">
                        Category
                      </th>
                      <th className="px-4 py-2.5 text-right text-[10px] uppercase tracking-[0.14em] text-navy-300">
                        Planned
                      </th>
                      <th className="px-4 py-2.5 text-right text-[10px] uppercase tracking-[0.14em] text-navy-300">
                        Spent
                      </th>
                      <th className="px-4 py-2.5 text-right text-[10px] uppercase tracking-[0.14em] text-navy-300">
                        Left
                      </th>
                      <th className="w-28 px-4 py-2.5 text-[10px] uppercase tracking-[0.14em] text-navy-300">
                        Used
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {envelopes.map((line) => (
                      <EnvelopeRow
                        key={line.category_id as string}
                        line={line}
                        draft={drafts[line.category_id as string] ?? ""}
                        currency={currency}
                        onChange={(v) =>
                          setDrafts((d) => ({ ...d, [line.category_id as string]: v }))
                        }
                        onRemove={() => {
                          setPicked((p) => p.filter((id) => id !== line.category_id));
                          setDrafts((d) => ({ ...d, [line.category_id as string]: "0" }));
                        }}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      ) : (
        <YearView annual={annual} loading={loading} currency={currency} />
      )}

      <p className="text-xs text-navy-300">
        Savings and investments are budgeted here too — they leave your current account
        even though they stay yours. Transfers are excluded; they net to zero.
      </p>

      <Toast message={toast.message} action={toast.action} onDismiss={toast.dismiss} />
    </div>
  );
}

function EnvelopeRow({
  line,
  draft,
  currency,
  onChange,
  onRemove,
}: {
  line: BudgetLine;
  draft: string;
  currency: string;
  onChange: (value: string) => void;
  onRemove: () => void;
}) {
  const planned = parseAmount(draft) ?? 0;
  const actual = Number(line.actual);
  const left = planned - actual;
  const over = planned > 0 && actual > planned;
  const pct = planned > 0 ? Math.min(100, (actual / planned) * 100) : 0;

  return (
    <tr className="border-b border-white/5 last:border-0">
      <td className="px-4 py-2.5">
        <span className="text-navy-100">{line.category_name}</span>
        <span className="ml-2 text-[10px] uppercase tracking-wide text-navy-300">
          {line.category_group}
        </span>
      </td>

      <td className="px-4 py-2 text-right">
        <input
          value={draft}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
          inputMode="decimal"
          aria-label={`Planned amount for ${line.category_name}`}
          className="input w-28 text-right tabular-nums"
        />
      </td>

      <td className="px-4 py-2.5 text-right tabular-nums text-navy-50">
        {formatMoney(actual, currency, { whole: true })}
      </td>

      <td
        className={cx(
          "px-4 py-2.5 text-right tabular-nums",
          planned === 0 ? "text-navy-300" : over ? "text-red-300" : "text-emerald-300",
        )}
      >
        {planned === 0 ? "—" : formatMoney(left, currency, { whole: true, signed: true })}
      </td>

      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-1.5 flex-1 rounded-full bg-white/5">
            <span
              className="block h-1.5 rounded-full"
              style={{ width: `${pct}%`, backgroundColor: over ? "#c34f4b" : SERIES.savings }}
            />
          </span>
          <button
            onClick={onRemove}
            title="Remove from this month"
            aria-label={`Remove ${line.category_name} from this month`}
            className="text-xs text-navy-300 transition hover:text-red-300"
          >
            ×
          </button>
        </div>
      </td>
    </tr>
  );
}

/** The year: every category's plan against its actual, summed across all twelve
 *  months. Read-only — you edit a month, not a year. */
function YearView({
  annual,
  loading,
  currency,
}: {
  annual: BudgetYear | null;
  loading: boolean;
  currency: string;
}) {
  const money = (v: number) => formatMoney(v, currency, { whole: true });

  if (loading && !annual) return <Skeleton className="h-64" />;
  if (!annual || annual.lines.length === 0) {
    return (
      <Card className="text-sm text-navy-300">
        Nothing recorded for {annual?.year ?? "this year"} yet.
      </Card>
    );
  }

  const byGroup = new Map<string, typeof annual.lines>();
  for (const l of annual.lines) {
    byGroup.set(l.category_group, [...(byGroup.get(l.category_group) ?? []), l]);
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label={`Budgeted in ${annual.year}`} value={money(annual.total_allocated)} hint="All twelve months" />
        <StatTile label="Actually spent" value={money(annual.total_actual)} hint="From the ledger" />
        <StatTile
          label="Difference"
          value={money(annual.total_allocated - annual.total_actual)}
          accent={annual.total_allocated >= annual.total_actual}
          delta={
            annual.total_allocated < annual.total_actual
              ? { text: "Over budget", positive: false }
              : { text: "Under budget", positive: true }
          }
        />
      </div>

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left">
                <th className="px-4 py-2.5 text-[10px] uppercase tracking-[0.14em] text-navy-300">
                  Category
                </th>
                <th className="px-4 py-2.5 text-right text-[10px] uppercase tracking-[0.14em] text-navy-300">
                  Budgeted
                </th>
                <th className="px-4 py-2.5 text-right text-[10px] uppercase tracking-[0.14em] text-navy-300">
                  Spent
                </th>
                <th className="px-4 py-2.5 text-right text-[10px] uppercase tracking-[0.14em] text-navy-300">
                  Difference
                </th>
              </tr>
            </thead>
            {[...byGroup.entries()].map(([group, lines]) => (
              <tbody key={group}>
                <tr className="bg-white/[0.03]">
                  <td
                    colSpan={4}
                    className="px-4 py-1.5 text-[10px] uppercase tracking-[0.14em] text-navy-300"
                  >
                    {group}
                  </td>
                </tr>
                {lines.map((l) => {
                  const diff = Number(l.allocated) - Number(l.actual);
                  return (
                    <tr key={l.category_name} className="border-b border-white/5">
                      <td className="px-4 py-2 text-navy-100">{l.category_name}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-navy-300">
                        {Number(l.allocated) > 0 ? money(Number(l.allocated)) : "—"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-navy-50">
                        {money(Number(l.actual))}
                      </td>
                      <td
                        className={cx(
                          "px-4 py-2 text-right tabular-nums",
                          Number(l.allocated) === 0
                            ? "text-navy-300"
                            : diff < 0
                              ? "text-red-300"
                              : "text-emerald-300",
                        )}
                      >
                        {Number(l.allocated) === 0
                          ? "not budgeted"
                          : formatMoney(diff, currency, { whole: true, signed: true })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      </Card>
    </>
  );
}
