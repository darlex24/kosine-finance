"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useCatalog } from "@/components/CatalogProvider";
import { Button, Card, Combobox, Pill, SectionHeading, cx, type Option } from "@/components/ui";
import { api, type OcrResult } from "@/lib/api";
import { GIVING_ARMS } from "@/lib/givingArms";
import { formatMoney, parseAmount } from "@/lib/money";
import { ENTRY_TYPES, type LedgerEntryType } from "@/lib/types";

/** Bulk capture.
 *
 * There is no API that reaches into Apple Notes, and Google Keep's is
 * Workspace-only — but every notes app can copy or export an image. So this
 * takes images the way they actually leave those apps: paste from the
 * clipboard, drag a batch in, or pick several files at once. Each is read,
 * shown for correction, and written to the ledger only when you approve it.
 */

type Status = "queued" | "scanning" | "ready" | "saved" | "error";

type Item = {
  id: string;
  file: File;
  preview: string;
  status: Status;
  error?: string;
  result?: OcrResult;
  // Editable draft, seeded from the extraction.
  date: string;
  merchant: string;
  amount: string;
  currency: string;
  entryType: LedgerEntryType;
  categoryId: string | null;
  givingArm: string;
};

const today = () => new Date().toISOString().slice(0, 10);
let seq = 0;

export default function CapturePage() {
  const { categories, currencies, baseCurrency, invalidate, ready } = useCatalog();
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const categoryOptions = useMemo<Option[]>(
    () =>
      categories
        .filter((c) => c.parent_id !== null)
        .map((c) => ({ value: c.id, label: c.name, group: c.group })),
    [categories],
  );

  const add = useCallback(
    (files: File[]) => {
      const usable = files.filter(
        (f) => f.type.startsWith("image/") || f.type === "application/pdf",
      );
      if (usable.length === 0) return;
      setItems((current) => [
        ...current,
        ...usable.map((file) => ({
          id: `item-${++seq}`,
          file,
          preview: URL.createObjectURL(file),
          status: "queued" as Status,
          date: today(),
          merchant: "",
          amount: "",
          currency: baseCurrency,
          entryType: "expense" as LedgerEntryType,
          categoryId: null,
          givingArm: "",
        })),
      ]);
    },
    [baseCurrency],
  );

  // Paste straight from the clipboard — the shortest path out of any notes app.
  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const files = [...(event.clipboardData?.items ?? [])]
        .filter((i) => i.kind === "file")
        .map((i) => i.getAsFile())
        .filter((f): f is File => f !== null);
      if (files.length) {
        event.preventDefault();
        add(files);
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [add]);

  // Release the object URLs when the page goes away.
  useEffect(
    () => () => {
      for (const item of items) URL.revokeObjectURL(item.preview);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const patch = (id: string, changes: Partial<Item>) =>
    setItems((current) => current.map((i) => (i.id === id ? { ...i, ...changes } : i)));

  /** Scan sequentially — a burst of parallel vision calls just trips rate limits. */
  async function scanAll() {
    setRunning(true);
    try {
      for (const item of items.filter((i) => i.status === "queued")) {
        patch(item.id, { status: "scanning", error: undefined });
        try {
          const result = await api.scan(item.file);
          patch(item.id, {
            status: "ready",
            result,
            date: result.date ?? today(),
            merchant: result.merchant ?? "",
            amount: result.total != null ? String(Math.abs(result.total)) : "",
            currency: result.currency || baseCurrency,
            entryType:
              result.document_type === "giving_statement" ? "giving" : "expense",
            givingArm: result.suggested_giving_arm ?? "",
            categoryId:
              categories.find((c) => c.slug === result.suggested_category_slug)?.id ?? null,
          });
        } catch (err) {
          patch(item.id, {
            status: "error",
            error: err instanceof Error ? err.message : "Could not read that document",
          });
        }
      }
    } finally {
      setRunning(false);
    }
  }

  async function save(item: Item) {
    const parsed = parseAmount(item.amount);
    if (parsed == null || parsed === 0) {
      patch(item.id, { error: "Enter the amount before saving." });
      return;
    }
    try {
      await api.commitScan(
        {
          date: item.date,
          entry_type: item.entryType,
          amount: Math.abs(parsed),
          currency: item.currency,
          category_id: item.categoryId,
          merchant: item.merchant.trim() || null,
          source: "ocr",
          ocr_confidence: item.result?.confidence ?? null,
          giving_arm: item.entryType === "giving" ? item.givingArm || null : null,
          giving_recipient:
            item.entryType === "giving" ? item.merchant.trim() || null : null,
          charity_registration_number: item.result?.charity_registration_number ?? null,
        },
        item.file,
      );
      patch(item.id, { status: "saved", error: undefined });
      invalidate();
    } catch (err) {
      patch(item.id, {
        error: err instanceof Error ? err.message : "Could not save that entry",
      });
    }
  }

  async function saveAll() {
    for (const item of items.filter((i) => i.status === "ready")) await save(item);
  }

  const counts = {
    queued: items.filter((i) => i.status === "queued").length,
    ready: items.filter((i) => i.status === "ready").length,
    saved: items.filter((i) => i.status === "saved").length,
    error: items.filter((i) => i.status === "error").length,
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Bulk <span className="gold-text">capture</span>
        </h1>
        <p className="mt-1 text-sm text-navy-300">
          Receipts, cheques and giving statements from anywhere — your notes app,
          camera roll, email. Paste, drop or choose several at once.
        </p>
      </header>

      {/* ------------------------------------------------------- drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          add([...e.dataTransfer.files]);
        }}
        onClick={() => inputRef.current?.click()}
        className={cx(
          "cursor-pointer rounded-2xl border-2 border-dashed px-6 py-12 text-center transition",
          dragging
            ? "border-gold-500/70 bg-gold-500/[0.06]"
            : "border-white/15 hover:border-gold-500/50",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,application/pdf"
          className="sr-only"
          onChange={(e) => {
            add([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        <p className="text-sm text-navy-50">Drop images here, or click to choose</p>
        <p className="mt-1.5 text-xs text-navy-300">
          You can also press <kbd className="rounded bg-white/10 px-1.5 py-0.5">Ctrl</kbd>
          {" + "}
          <kbd className="rounded bg-white/10 px-1.5 py-0.5">V</kbd> to paste a screenshot
          copied from Notes, Keep, OneNote or anywhere else.
        </p>
      </div>

      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="gold" onClick={() => void scanAll()} disabled={running || !counts.queued}>
            {running ? "Reading…" : `Read ${counts.queued || ""} queued`.trim()}
          </Button>
          <Button onClick={() => void saveAll()} disabled={!counts.ready}>
            Save {counts.ready || ""} to ledger
          </Button>
          <Button
            variant="quiet"
            onClick={() => {
              for (const i of items) URL.revokeObjectURL(i.preview);
              setItems([]);
            }}
          >
            Clear
          </Button>
          <span className="text-xs text-navy-300">
            {counts.saved} saved · {counts.ready} ready · {counts.queued} queued
            {counts.error > 0 && ` · ${counts.error} failed`}
          </span>
        </div>
      )}

      {items.length === 0 && !ready && (
        <Card className="text-sm text-navy-300">Loading your categories…</Card>
      )}

      {/* ----------------------------------------------------------- queue */}
      <div className="space-y-3">
        {items.map((item) => (
          <Card key={item.id} className={cx(item.status === "saved" && "opacity-60")}>
            <div className="flex flex-wrap gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.preview}
                alt={item.file.name}
                className="h-28 w-24 shrink-0 rounded-lg border border-white/10 object-cover"
              />

              <div className="min-w-[16rem] flex-1 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm text-navy-50">{item.file.name}</span>
                  {item.status === "queued" && <Pill tone="neutral">Queued</Pill>}
                  {item.status === "scanning" && <Pill tone="gold">Reading…</Pill>}
                  {item.status === "saved" && <Pill tone="ok">Saved</Pill>}
                  {item.status === "error" && <Pill tone="warn">Failed</Pill>}
                  {item.result && (
                    <Pill tone={item.result.confidence >= 0.7 ? "ok" : "warn"}>
                      {Math.round(item.result.confidence * 100)}% confidence
                    </Pill>
                  )}
                </div>

                {item.error && <p className="text-xs text-red-300">{item.error}</p>}

                {(item.status === "ready" || item.status === "saved") && (
                  <>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      <input
                        type="date"
                        className="input"
                        value={item.date}
                        disabled={item.status === "saved"}
                        onChange={(e) => patch(item.id, { date: e.target.value })}
                        aria-label="Date"
                      />
                      <input
                        className="input"
                        placeholder="Merchant"
                        value={item.merchant}
                        disabled={item.status === "saved"}
                        onChange={(e) => patch(item.id, { merchant: e.target.value })}
                        aria-label="Merchant"
                      />
                      <div className="flex gap-2">
                        <select
                          className="input w-24"
                          value={item.currency}
                          disabled={item.status === "saved"}
                          onChange={(e) => patch(item.id, { currency: e.target.value })}
                          aria-label="Currency"
                        >
                          {currencies.map((c) => (
                            <option key={c.code} value={c.code}>
                              {c.code}
                            </option>
                          ))}
                        </select>
                        <input
                          className="input text-right tabular-nums"
                          inputMode="decimal"
                          placeholder="0.00"
                          value={item.amount}
                          disabled={item.status === "saved"}
                          onChange={(e) => patch(item.id, { amount: e.target.value })}
                          aria-label="Amount"
                        />
                      </div>
                      <select
                        className="input"
                        value={item.entryType}
                        disabled={item.status === "saved"}
                        onChange={(e) =>
                          patch(item.id, { entryType: e.target.value as LedgerEntryType })
                        }
                        aria-label="Entry type"
                      >
                        {ENTRY_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      {item.status !== "saved" && (
                        <Combobox
                          options={categoryOptions}
                          value={item.categoryId}
                          onChange={(value) => patch(item.id, { categoryId: value })}
                          placeholder={item.result?.suggested_category ?? "Category"}
                        />
                      )}
                      {item.entryType === "giving" && item.status !== "saved" && (
                        <select
                          className="input"
                          value={item.givingArm}
                          onChange={(e) => patch(item.id, { givingArm: e.target.value })}
                          aria-label="Giving arm"
                        >
                          <option value="">Giving arm — not assigned</option>
                          {GIVING_ARMS.map((arm) => (
                            <option key={arm.arm} value={arm.arm}>
                              {arm.display_name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    {item.status === "ready" && (
                      <div className="flex items-center gap-3">
                        <Button variant="gold" onClick={() => void save(item)}>
                          Save to ledger
                        </Button>
                        {parseAmount(item.amount) != null && (
                          <span className="text-xs text-navy-300">
                            {formatMoney(parseAmount(item.amount) ?? 0, item.currency)}
                          </span>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
