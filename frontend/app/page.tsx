"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useState } from "react";

import { DisclosureCard } from "@/components/DisclosureCard";
import { ReceiptScanner } from "@/components/ReceiptScanner";
import { api, type GivingSummary } from "@/lib/api";
import { GIVING_ARMS, REALM_LABELS, REALM_ORDER, cad, type Realm } from "@/lib/givingArms";

const TAX_YEAR = 2026;
const LIMITS = { tfsa: 7000, rrsp: 33810, fhsa: 8000 };

export default function Dashboard() {
  const [summary, setSummary] = useState<GivingSummary | null>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.givingSummary(TAX_YEAR), api.accounts()])
      .then(([s, a]) => {
        setSummary(s);
        setAccounts(a);
      })
      .catch((err) => setError(err.message));
  }, []);

  const netWorth = accounts.reduce((sum, a) => sum + Number(a.balance ?? 0), 0);
  const armName = (arm: string) =>
    GIVING_ARMS.find((a) => a.arm === arm)?.display_name ?? arm;

  return (
    <div className="space-y-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <h1 className="text-2xl font-semibold tracking-tight">
          Your stewardship, <span className="gold-text">{TAX_YEAR}</span>
        </h1>
        <p className="mt-1 text-sm text-navy-300">
          Ontario · everything else is one tap away.
        </p>
      </motion.div>

      {error && (
        <p className="card text-sm text-red-300">
          Could not load your data — {error}. Sign in and confirm the API is running.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <DisclosureCard
          label="Given this year"
          value={cad(summary?.total_given ?? 0)}
          accent
          hint={
            summary
              ? `${cad(summary.receiptable_total)} receiptable · ${cad(
                  summary.non_receiptable_total,
                )} personal`
              : "—"
          }
        >
          <ul className="space-y-2">
            {REALM_ORDER.map((realm) => (
              <li key={realm} className="flex justify-between text-navy-100">
                <span>{REALM_LABELS[realm as Realm]}</span>
                <span className="tabular-nums">
                  {cad(summary?.by_realm?.[realm] ?? 0)}
                </span>
              </li>
            ))}
          </ul>
          <Link
            href="/giving"
            className="mt-4 inline-block text-xs text-gold-300 hover:underline"
          >
            Open the Giving Engine →
          </Link>
        </DisclosureCard>

        <DisclosureCard
          label="Est. donation credit"
          value={cad(summary?.estimated_federal_credit ?? 0)}
          hint="Federal, 15% / 29% split"
        >
          <p className="text-navy-300">
            Calculated on {cad(summary?.receiptable_total ?? 0)} of receiptable giving.
            Honorariums, love offerings and direct alms are excluded — CRA does not
            allow a receipt for a gift to an individual.
          </p>
        </DisclosureCard>

        <DisclosureCard
          label="Net worth"
          value={cad(netWorth)}
          hint={`${accounts.length} account${accounts.length === 1 ? "" : "s"}`}
        >
          <ul className="space-y-2">
            {accounts.map((account) => (
              <li key={account.id} className="flex justify-between text-navy-100">
                <span>
                  {account.name}
                  <span className="ml-2 text-xs uppercase text-navy-300">
                    {account.type}
                  </span>
                </span>
                <span className="tabular-nums">{cad(Number(account.balance))}</span>
              </li>
            ))}
            {accounts.length === 0 && (
              <li className="text-navy-300">No accounts linked yet.</li>
            )}
          </ul>
        </DisclosureCard>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <DisclosureCard label="TFSA room" value={cad(LIMITS.tfsa)} hint="2026 annual limit">
          <p className="text-navy-300">
            Add unused room carried forward from your CRA Notice of Assessment.
          </p>
        </DisclosureCard>
        <DisclosureCard label="RRSP limit" value={cad(LIMITS.rrsp)} hint="18% of earned income, capped">
          <p className="text-navy-300">
            Clergy residence deduction may change the income this is calculated on.
          </p>
        </DisclosureCard>
        <DisclosureCard label="FHSA room" value={cad(LIMITS.fhsa)} hint="$40,000 lifetime">
          <p className="text-navy-300">Unused room carries forward up to $8,000 per year.</p>
        </DisclosureCard>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ReceiptScanner />
        <div className="card">
          <p className="label">Top arms this year</p>
          <ul className="mt-4 space-y-3">
            {Object.entries(summary?.by_arm ?? {})
              .sort((a, b) => b[1] - a[1])
              .slice(0, 6)
              .map(([arm, amount]) => (
                <li key={arm} className="flex items-center justify-between text-sm">
                  <span className="text-navy-100">{armName(arm)}</span>
                  <span className="tabular-nums text-gold-300">{cad(amount)}</span>
                </li>
              ))}
            {!summary?.by_arm || Object.keys(summary.by_arm).length === 0 ? (
              <li className="text-sm text-navy-300">Nothing recorded yet this year.</li>
            ) : null}
          </ul>
          {summary && summary.outstanding_pledges > 0 && (
            <p className="mt-4 text-xs text-gold-300">
              {cad(summary.outstanding_pledges)} in pledges still outstanding.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
