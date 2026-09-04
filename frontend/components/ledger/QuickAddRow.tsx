"use client";

import { useMemo, useState } from "react";

import { useCatalog } from "@/components/CatalogProvider";
import { Button, Combobox, type Option } from "@/components/ui";
import { parseAmount } from "@/lib/money";
import { ENTRY_TYPES, type LedgerDraft, type LedgerEntryType } from "@/lib/types";

const today = () => new Date().toISOString().slice(0, 10);

/** The always-present blank row at the top of the ledger.
 *
 * Deliberately not a modal: logging a coffee should take one line of typing and
 * an Enter, the same as it would in a spreadsheet.
 */
export function QuickAddRow({ onAdd }: { onAdd: (draft: LedgerDraft) => Promise<unknown> }) {
  const { categories, baseCurrency, currencies } = useCatalog();
  const [date, setDate] = useState(today());
  const [entryType, setEntryType] = useState<LedgerEntryType>("expense");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(baseCurrency);
  const [busy, setBusy] = useState(false);

  const categoryOptions = useMemo<Option[]>(
    () =>
      categories
        .filter((c) => c.parent_id !== null)
        .map((c) => ({ value: c.id, label: c.name, group: c.group })),
    [categories],
  );

  const parsed = parseAmount(amount);
  const canSubmit = parsed != null && parsed !== 0 && !busy;

  async function submit() {
    if (!canSubmit || parsed == null) return;
    setBusy(true);
    try {
      await onAdd({
        date,
        entry_type: entryType,
        amount: Math.abs(parsed),
        currency,
        category_id: categoryId,
        merchant: merchant.trim() || null,
      });
      // Keep date, type and currency — most people log several rows in a run.
      setMerchant("");
      setAmount("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex flex-wrap items-end gap-2 rounded-2xl border border-gold-500/20 bg-navy-900/60 p-3 shadow-card backdrop-blur"
      onKeyDown={(e) => {
        if (e.key === "Enter") void submit();
      }}
    >
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        aria-label="Date"
        className="input w-36"
      />
      <select
        value={entryType}
        onChange={(e) => setEntryType(e.target.value as LedgerEntryType)}
        aria-label="Entry type"
        className="input w-32"
      >
        {ENTRY_TYPES.map((type) => (
          <option key={type.value} value={type.value}>
            {type.label}
          </option>
        ))}
      </select>

      <Combobox
        className="w-52"
        options={categoryOptions}
        value={categoryId}
        onChange={setCategoryId}
        placeholder="Category"
      />

      <input
        value={merchant}
        onChange={(e) => setMerchant(e.target.value)}
        placeholder="Merchant or description"
        aria-label="Merchant"
        className="input min-w-[12rem] flex-1"
      />

      <select
        value={currency}
        onChange={(e) => setCurrency(e.target.value)}
        aria-label="Currency"
        className="input w-24"
      >
        {currencies.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code}
          </option>
        ))}
      </select>

      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="0.00"
        inputMode="decimal"
        aria-label="Amount"
        className="input w-28 text-right tabular-nums"
      />

      <Button variant="gold" disabled={!canSubmit} onClick={() => void submit()}>
        {busy ? "Adding…" : "Add"}
      </Button>
    </div>
  );
}
