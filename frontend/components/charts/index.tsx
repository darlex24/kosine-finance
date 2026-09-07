"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
} from "recharts";

import { cx } from "@/components/ui";
import {
  AXIS,
  MONTH_LABELS,
  OUTFLOW_TYPES,
  SEGMENT_GAP,
  SERIES,
  SERIES_LABEL,
  SURFACE,
  rampColor,
  rampSpread,
} from "@/lib/chartTheme";
import { formatMoney } from "@/lib/money";
import type { CashFlowPoint, CategorySpend, GivingByArm } from "@/lib/types";

/** The infographic set.
 *
 * Every chart carries a legend or direct labels, not because it looks tidy but
 * because the palette's worst colourblind separation sits in the band that is
 * only permissible alongside a second, non-colour channel. Strip the labels and
 * these stop being readable for a chunk of users.
 */

const money = (v: number, c: string) => formatMoney(v, c, { whole: true });

type TooltipEntry = { name?: string; value?: number; color?: string };

function ChartTooltip({
  active,
  payload,
  label,
  currency,
  total,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  currency: string;
  total?: number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-navy-900/95 px-3 py-2 text-xs shadow-card backdrop-blur">
      {label != null && <p className="mb-1 font-medium text-navy-50">{label}</p>}
      {payload.map((entry, i) => (
        <p key={i} className="flex items-center gap-2 text-navy-100">
          <span
            aria-hidden
            className="h-2 w-2 shrink-0 rounded-sm"
            style={{ backgroundColor: entry.color }}
          />
          <span>{SERIES_LABEL[entry.name as keyof typeof SERIES_LABEL] ?? entry.name}</span>
          <span className="ml-auto pl-3 tabular-nums text-navy-50">
            {money(Number(entry.value ?? 0), currency)}
          </span>
          {total ? (
            <span className="tabular-nums text-navy-300">
              {((Number(entry.value ?? 0) / total) * 100).toFixed(0)}%
            </span>
          ) : null}
        </p>
      ))}
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-full min-h-[12rem] place-items-center text-center text-sm text-navy-300">
      {children}
    </div>
  );
}

// ------------------------------------------------------------------- donut

/** Outflow by category group, ranked.
 *
 * Ranked magnitude takes a single-hue ramp rather than categorical colours —
 * which also keeps it unmistakably on brand. Anything past the ramp folds into
 * "Other"; a generated ninth hue would be both indistinguishable and meaningless.
 */
export function OutflowDonut({
  rows,
  currency,
  onSelectGroup,
  selectedGroup,
}: {
  rows: CategorySpend[];
  currency: string;
  onSelectGroup?: (group: string | null) => void;
  selectedGroup?: string | null;
}) {
  const { slices, total } = useMemo(() => {
    const byGroup = new Map<string, number>();
    for (const r of rows) {
      byGroup.set(r.category_group, (byGroup.get(r.category_group) ?? 0) + Number(r.total));
    }
    const sorted = [...byGroup.entries()].sort((a, b) => b[1] - a[1]);
    const head = sorted.slice(0, 5);
    const tail = sorted.slice(5);
    const merged: [string, number][] = tail.length
      ? [...head, ["Other", tail.reduce((s, [, v]) => s + v, 0)]]
      : head;
    const fills = rampSpread(merged.length);
    return {
      slices: merged.map(([name, value], i) => ({ name, value, fill: fills[i] })),
      total: sorted.reduce((s, [, v]) => s + v, 0),
    };
  }, [rows]);

  if (total <= 0) return <EmptyState>Nothing logged for this period.</EmptyState>;

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="name"
            innerRadius="66%"
            outerRadius="88%"
            paddingAngle={1.5}
            stroke={SURFACE}
            strokeWidth={2}
            isAnimationActive={false}
            onClick={(entry: { name?: string }) =>
              onSelectGroup?.(entry?.name === selectedGroup ? null : entry?.name ?? null)
            }
          >
            {slices.map((s) => (
              <Cell
                key={s.name}
                fill={s.fill}
                opacity={selectedGroup && selectedGroup !== s.name ? 0.35 : 1}
                cursor={onSelectGroup ? "pointer" : undefined}
              />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip currency={currency} total={total} />} />
        </PieChart>
      </ResponsiveContainer>

      {/* The hero number belongs in the hole — it is what the donut is answering.
          Sized down and compacted past six figures so it stays inside the ring:
          a number that overflows its own hole is worse than one that is smaller.
          Solid gold rather than the sheen gradient, which clips unevenly across
          short text and reads as two different colours. */}
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="max-w-[42%] text-center">
          <p className="label">Total out</p>
          <p
            className={cx(
              "font-semibold leading-tight tabular-nums tracking-tight text-gold-300",
              total >= 1_000_000 ? "text-lg" : "text-xl",
            )}
          >
            {formatMoney(total, currency, { whole: true, compact: total >= 100_000 })}
          </p>
        </div>
      </div>

      <ul className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-[11px]">
        {slices.map((s) => (
          <li key={s.name}>
            <button
              onClick={() => onSelectGroup?.(s.name === selectedGroup ? null : s.name)}
              className={cx(
                "inline-flex items-center gap-1.5 transition",
                selectedGroup && selectedGroup !== s.name
                  ? "text-navy-300/60"
                  : "text-navy-100 hover:text-gold-300",
              )}
            >
              <span
                aria-hidden
                className="h-2 w-2 rounded-sm"
                style={{ backgroundColor: s.fill }}
              />
              {s.name}
              <span className="tabular-nums text-navy-300">
                {((s.value / total) * 100).toFixed(0)}%
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------ stacked area

/** Outflow across the year, by type.
 *
 * Transfers are excluded: they move money between the user's own pots and net
 * to zero, so including them would inflate every month's apparent outflow.
 */
export function OutflowTrend({
  points,
  currency,
}: {
  points: CashFlowPoint[];
  currency: string;
}) {
  const data = useMemo(() => {
    const byMonth = new Map<number, Record<string, number>>();
    for (const p of points) {
      const row = byMonth.get(p.month) ?? {};
      row[p.entry_type] = (row[p.entry_type] ?? 0) + Number(p.total);
      byMonth.set(p.month, row);
    }
    return MONTH_LABELS.map((label, i) => ({
      month: label,
      ...Object.fromEntries(OUTFLOW_TYPES.map((t) => [t, byMonth.get(i + 1)?.[t] ?? 0])),
    }));
  }, [points]);

  if (points.length === 0) return <EmptyState>No entries this year yet.</EmptyState>;

  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <XAxis
          dataKey="month"
          tick={{ fill: AXIS, fontSize: 11 }}
          axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: AXIS, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={52}
          // Bare numbers: repeating the currency on every tick is noise, and the
          // card's own heading already says which currency this is.
          tickFormatter={(v: number) =>
            new Intl.NumberFormat(undefined, {
              notation: "compact",
              maximumFractionDigits: 1,
            }).format(v)
          }
        />
        <Tooltip content={<ChartTooltip currency={currency} />} />
        <Legend
          wrapperStyle={{ fontSize: 11, color: AXIS }}
          formatter={(value: string) =>
            SERIES_LABEL[value as keyof typeof SERIES_LABEL] ?? value
          }
        />
        {OUTFLOW_TYPES.map((type) => (
          <Area
            key={type}
            type="monotone"
            dataKey={type}
            name={type}
            stackId="outflow"
            fill={SERIES[type]}
            fillOpacity={0.85}
            stroke={SEGMENT_GAP.stroke}
            strokeWidth={SEGMENT_GAP.strokeWidth}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ----------------------------------------------------------------- treemap

/** Every category at once, sized by spend, so the big ones are obvious without
 *  reading a single number. */
export function CategoryTreemap({
  rows,
  currency,
}: {
  rows: CategorySpend[];
  currency: string;
}) {
  const data = useMemo(() => {
    const byCategory = new Map<string, number>();
    for (const r of rows) {
      byCategory.set(
        r.category_name,
        (byCategory.get(r.category_name) ?? 0) + Number(r.total),
      );
    }
    return [...byCategory.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 24)
      .map(([name, size], i) => ({ name, size, fill: rampColor(Math.floor(i / 4)) }));
  }, [rows]);

  if (data.length === 0) return <EmptyState>Nothing to map yet.</EmptyState>;

  return (
    <ResponsiveContainer width="100%" height={280}>
      <Treemap
        data={data}
        dataKey="size"
        stroke={SURFACE}
        isAnimationActive={false}
        content={<TreemapCell currency={currency} />}
      >
        <Tooltip content={<ChartTooltip currency={currency} />} />
      </Treemap>
    </ResponsiveContainer>
  );
}

function TreemapCell(props: { currency?: string } & Record<string, unknown>) {
  const { x, y, width, height, name, size, fill, currency } = props as {
    x: number;
    y: number;
    width: number;
    height: number;
    name?: string;
    size?: number;
    fill?: string;
    currency?: string;
  };
  // Label only the tiles with room. A number on every tile is noise.
  const roomy = width > 74 && height > 40;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={4}
        fill={fill ?? "#4a5670"}
        stroke={SURFACE}
        strokeWidth={2}
      />
      {roomy && (
        <>
          <text x={x + 8} y={y + 18} fill="#050b18" fontSize={11} fontWeight={600}>
            {name}
          </text>
          <text x={x + 8} y={y + 33} fill="#050b18" fontSize={11} opacity={0.75}>
            {formatMoney(Number(size ?? 0), currency ?? "CAD", {
              whole: true,
              compact: true,
            })}
          </text>
        </>
      )}
    </g>
  );
}
