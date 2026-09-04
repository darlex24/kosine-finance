"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useCatalog } from "@/components/CatalogProvider";
import { CashFlowChart, Sparkline } from "@/components/dashboard/charts";
import { YearlyRecord } from "@/components/dashboard/YearlyRecord";
import { DisclosureCard } from "@/components/DisclosureCard";
import { ReceiptScanner } from "@/components/ReceiptScanner";
import { CanadaModule } from "@/components/regions/CanadaModule";
import { Button, Card, SectionHeading, Skeleton, StatTile } from "@/components/ui";
import { YearPicker, useYears } from "@/components/YearPicker";
import { api, type GivingSummary } from "@/lib/api";
import { GIVING_ARMS, REALM_LABELS, REALM_ORDER, type Realm } from "@/lib/givingArms";
import { formatAbs, formatMoney, formatPercent } from "@/lib/money";
import type {
  AnnualSummary,
  CashFlowPoint,
  CategorySpend,
  LedgerRow,
  NetWorth,
} from "@/lib/types";

export default function Dashboard() {
  const { profile, baseCurrency, ready, dataVersion, invalidate } = useCatalog();
  const { years } = useYears();
  const [year, setYear] = useState(new Date().getFullYear());
  const [netWorth, setNetWorth] = useState<NetWorth | null>(null);
  const [cashFlow, setCashFlow] = useState<CashFlowPoint[]>([]);
  const [spend, setSpend] = useState<CategorySpend[]>([]);
  const [recent, setRecent] = useState<LedgerRow[]>([]);
  const [summary, setSummary] = useState<GivingSummary | null>(null);
  const [annual, setAnnual] = useState<AnnualSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [snapshotting, setSnapshotting] = useState(false);

  // Net worth and the yearly record are position-in-time and whole-history, so
  // they are fetched once; everything else re-reads when the year changes.
  useEffect(() => {
    if (!ready) return;
    Promise.all([api.netWorth(), api.annualSummary(), api.ledger({ limit: 8 })])
      .then(([nw, summaries, ledger]) => {
        setNetWorth(nw);
        setAnnual(summaries);
        setRecent(ledger.rows);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Could not load your dashboard"),
      );
    // dataVersion: any write anywhere in the app, a base-currency switch, or
    // returning to the tab re-reads these.
  }, [ready, dataVersion]);

  useEffect(() => {
    if (!ready) return;
    Promise.all([api.cashFlow(year), api.categorySpend(year), api.givingSummary(year)])
      .then(([flow, categories, giving]) => {
        setCashFlow(flow);
        setSpend(categories);
        setSummary(giving);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : `Could not load ${year}`),
      );
  }, [ready, year, dataVersion]);

  const money = (value: number | null | undefined, whole = true) =>
    formatMoney(value ?? 0, netWorth?.base_currency ?? baseCurrency, { whole });

  const armName = (arm: string) =>
    GIVING_ARMS.find((a) => a.arm === arm)?.display_name ?? arm;

  async function snapshot() {
    setSnapshotting(true);
    try {
      await api.snapshotNetWorth();
      invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the snapshot");
    } finally {
      setSnapshotting(false);
    }
  }

  return (
    <div className="space-y-10">
      <motion.header
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="flex flex-wrap items-end justify-between gap-4"
      >
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Your stewardship, <span className="gold-text">{year}</span>
          </h1>
          <p className="mt-1 text-sm text-navy-300">
            {profile?.full_name ? `${profile.full_name} · ` : ""}
            Everything you hold, everything you give — in {baseCurrency}.
          </p>
        </div>
        <YearPicker years={years} value={year} onChange={setYear} />
      </motion.header>

      {error && (
        <Card className="border-red-400/20 text-sm text-red-300">
          Could not load your data — {error}. Confirm the API is running and the V2
          migrations have been applied.
        </Card>
      )}

      {/* ------------------------------------------------------ net worth */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Card accent className="lg:col-span-1">
          <p className="label">Net worth</p>
          {netWorth ? (
            <>
              <p className="figure mt-1 gold-text">{money(netWorth.net_worth)}</p>
              <div className="mt-2 flex items-center gap-2 text-xs">
                {netWorth.change_amount != null ? (
                  <span
                    className={
                      netWorth.change_amount >= 0 ? "text-emerald-300" : "text-red-300"
                    }
                  >
                    {formatMoney(netWorth.change_amount, netWorth.base_currency, {
                      whole: true,
                      signed: true,
                    })}{" "}
                    {formatPercent(netWorth.change_pct)}
                  </span>
                ) : (
                  <span className="text-navy-300">No earlier snapshot yet</span>
                )}
                <span className="text-navy-300">since last snapshot</span>
              </div>
              <Sparkline points={netWorth.trend} className="mt-4" />
              <div className="mt-4 flex items-center justify-between">
                <Link href="/assets" className="text-xs text-gold-300 hover:underline">
                  Manage assets &amp; liabilities →
                </Link>
                <Button variant="quiet" onClick={() => void snapshot()} disabled={snapshotting}>
                  {snapshotting ? "Saving…" : "Snapshot today"}
                </Button>
              </div>
            </>
          ) : (
            <Skeleton className="mt-3 h-24" />
          )}
        </Card>

        <div className="grid gap-4 sm:grid-cols-3 lg:col-span-2">
          <StatTile
            label="Assets"
            value={money(netWorth?.total_assets)}
            hint="Holdings + account balances"
          />
          <StatTile
            label="Liabilities"
            value={money(netWorth?.total_liabilities)}
            hint="Loans + card balances"
          />
          <StatTile
            label="Liquid cash"
            value={money(netWorth?.liquid_cash)}
            hint="Available today"
          />
        </div>
      </section>

      {/* ------------------------------------------------------ cash flow */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionHeading
            title="Cash flow"
            hint={`Monthly, ${year} — giving shown as its own outflow`}
          />
          <CashFlowChart points={cashFlow} currency={baseCurrency} />
        </Card>

        <Card>
          <SectionHeading
            title="Where it goes"
            hint={`Top categories, ${year}`}
            action={
              <Link href="/expenses" className="text-xs text-gold-300 hover:underline">
                Full breakdown →
              </Link>
            }
          />
          <ul className="space-y-2.5">
            {spend.slice(0, 8).map((item) => (
              <li key={`${item.category_group}-${item.category_name}`} className="text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-navy-100">{item.category_name}</span>
                  <span className="tabular-nums text-navy-50">{money(item.total)}</span>
                </div>
                <div className="mt-1 h-1 rounded-full bg-white/5">
                  <div
                    className="h-1 rounded-full bg-gold-500/70"
                    style={{
                      width: `${Math.min(100, (item.total / (spend[0]?.total || 1)) * 100)}%`,
                    }}
                  />
                </div>
              </li>
            ))}
            {spend.length === 0 && (
              <li className="text-sm text-navy-300">Nothing categorised yet this year.</li>
            )}
          </ul>
        </Card>
      </section>

      {/* --------------------------------------------------------- giving */}
      <section className="grid gap-4 md:grid-cols-3">
        <DisclosureCard
          label={`Given in ${year}`}
          value={money(summary?.total_given ?? 0)}
          accent
          hint={
            summary
              ? `${money(summary.receiptable_total)} receiptable · ${money(
                  summary.non_receiptable_total,
                )} personal`
              : "—"
          }
        >
          <ul className="space-y-2">
            {REALM_ORDER.map((realm) => (
              <li key={realm} className="flex justify-between text-navy-100">
                <span>{REALM_LABELS[realm as Realm]}</span>
                <span className="tabular-nums">{money(summary?.by_realm?.[realm] ?? 0)}</span>
              </li>
            ))}
          </ul>
          <Link href="/giving" className="mt-4 inline-block text-xs text-gold-300 hover:underline">
            Open the Giving Engine →
          </Link>
        </DisclosureCard>

        <Card>
          <p className="label">Top arms in {year}</p>
          <ul className="mt-4 space-y-3">
            {Object.entries(summary?.by_arm ?? {})
              .sort((a, b) => b[1] - a[1])
              .slice(0, 6)
              .map(([arm, amount]) => (
                <li key={arm} className="flex items-center justify-between text-sm">
                  <span className="text-navy-100">{armName(arm)}</span>
                  <span className="tabular-nums text-gold-300">{money(amount)}</span>
                </li>
              ))}
            {Object.keys(summary?.by_arm ?? {}).length === 0 && (
              <li className="text-sm text-navy-300">Nothing recorded in {year}.</li>
            )}
          </ul>
          {summary && summary.outstanding_pledges > 0 && (
            <p className="mt-4 text-xs text-gold-300">
              {money(summary.outstanding_pledges)} in pledges still outstanding.
            </p>
          )}
        </Card>

        <Card>
          <SectionHeading
            title="Recent entries"
            action={
              <Link href="/ledger" className="text-xs text-gold-300 hover:underline">
                Open ledger →
              </Link>
            }
          />
          <ul className="space-y-2.5 text-sm">
            {recent.map((row) => (
              <li key={row.id} className="flex items-baseline justify-between gap-3">
                <span className="truncate text-navy-100">
                  {row.merchant ?? row.category_name ?? row.entry_type}
                  <span className="ml-2 text-[10px] uppercase tracking-wide text-navy-300">
                    {row.date}
                  </span>
                </span>
                <span
                  className={`tabular-nums ${
                    row.amount < 0 ? "text-navy-50" : "text-emerald-300"
                  }`}
                >
                  {formatAbs(row.amount, row.currency)}
                </span>
              </li>
            ))}
            {recent.length === 0 && (
              <li className="text-navy-300">Nothing logged yet — start in the ledger.</li>
            )}
          </ul>
        </Card>
      </section>

      {/* ------------------------------------------------------------ scan */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1">
          {/* Committing a scan bumps dataVersion, so every figure above
              re-reads without a navigation. */}
          <ReceiptScanner onCommitted={() => invalidate()} />
        </div>

        {/* -------------------------------------------------- yearly record */}
        <div className="lg:col-span-2">
          <YearlyRecord rows={annual} selectedYear={year} onSelectYear={setYear} />
        </div>
      </section>

      {/* Region module: only for ministers filing in Canada. */}
      {profile?.country_code === "CA" && (
        <CanadaModule summary={summary} taxYear={year} />
      )}
    </div>
  );
}
