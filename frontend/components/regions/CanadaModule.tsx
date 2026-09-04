"use client";

import { DisclosureCard } from "@/components/DisclosureCard";
import { formatMoney } from "@/lib/money";
import type { GivingSummary } from "@/lib/api";

/** Canada-specific tax surface.
 *
 * V1 hard-coded these onto the dashboard. They now render only when the user's
 * `country_code` is CA, so a minister in Lagos or London isn't shown TFSA room
 * they cannot use. The Canadian schema (canadian_limits, giving_arm_rules,
 * kingdom_giving_records) is unchanged — this is purely a presentation gate.
 */

const LIMITS_2026 = { tfsa: 7000, rrsp: 33810, fhsa: 8000 };
const CAD = "CAD";

export function CanadaModule({
  summary,
  taxYear,
}: {
  summary: GivingSummary | null;
  taxYear: number;
}) {
  const money = (value: number) => formatMoney(value, CAD, { whole: true });

  return (
    <section className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Canada</h2>
        <span className="text-xs text-navy-300">
          Registered accounts and CRA donation credit, {taxYear}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <DisclosureCard
          label="Est. donation credit"
          value={money(summary?.estimated_federal_credit ?? 0)}
          accent
          hint="Federal, 15% / 29% split"
        >
          <p className="text-navy-300">
            Calculated on {money(summary?.receiptable_total ?? 0)} of receiptable giving.
            Honorariums, love offerings and direct alms are excluded — CRA does not allow a
            receipt for a gift to an individual.
          </p>
        </DisclosureCard>

        <DisclosureCard label="TFSA room" value={money(LIMITS_2026.tfsa)} hint="2026 annual limit">
          <p className="text-navy-300">
            Add unused room carried forward from your CRA Notice of Assessment.
          </p>
        </DisclosureCard>

        <DisclosureCard
          label="RRSP limit"
          value={money(LIMITS_2026.rrsp)}
          hint="18% of earned income, capped"
        >
          <p className="text-navy-300">
            The clergy residence deduction may change the income this is calculated on.
          </p>
        </DisclosureCard>

        <DisclosureCard label="FHSA room" value={money(LIMITS_2026.fhsa)} hint="$40,000 lifetime">
          <p className="text-navy-300">Unused room carries forward up to $8,000 per year.</p>
        </DisclosureCard>
      </div>
    </section>
  );
}
