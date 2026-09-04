"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useCatalog } from "@/components/CatalogProvider";
import { Combobox, Pill, cx, type Option } from "@/components/ui";
import { formatAbs, formatMoney, parseAmount } from "@/lib/money";
import {
  ENTRY_TYPES,
  type LedgerDraft,
  type LedgerEntryType,
  type LedgerRow,
} from "@/lib/types";

/** The spreadsheet.
 *
 * A cell is either displayed or being edited; `focus` tracks the keyboard
 * position and `editing` tracks whether that cell is open. Enter commits, Escape
 * reverts, Tab walks right, arrows move. Every commit calls `onEdit`, which the
 * page routes through the optimistic mutation in `useLedger` — so a correction
 * lands on screen instantly and rolls back only if the server refuses it.
 */

type Column =
  | "date"
  | "entry_type"
  | "category"
  | "merchant"
  | "memo"
  | "platform"
  | "amount";

const COLUMNS: { key: Column; label: string; align?: "right" }[] = [
  { key: "date", label: "Date" },
  { key: "entry_type", label: "Type" },
  { key: "category", label: "Category" },
  { key: "merchant", label: "Merchant" },
  { key: "memo", label: "Memo" },
  { key: "platform", label: "Platform" },
  { key: "amount", label: "Amount", align: "right" },
];

const TYPE_TONE: Record<LedgerEntryType, string> = {
  expense: "text-navy-100",
  income: "text-emerald-300",
  giving: "text-gold-300",
  savings: "text-sky-300",
  investment: "text-violet-300",
  transfer: "text-navy-300",
};

export function LedgerGrid({
  rows,
  loading,
  selected,
  onSelectedChange,
  onEdit,
  onOpenRow,
}: {
  rows: LedgerRow[];
  loading: boolean;
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  onEdit: (id: string, patch: Partial<LedgerDraft>) => Promise<unknown>;
  onOpenRow: (row: LedgerRow) => void;
}) {
  const { categories, platforms, currencies } = useCatalog();
  const [focus, setFocus] = useState<{ row: number; col: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  const categoryOptions = useMemo<Option[]>(
    () =>
      categories
        .filter((c) => c.parent_id !== null)
        .map((c) => ({ value: c.id, label: c.name, group: c.group })),
    [categories],
  );
  const platformOptions = useMemo<Option[]>(
    () => platforms.map((p) => ({ value: p.id, label: p.name, group: p.kind })),
    [platforms],
  );

  const move = useCallback(
    (dRow: number, dCol: number) => {
      setFocus((current) => {
        if (!current) return { row: 0, col: 0 };
        return {
          row: Math.max(0, Math.min(rows.length - 1, current.row + dRow)),
          col: Math.max(0, Math.min(COLUMNS.length - 1, current.col + dCol)),
        };
      });
    },
    [rows.length],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!focus || editing) return;
      if (!gridRef.current?.contains(document.activeElement)) return;

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          move(1, 0);
          break;
        case "ArrowUp":
          event.preventDefault();
          move(-1, 0);
          break;
        case "ArrowRight":
          event.preventDefault();
          move(0, 1);
          break;
        case "ArrowLeft":
          event.preventDefault();
          move(0, -1);
          break;
        case "Tab":
          event.preventDefault();
          move(0, event.shiftKey ? -1 : 1);
          break;
        case "Enter":
          event.preventDefault();
          setEditing(true);
          break;
        default:
          break;
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [focus, editing, move]);

  const commit = useCallback(
    async (row: LedgerRow, patch: Partial<LedgerDraft>) => {
      setEditing(false);
      try {
        await onEdit(row.id, patch);
      } catch {
        // useLedger has already rolled the row back and surfaced the error.
      }
    },
    [onEdit],
  );

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange(next);
  };

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <div
      ref={gridRef}
      tabIndex={-1}
      className="overflow-x-auto rounded-2xl border border-white/5 bg-navy-900/60 shadow-card backdrop-blur"
    >
      <table className="w-full min-w-[62rem] border-collapse text-sm">
        <thead className="sticky top-0 z-20 bg-navy-900/95 backdrop-blur">
          <tr className="border-b border-white/10 text-left">
            <th className="w-10 px-3 py-3">
              <input
                type="checkbox"
                aria-label="Select all rows"
                checked={allSelected}
                onChange={() =>
                  onSelectedChange(allSelected ? new Set() : new Set(rows.map((r) => r.id)))
                }
                className="h-3.5 w-3.5 accent-gold-500"
              />
            </th>
            {COLUMNS.map((column) => (
              <th
                key={column.key}
                className={cx(
                  "px-3 py-3 text-[11px] font-medium uppercase tracking-[0.14em] text-navy-300",
                  column.align === "right" && "text-right",
                  column.key === "date" &&
                    "sticky left-0 z-10 bg-navy-900/95 backdrop-blur",
                )}
              >
                {column.label}
              </th>
            ))}
            <th className="w-24 px-3 py-3 text-right text-[11px] font-medium uppercase tracking-[0.14em] text-navy-300">
              Base
            </th>
            <th className="w-16 px-3 py-3" aria-label="Row actions" />
          </tr>
        </thead>

        <tbody>
          {rows.map((row, rowIndex) => {
            const isSelected = selected.has(row.id);
            return (
              <tr
                key={row.id}
                className={cx(
                  "border-b border-white/5 transition-colors",
                  isSelected ? "bg-gold-500/[0.07]" : "hover:bg-white/[0.03]",
                )}
              >
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label={`Select row of ${row.merchant ?? row.date}`}
                    checked={isSelected}
                    onChange={() => toggle(row.id)}
                    className="h-3.5 w-3.5 accent-gold-500"
                  />
                </td>

                {COLUMNS.map((column, colIndex) => {
                  const isFocused = focus?.row === rowIndex && focus?.col === colIndex;
                  const isEditing = isFocused && editing;
                  return (
                    <td
                      key={column.key}
                      tabIndex={0}
                      onFocus={() => setFocus({ row: rowIndex, col: colIndex })}
                      onClick={() => {
                        setFocus({ row: rowIndex, col: colIndex });
                        setEditing(true);
                      }}
                      className={cx(
                        "cursor-text px-3 py-2 align-middle outline-none",
                        column.align === "right" && "text-right tabular-nums",
                        column.key === "date" &&
                          "sticky left-0 z-10 bg-navy-900/80 backdrop-blur",
                        isFocused && "ring-2 ring-inset ring-gold-500/60",
                      )}
                    >
                      <Cell
                        row={row}
                        column={column.key}
                        editing={isEditing}
                        categoryOptions={categoryOptions}
                        platformOptions={platformOptions}
                        currencyCodes={currencies.map((c) => c.code)}
                        onCommit={(patch) => commit(row, patch)}
                        onCancel={() => setEditing(false)}
                      />
                    </td>
                  );
                })}

                <td className="px-3 py-2 text-right text-xs tabular-nums text-navy-300">
                  {row.currency !== row.base_currency
                    ? formatAbs(row.base_amount, row.base_currency)
                    : "—"}
                </td>

                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => onOpenRow(row)}
                    className="text-xs text-navy-300 transition hover:text-gold-300"
                  >
                    {row.receipt_image_url ? "Receipt" : "Open"}
                  </button>
                </td>
              </tr>
            );
          })}

          {rows.length === 0 && !loading && (
            <tr>
              <td colSpan={COLUMNS.length + 3} className="px-4 py-16 text-center">
                <p className="text-sm text-navy-100">Nothing logged yet.</p>
                <p className="mt-1 text-xs text-navy-300">
                  Add a row above, or scan a receipt and it will land here.
                </p>
              </td>
            </tr>
          )}

          {loading && rows.length === 0 && (
            <tr>
              <td colSpan={COLUMNS.length + 3} className="px-4 py-16 text-center text-sm text-navy-300">
                Loading the ledger…
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// -------------------------------------------------------------------- cell

function Cell({
  row,
  column,
  editing,
  categoryOptions,
  platformOptions,
  currencyCodes,
  onCommit,
  onCancel,
}: {
  row: LedgerRow;
  column: Column;
  editing: boolean;
  categoryOptions: Option[];
  platformOptions: Option[];
  currencyCodes: string[];
  onCommit: (patch: Partial<LedgerDraft>) => void;
  onCancel: () => void;
}) {
  if (!editing) return <ReadCell row={row} column={column} />;

  switch (column) {
    case "date":
      return (
        <input
          type="date"
          autoFocus
          defaultValue={row.date}
          className="w-full bg-transparent text-sm outline-none"
          onBlur={(e) => onCommit({ date: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommit({ date: e.currentTarget.value });
            if (e.key === "Escape") onCancel();
          }}
        />
      );

    case "entry_type":
      return (
        <select
          autoFocus
          defaultValue={row.entry_type}
          className="w-full bg-navy-900 text-sm outline-none"
          onChange={(e) => onCommit({ entry_type: e.target.value as LedgerEntryType })}
          onKeyDown={(e) => e.key === "Escape" && onCancel()}
        >
          {ENTRY_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
      );

    case "category":
      return (
        <Combobox
          autoFocus
          className="min-w-[12rem]"
          options={categoryOptions}
          value={row.category_id}
          onChange={(value) => onCommit({ category_id: value })}
          onDismiss={onCancel}
          placeholder="Search categories…"
        />
      );

    case "platform":
      return (
        <Combobox
          autoFocus
          className="min-w-[11rem]"
          options={platformOptions}
          value={row.platform_id}
          onChange={(value) => onCommit({ platform_id: value })}
          onDismiss={onCancel}
          placeholder="Search platforms…"
        />
      );

    case "amount":
      return (
        <AmountEditor
          row={row}
          currencyCodes={currencyCodes}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      );

    default: {
      const field = column as "merchant" | "memo";
      return (
        <input
          autoFocus
          defaultValue={row[field] ?? ""}
          className="w-full bg-transparent text-sm outline-none"
          onBlur={(e) => onCommit({ [field]: e.target.value || null })}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommit({ [field]: e.currentTarget.value || null });
            if (e.key === "Escape") onCancel();
          }}
        />
      );
    }
  }
}

function ReadCell({ row, column }: { row: LedgerRow; column: Column }) {
  switch (column) {
    case "date":
      return <span className="tabular-nums text-navy-100">{row.date}</span>;

    case "entry_type":
      return (
        <span className={cx("text-xs font-medium capitalize", TYPE_TONE[row.entry_type])}>
          {row.entry_type}
        </span>
      );

    case "category":
      return row.category_name ? (
        <span className="text-navy-100">
          {row.category_name}
          <span className="ml-2 text-[10px] uppercase tracking-wide text-navy-300">
            {row.category_group}
          </span>
        </span>
      ) : (
        <span className="text-navy-300">Uncategorised</span>
      );

    case "merchant":
      return (
        <span className="flex items-center gap-2 text-navy-100">
          {row.merchant ?? <span className="text-navy-300">—</span>}
          {row.source === "ocr" && row.ocr_confidence != null && row.ocr_confidence < 0.7 && (
            <Pill tone="warn">Check</Pill>
          )}
        </span>
      );

    case "memo":
      return <span className="text-navy-300">{row.memo ?? "—"}</span>;

    case "platform":
      return <span className="text-navy-100">{row.platform_name ?? "—"}</span>;

    case "amount":
      return (
        <span className={row.amount < 0 ? "text-navy-50" : "text-emerald-300"}>
          {formatAbs(row.amount, row.currency)}
        </span>
      );

    default:
      return null;
  }
}

function AmountEditor({
  row,
  currencyCodes,
  onCommit,
  onCancel,
}: {
  row: LedgerRow;
  currencyCodes: string[];
  onCommit: (patch: Partial<LedgerDraft>) => void;
  onCancel: () => void;
}) {
  const [raw, setRaw] = useState(String(Math.abs(row.amount)));
  const [currency, setCurrency] = useState(row.currency);
  const parsed = parseAmount(raw);

  const submit = () => {
    if (parsed == null) return onCancel();
    onCommit({ amount: Math.abs(parsed), currency });
  };

  return (
    <div className="flex items-center justify-end gap-1.5">
      <select
        value={currency}
        onChange={(e) => setCurrency(e.target.value)}
        className="bg-navy-900 text-[11px] uppercase text-navy-300 outline-none"
        aria-label="Currency"
      >
        {currencyCodes.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
      <input
        autoFocus
        inputMode="decimal"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={submit}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onCancel();
        }}
        className="w-24 bg-transparent text-right text-sm tabular-nums outline-none"
      />
      {parsed != null && currency !== row.base_currency && (
        <span className="text-[10px] text-navy-300">
          ≈ {formatMoney(parsed * row.fx_rate, row.base_currency)}
        </span>
      )}
    </div>
  );
}
