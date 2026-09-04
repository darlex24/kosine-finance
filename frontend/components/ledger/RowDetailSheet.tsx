"use client";

import { useState } from "react";

import { Button, Field, Pill, Sheet } from "@/components/ui";
import { GIVING_ARMS, REALM_LABELS, type Realm } from "@/lib/givingArms";
import { formatAbs, formatMoney } from "@/lib/money";
import type { LedgerDraft, LedgerRow } from "@/lib/types";

/** Everything about one row that doesn't fit in a grid cell: the receipt image,
 *  tags, and — for giving rows — the ministry arm and charity registration that
 *  drive `kingdom_giving_records`. Also where a row gets deleted. */
export function RowDetailSheet({
  row,
  onClose,
  onEdit,
  onDelete,
}: {
  row: LedgerRow | null;
  onClose: () => void;
  onEdit: (id: string, patch: Partial<LedgerDraft>) => Promise<unknown>;
  onDelete: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!row) return null;

  const isGiving = row.entry_type === "giving";
  const arm = GIVING_ARMS.find((a) => a.arm === row.giving_arm);

  const patch = async (body: Partial<LedgerDraft>) => {
    setBusy(true);
    try {
      await onEdit(row.id, body);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title={row.merchant ?? "Ledger entry"}>
      <div className="space-y-6">
        <div>
          <p className="figure text-navy-50">{formatAbs(row.amount, row.currency)}</p>
          {row.currency !== row.base_currency && (
            <p className="mt-1 text-xs text-navy-300">
              {formatAbs(row.base_amount, row.base_currency)} at {Number(row.fx_rate).toFixed(4)}{" "}
              {row.currency}/{row.base_currency}, priced on {row.date}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Pill tone="neutral">{row.entry_type}</Pill>
            {row.category_name && <Pill tone="neutral">{row.category_name}</Pill>}
            {row.platform_name && <Pill tone="neutral">{row.platform_name}</Pill>}
            {row.source === "ocr" && (
              <Pill tone={(row.ocr_confidence ?? 0) >= 0.7 ? "neutral" : "warn"}>
                Scanned · {Math.round((row.ocr_confidence ?? 0) * 100)}%
              </Pill>
            )}
          </div>
        </div>

        {row.receipt_image_url && (
          <div>
            <p className="label mb-2">Receipt</p>
            {/* Signed Supabase Storage URL; next/image would need a remote pattern. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={row.receipt_image_url}
              alt={`Receipt for ${row.merchant ?? row.date}`}
              className="w-full rounded-xl border border-white/10"
            />
          </div>
        )}

        <Field label="Memo">
          <input
            className="input"
            defaultValue={row.memo ?? ""}
            onBlur={(e) => void patch({ memo: e.target.value || null })}
          />
        </Field>

        <Field label="Tags" hint="Comma separated">
          <input
            className="input"
            defaultValue={row.tags.join(", ")}
            onBlur={(e) =>
              void patch({
                tags: e.target.value
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean),
              })
            }
          />
        </Field>

        {isGiving && (
          <div className="space-y-4 rounded-xl border border-gold-500/20 bg-navy-950/40 p-4">
            <p className="label">Kingdom giving record</p>

            <Field label="Giving arm">
              <select
                className="input"
                defaultValue={row.giving_arm ?? ""}
                onChange={(e) => void patch({ giving_arm: e.target.value || null })}
              >
                <option value="">Not assigned</option>
                {GIVING_ARMS.map((option) => (
                  <option key={option.arm} value={option.arm}>
                    {option.display_name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Recipient">
              <input
                className="input"
                defaultValue={row.giving_recipient ?? ""}
                onBlur={(e) => void patch({ giving_recipient: e.target.value || null })}
              />
            </Field>

            <Field
              label="Charity registration number"
              hint="Receiptability is decided server-side from this and the arm."
            >
              <input
                className="input"
                defaultValue=""
                placeholder="e.g. 123456789RR0001"
                onBlur={(e) =>
                  e.target.value &&
                  void patch({ charity_registration_number: e.target.value })
                }
              />
            </Field>

            <div className="flex flex-wrap items-center gap-2">
              {arm && <Pill tone="gold">{REALM_LABELS[arm.realm as Realm]}</Pill>}
              <Pill tone={row.tax_deductible_flag ? "ok" : "warn"}>
                {row.tax_deductible_flag ? "Tax receiptable" : "Not receiptable"}
              </Pill>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-white/5 pt-4">
          <span className="text-[11px] text-navy-300">
            {row.base_currency} base · {formatMoney(row.base_amount, row.base_currency)}
          </span>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              onDelete(row.id);
              onClose();
            }}
          >
            Delete entry
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
