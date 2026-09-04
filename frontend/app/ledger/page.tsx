"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";

import { useCatalog } from "@/components/CatalogProvider";
import { LedgerFilterBar } from "@/components/ledger/LedgerFilterBar";
import { LedgerGrid } from "@/components/ledger/LedgerGrid";
import { QuickAddRow } from "@/components/ledger/QuickAddRow";
import { RowDetailSheet } from "@/components/ledger/RowDetailSheet";
import { ReceiptScanner } from "@/components/ReceiptScanner";
import { Button, Card, Toast, useToast } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { useLedger } from "@/lib/useLedger";
import type { LedgerFilters, LedgerRow } from "@/lib/types";

export default function LedgerPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<p className="text-sm text-navy-300">Loading the ledger…</p>}>
      <Ledger />
    </Suspense>
  );
}

function Ledger() {
  const { baseCurrency, ready } = useCatalog();
  const params = useSearchParams();

  // Seed from the URL so the expenses page can drill straight into a category.
  const [filters, setFilters] = useState<LedgerFilters>(() => {
    const seed: LedgerFilters = {};
    for (const key of [
      "category_id", "platform_id", "account_id", "currency", "q", "date_from", "date_to",
    ] as const) {
      const value = params.get(key);
      if (value) seed[key] = value;
    }
    const entryType = params.get("entry_type");
    if (entryType) seed.entry_type = entryType as LedgerFilters["entry_type"];
    return seed;
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openRow, setOpenRow] = useState<LedgerRow | null>(null);
  const toast = useToast();

  const ledger = useLedger(filters);

  // Totals for what is currently on screen, so a filtered view answers "how much
  // did this cost me" without a separate report.
  const totals = useMemo(() => {
    let out = 0;
    let inn = 0;
    for (const row of ledger.rows) {
      if (row.base_amount < 0) out += Math.abs(row.base_amount);
      else inn += row.base_amount;
    }
    return { out, inn };
  }, [ledger.rows]);

  async function handleDelete(ids: string[]) {
    try {
      const removed = await ledger.remove(ids);
      setSelected(new Set());
      toast.show(`${ids.length} ${ids.length === 1 ? "entry" : "entries"} deleted`, {
        label: "Undo",
        onClick: () => void ledger.restore(removed),
      });
    } catch {
      toast.show("Could not delete — the rows have been put back");
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Omni-Ledger</h1>
          <p className="mt-1 text-sm text-navy-300">
            Every expense, gift, saving and investment — in whatever currency you spent it.
          </p>
        </div>
        <div className="flex items-center gap-4 text-right">
          <div>
            <p className="label">Out</p>
            <p className="text-sm font-semibold tabular-nums text-navy-50">
              {formatMoney(totals.out, baseCurrency, { whole: true })}
            </p>
          </div>
          <div>
            <p className="label">In</p>
            <p className="text-sm font-semibold tabular-nums text-emerald-300">
              {formatMoney(totals.inn, baseCurrency, { whole: true })}
            </p>
          </div>
        </div>
      </header>

      {ledger.error && (
        <Card className="border-red-400/20 text-sm text-red-300">
          {ledger.error}
          <button onClick={ledger.clearError} className="ml-3 text-xs underline">
            Dismiss
          </button>
        </Card>
      )}

      {ready && <QuickAddRow onAdd={ledger.create} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <LedgerFilterBar filters={filters} onChange={setFilters} />
        {selected.size > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-navy-300">{selected.size} selected</span>
            <Button variant="danger" onClick={() => void handleDelete([...selected])}>
              Delete
            </Button>
          </div>
        )}
      </div>

      <LedgerGrid
        rows={ledger.rows}
        loading={ledger.loading}
        selected={selected}
        onSelectedChange={setSelected}
        onEdit={ledger.update}
        onOpenRow={setOpenRow}
      />

      {ledger.hasMore && (
        <div className="flex justify-center">
          <Button onClick={() => void ledger.loadMore()} disabled={ledger.loading}>
            {ledger.loading ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <ReceiptScanner
          onCommitted={(row) => {
            ledger.insert(row);
            toast.show("Receipt added to the ledger");
          }}
        />
        <Card>
          <p className="label">Working the grid</p>
          <ul className="mt-3 space-y-2 text-sm text-navy-300">
            <li>Click any cell to edit it — changes save as you go.</li>
            <li>Arrow keys move, Enter opens a cell, Escape reverts it.</li>
            <li>
              Changing an amount, currency or date re-prices the row against that
              day&apos;s exchange rate.
            </li>
            <li>Deletes are undoable for a few seconds.</li>
          </ul>
        </Card>
      </div>

      <RowDetailSheet
        row={openRow}
        onClose={() => setOpenRow(null)}
        onEdit={ledger.update}
        onDelete={(id) => void handleDelete([id])}
      />

      <Toast message={toast.message} action={toast.action} onDismiss={toast.dismiss} />
    </div>
  );
}
