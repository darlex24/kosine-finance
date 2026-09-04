"use client";

import { motion } from "framer-motion";
import { useMemo, useState } from "react";

import { api } from "@/lib/api";
import {
  GIVING_ARMS,
  REALM_LABELS,
  REALM_ORDER,
  cad,
  isReceiptable,
  type Realm,
} from "@/lib/givingArms";

/** Record a gift against any arm, with live CRA receiptability feedback. */
export function GivingForm({ onSaved }: { onSaved?: () => void }) {
  const [realm, setRealm] = useState<Realm>("core_covenant");
  const [arm, setArm] = useState("tithe");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [charityNumber, setCharityNumber] = useState("");
  const [pledgeStatus, setPledgeStatus] = useState("not_applicable");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const armsInRealm = useMemo(
    () => GIVING_ARMS.filter((a) => a.realm === realm),
    [realm],
  );
  const selected = GIVING_ARMS.find((a) => a.arm === arm) ?? GIVING_ARMS[0];
  const receiptable = isReceiptable(selected, charityNumber);

  function pickRealm(next: Realm) {
    setRealm(next);
    const first = GIVING_ARMS.find((a) => a.realm === next);
    if (first) setArm(first.arm);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.recordGiving({
        giving_arm: arm,
        amount: Number(amount),
        recipient: recipient || null,
        charity_registration_number: charityNumber || null,
        pledge_fulfilled_status: pledgeStatus,
        date: new Date().toISOString().slice(0, 10),
      });
      setAmount("");
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record this gift");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-5">
      <div>
        <p className="label mb-2">Realm of giving</p>
        <div className="flex flex-wrap gap-2">
          {REALM_ORDER.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => pickRealm(r)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
                realm === r
                  ? "bg-gold-500 text-navy-950"
                  : "border border-white/10 text-navy-100 hover:border-gold-500/40"
              }`}
            >
              {REALM_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="label mb-2">Arm</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {armsInRealm.map((a) => (
            <motion.button
              key={a.arm}
              type="button"
              whileTap={{ scale: 0.98 }}
              onClick={() => setArm(a.arm)}
              className={`rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                arm === a.arm
                  ? "border-gold-500/60 bg-gold-500/10 text-gold-100"
                  : "border-white/10 text-navy-100 hover:border-white/25"
              }`}
            >
              {a.display_name}
            </motion.button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">Amount (CAD)</span>
          <input
            className="input mt-1.5"
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
          />
        </label>
        <label className="block">
          <span className="label">Recipient</span>
          <input
            className="input mt-1.5"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="Christ Embassy Toronto"
          />
        </label>
        <label className="block">
          <span className="label">CRA registration no.</span>
          <input
            className="input mt-1.5"
            value={charityNumber}
            onChange={(e) => setCharityNumber(e.target.value)}
            placeholder="123456789RR0001"
          />
        </label>
        <label className="block">
          <span className="label">Pledge status</span>
          <select
            className="input mt-1.5"
            value={pledgeStatus}
            onChange={(e) => setPledgeStatus(e.target.value)}
          >
            <option value="not_applicable">Not a pledge</option>
            <option value="outstanding">Outstanding</option>
            <option value="partial">Partially fulfilled</option>
            <option value="fulfilled">Fulfilled</option>
          </select>
        </label>
      </div>

      <div className="rounded-xl border border-white/5 bg-navy-950/50 p-3.5">
        <div className="flex items-center justify-between gap-3">
          <span className={receiptable ? "pill-ok" : "pill-warn"}>
            {receiptable ? "Tax receiptable" : "Not receiptable"}
          </span>
          {amount && receiptable && (
            <span className="text-xs text-navy-300">
              Est. federal credit {cad(estimateCredit(Number(amount)))}
            </span>
          )}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-navy-300">
          {selected.cra_note ??
            (selected.requires_registered_charity && !charityNumber.trim()
              ? "Add the recipient's CRA registration number to claim this gift."
              : "Eligible for an official donation receipt from the registered charity.")}
        </p>
      </div>

      {error && <p className="text-xs text-red-300">{error}</p>}

      <button className="btn-gold w-full" disabled={saving}>
        {saving ? "Recording…" : "Record gift"}
      </button>
    </form>
  );
}

/** 15% on the first $200 of the year, 29% above — a per-gift approximation. */
function estimateCredit(amount: number) {
  const first = Math.min(amount, 200);
  return first * 0.15 + Math.max(amount - 200, 0) * 0.29;
}
