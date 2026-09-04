"use client";

import { motion } from "framer-motion";
import { useState } from "react";

import { api, type OcrResult } from "@/lib/api";
import { GIVING_ARMS, cad } from "@/lib/givingArms";

/** Drop a receipt or church giving statement; GPT-4o Vision reads it. */
export function ReceiptScanner() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OcrResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handle(file?: File) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api.scan(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that document");
    } finally {
      setBusy(false);
    }
  }

  const armName = (value: string | null) =>
    GIVING_ARMS.find((a) => a.arm === value)?.display_name ?? value ?? "—";

  return (
    <div className="card space-y-4">
      <div>
        <p className="label">Scan</p>
        <p className="mt-1 text-sm text-navy-300">
          Receipt or church giving statement — each line is matched to its arm.
        </p>
      </div>

      <label className="block cursor-pointer rounded-xl border border-dashed border-white/15 px-4 py-8 text-center transition hover:border-gold-500/50">
        <input
          type="file"
          accept="image/*,application/pdf"
          className="sr-only"
          onChange={(e) => handle(e.target.files?.[0])}
        />
        <span className="text-sm text-navy-100">
          {busy ? "Reading…" : "Choose or photograph a document"}
        </span>
      </label>

      {error && <p className="text-xs text-red-300">{error}</p>}

      {result && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-3 rounded-xl border border-white/5 bg-navy-950/50 p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-white">{result.merchant ?? "Unknown"}</p>
              <p className="text-xs text-navy-300">
                {result.date ?? "no date"} · {result.document_type.replace("_", " ")} ·{" "}
                {Math.round(result.confidence * 100)}% confidence
              </p>
            </div>
            <p className="text-lg font-semibold tabular-nums text-gold-300">
              {result.total != null ? cad(result.total) : "—"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className={result.tax_deductible_flag ? "pill-ok" : "pill-warn"}>
              {result.tax_deductible_flag ? "Tax receiptable" : "Not receiptable"}
            </span>
            {result.suggested_giving_arm && (
              <span className="pill bg-white/5 text-navy-100">
                {armName(result.suggested_giving_arm)}
              </span>
            )}
            {result.charity_registration_number && (
              <span className="pill bg-white/5 text-navy-100">
                BN {result.charity_registration_number}
              </span>
            )}
          </div>

          {result.line_items.length > 0 && (
            <ul className="divide-y divide-white/5 text-sm">
              {result.line_items.map((item, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-navy-100">
                    {item.description}
                    {item.suggested_giving_arm && (
                      <span className="ml-2 text-xs text-gold-300">
                        {armName(item.suggested_giving_arm)}
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums">{cad(item.amount)}</span>
                </li>
              ))}
            </ul>
          )}

          {result.notes && <p className="text-xs text-navy-300">{result.notes}</p>}
        </motion.div>
      )}
    </div>
  );
}
