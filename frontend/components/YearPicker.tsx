"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { cx } from "@/components/ui";

/** Year selector, shared by the dashboard and the giving page.
 *
 * The options come from `/api/years`, which lists only years that actually have
 * entries (plus the current year), so the control never offers an empty year.
 */
export function useYears(): { years: number[]; ready: boolean } {
  const [years, setYears] = useState<number[]>([new Date().getFullYear()]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api
      .years()
      .then((list) => {
        if (list.length) setYears(list);
      })
      .catch(() => {
        /* Fall back to the current year; the picker still works. */
      })
      .finally(() => setReady(true));
  }, []);

  return { years, ready };
}

export function YearPicker({
  years,
  value,
  onChange,
  className,
}: {
  years: number[];
  value: number;
  onChange: (year: number) => void;
  className?: string;
}) {
  // A handful of years reads better as tabs; a long history needs a select.
  if (years.length > 6) {
    return (
      <select
        aria-label="Year"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cx("input w-28", className)}
      >
        {years.map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div
      role="tablist"
      aria-label="Year"
      className={cx(
        "flex items-center gap-1 rounded-full border border-white/5 bg-navy-900/60 p-1 text-sm",
        className,
      )}
    >
      {years.map((year) => {
        const active = year === value;
        return (
          <button
            key={year}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(year)}
            className={cx(
              "rounded-full px-3.5 py-1 tabular-nums transition",
              active
                ? "bg-gold-500/15 text-gold-200"
                : "text-navy-300 hover:bg-white/5 hover:text-gold-300",
            )}
          >
            {year}
          </button>
        );
      })}
    </div>
  );
}
