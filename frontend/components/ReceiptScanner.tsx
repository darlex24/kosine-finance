"use client";

import { motion } from "framer-motion";
import { useMemo, useState } from "react";

import { useCatalog } from "@/components/CatalogProvider";
import { Button, Combobox, Field, Pill, type Option } from "@/components/ui";
import { api, type OcrResult } from "@/lib/api";
import { GIVING_ARMS } from "@/lib/givingArms";
import { formatMoney, parseAmount } from "@/lib/money";
import { ENTRY_TYPES, type LedgerEntryType, type LedgerRow } from "@/lib/types";

/** Scan → review → commit.
 *
 * The model's reading is a draft, never the record: every field lands in an
 * editable form first, low-confidence extractions are flagged, and only what the
 * user confirms is written to the ledger.
 */
export function ReceiptScanner({
  onCommitted,
}: {
  onCommitted?: (row: LedgerRow) => void;
}) {
  const { categories, baseCurrency, currencies, arms } = useCatalog();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<OcrResult | null>(null);
  const [busy, setBusy] = useState<"scan" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // The editable draft, seeded from the extraction.
  const [date, setDate] = useState("");
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(baseCurrency);
  const [entryType, setEntryType] = useState<LedgerEntryType>("expense");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [givingArm, setGivingArm] = useState<string>("");

  const categoryOptions = useMemo<Option[]>(
    () =>
      categories
        .filter((c) => c.parent_id !== null)
        .map((c) => ({ value: c.id, label: c.name, group: c.group })),
    [categories],
  );

  const lowConfidence = (result?.confidence ?? 1) < 0.7;

  async function scan(next?: File) {
    if (!next) return;
    setFile(next);
    setBusy("scan");
    setError(null);
    setDone(null);
    try {
      const extracted = await api.scan(next);
      setResult(extracted);

      setDate(extracted.date ?? new Date().toISOString().slice(0, 10));
      setMerchant(extracted.merchant ?? "");
      setAmount(extracted.total != null ? String(Math.abs(extracted.total)) : "");
      setCurrency(extracted.currency || baseCurrency);
      setEntryType(extracted.document_type === "giving_statement" ? "giving" : "expense");
      setGivingArm(extracted.suggested_giving_arm ?? "");
      setCategoryId(
        categories.find((c) => c.slug === extracted.suggested_category_slug)?.id ?? null,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that document");
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    const parsed = parseAmount(amount);
    if (parsed == null || parsed === 0) {
      setError("Enter the amount before saving.");
      return;
    }
    setBusy("commit");
    setError(null);
    try {
      const row = await api.commitScan(
        {
          date,
          entry_type: entryType,
          amount: Math.abs(parsed),
          currency,
          category_id: categoryId,
          merchant: merchant.trim() || null,
          source: "ocr",
          ocr_confidence: result?.confidence ?? null,
          giving_arm: entryType === "giving" ? givingArm || null : null,
          giving_recipient: entryType === "giving" ? merchant.trim() || null : null,
          charity_registration_number: result?.charity_registration_number ?? null,
        },
        file ?? undefined,
      );
      onCommitted?.(row);
      setDone(`Saved ${formatMoney(Math.abs(parsed), currency)} to the ledger.`);
      setResult(null);
      setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that entry");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card space-y-4">
      <div>
        <p className="label">Scan a receipt</p>
        <p className="mt-1 text-sm text-navy-300">
          Any country, any currency, any language. Check what was read, then save it
          straight into the ledger.
        </p>
      </div>

      <label className="block cursor-pointer rounded-xl border border-dashed border-white/15 px-4 py-8 text-center transition hover:border-gold-500/50">
        <input
          type="file"
          accept="image/*,application/pdf"
          className="sr-only"
          onChange={(e) => void scan(e.target.files?.[0])}
        />
        <span className="text-sm text-navy-100">
          {busy === "scan" ? "Reading…" : "Choose or photograph a document"}
        </span>
      </label>

      {error && <p className="text-xs text-red-300">{error}</p>}
      {done && <p className="text-xs text-emerald-300">{done}</p>}

      {result && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          className="space-y-4 rounded-xl border border-white/5 bg-navy-950/50 p-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={lowConfidence ? "warn" : "ok"}>
              {Math.round(result.confidence * 100)}% confidence
            </Pill>
            <Pill tone="neutral">{result.document_type.replace("_", " ")}</Pill>
            {result.charity_registration_number && (
              <Pill tone="neutral">Reg. {result.charity_registration_number}</Pill>
            )}
          </div>

          {lowConfidence && (
            <p className="text-xs text-gold-300">
              This one was hard to read — check every field before saving.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Date">
              <input
                type="date"
                className="input"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field label="Merchant">
              <input
                className="input"
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
              />
            </Field>
            <Field label="Amount">
              <div className="flex gap-2">
                <select
                  className="input w-24"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
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
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
            </Field>
            <Field label="Type">
              <select
                className="input"
                value={entryType}
                onChange={(e) => setEntryType(e.target.value as LedgerEntryType)}
              >
                {ENTRY_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Category">
            <Combobox
              options={categoryOptions}
              value={categoryId}
              onChange={setCategoryId}
              placeholder={result.suggested_category ?? "Search categories…"}
            />
          </Field>

          {entryType === "giving" && (
            <Field
              label="Giving arm"
              hint="Receiptability is decided server-side from the arm and registration number."
            >
              <select
                className="input"
                value={givingArm}
                onChange={(e) => setGivingArm(e.target.value)}
              >
                <option value="">Not assigned</option>
                {(arms.length > 0 ? arms : GIVING_ARMS).map((arm) => (
                  <option key={arm.arm} value={arm.arm}>
                    {arm.display_name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {result.line_items.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-xs text-navy-300">
                {result.line_items.length} line items read
              </summary>
              <ul className="mt-2 divide-y divide-white/5">
                {result.line_items.map((item, i) => (
                  <li key={i} className="flex justify-between gap-3 py-1.5">
                    <span className="text-navy-100">{item.description}</span>
                    <span className="tabular-nums text-navy-300">
                      {formatMoney(item.amount, currency)}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {result.notes && <p className="text-xs text-navy-300">{result.notes}</p>}

          <div className="flex items-center gap-3">
            <Button variant="gold" disabled={busy === "commit"} onClick={() => void commit()}>
              {busy === "commit" ? "Saving…" : "Save to ledger"}
            </Button>
            <Button variant="quiet" onClick={() => setResult(null)}>
              Discard
            </Button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
