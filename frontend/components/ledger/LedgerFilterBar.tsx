"use client";

import { useCatalog } from "@/components/CatalogProvider";
import { Button } from "@/components/ui";
import { useYears } from "@/components/YearPicker";
import { ENTRY_TYPES, type LedgerEntryType, type LedgerFilters } from "@/lib/types";

export function LedgerFilterBar({
  filters,
  onChange,
}: {
  filters: LedgerFilters;
  onChange: (next: LedgerFilters) => void;
}) {
  const { categories, platforms, currencies } = useCatalog();
  const { years } = useYears();
  const set = (patch: Partial<LedgerFilters>) => onChange({ ...filters, ...patch });
  const active = Object.values(filters).some(Boolean);

  // The date range is the source of truth; this just sets both ends at once.
  const selectedYear =
    filters.date_from?.slice(0, 4) === filters.date_to?.slice(0, 4)
      ? (filters.date_from?.slice(0, 4) ?? "")
      : "";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={selectedYear}
        onChange={(e) =>
          set(
            e.target.value
              ? { date_from: `${e.target.value}-01-01`, date_to: `${e.target.value}-12-31` }
              : { date_from: undefined, date_to: undefined },
          )
        }
        aria-label="Year"
        className="input w-28"
      >
        <option value="">All years</option>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>

      <input
        value={filters.q ?? ""}
        onChange={(e) => set({ q: e.target.value || undefined })}
        placeholder="Search merchant or memo"
        aria-label="Search the ledger"
        className="input w-56"
      />
      <input
        type="date"
        value={filters.date_from ?? ""}
        onChange={(e) => set({ date_from: e.target.value || undefined })}
        aria-label="From date"
        className="input w-36"
      />
      <input
        type="date"
        value={filters.date_to ?? ""}
        onChange={(e) => set({ date_to: e.target.value || undefined })}
        aria-label="To date"
        className="input w-36"
      />

      <select
        value={filters.entry_type ?? ""}
        onChange={(e) =>
          set({ entry_type: (e.target.value || undefined) as LedgerEntryType | undefined })
        }
        aria-label="Entry type"
        className="input w-32"
      >
        <option value="">All types</option>
        {ENTRY_TYPES.map((type) => (
          <option key={type.value} value={type.value}>
            {type.label}
          </option>
        ))}
      </select>

      <select
        value={filters.category_id ?? ""}
        onChange={(e) => set({ category_id: e.target.value || undefined })}
        aria-label="Category"
        className="input w-44"
      >
        <option value="">All categories</option>
        {categories
          .filter((c) => c.parent_id !== null)
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.group} · {c.name}
            </option>
          ))}
      </select>

      <select
        value={filters.platform_id ?? ""}
        onChange={(e) => set({ platform_id: e.target.value || undefined })}
        aria-label="Platform"
        className="input w-40"
      >
        <option value="">All platforms</option>
        {platforms.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      <select
        value={filters.currency ?? ""}
        onChange={(e) => set({ currency: e.target.value || undefined })}
        aria-label="Currency"
        className="input w-28"
      >
        <option value="">All ccy</option>
        {currencies.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code}
          </option>
        ))}
      </select>

      {active && (
        <Button variant="quiet" onClick={() => onChange({})}>
          Clear
        </Button>
      )}
    </div>
  );
}
