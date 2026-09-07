"use client";

import { motion } from "framer-motion";
import { useMemo, useState } from "react";

import { useCatalog } from "@/components/CatalogProvider";
import { api } from "@/lib/api";
import {
  GIVING_ARMS,
  REALM_LABELS,
  REALM_ORDER,
  cad,
  isReceiptable,
  type Realm,
} from "@/lib/givingArms";

/** Record a gift against any arm, with live receiptability feedback. */
export function GivingForm({ onSaved }: { onSaved?: () => void }) {
  // The catalogue, not the hardcoded list: it carries the seeded arms plus any
  // this church defined for itself. GIVING_ARMS is only the pre-load fallback.
  const { arms: catalogArms, refresh } = useCatalog();
  const allArms = catalogArms.length > 0 ? catalogArms : GIVING_ARMS;

  const [realm, setRealm] = useState<Realm>("core_covenant");
  const [arm, setArm] = useState("tithe");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [charityNumber, setCharityNumber] = useState("");
  const [pledgeStatus, setPledgeStatus] = useState("not_applicable");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newArmName, setNewArmName] = useState("");
  const [addingArm, setAddingArm] = useState(false);

  const armsInRealm = useMemo(
    () => allArms.filter((a) => a.realm === realm),
    [allArms, realm],
  );
  const selected = allArms.find((a) => a.arm === arm) ?? allArms[0];
  const receiptable = isReceiptable(selected, charityNumber);

  function pickRealm(next: Realm) {
    setRealm(next);
    const first = allArms.find((a) => a.realm === next);
    if (first) setArm(first.arm);
  }

  /** Define an arm this church uses that the seeded list does not name. */
  async function addArm() {
    const name = newArmName.trim();
    if (!name) return;
    setAddingArm(true);
    setError(null);
    try {
      const created = await api.createArm({
        display_name: name,
        realm,
        default_tax_deductible: true,
        requires_registered_charity: true,
      });
      await refresh();
      setArm(created.arm);
      setNewArmName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that arm");
    } finally {
      setAddingArm(false);
    }
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

          {/* Not every church calls its giving what Loveworld calls it. */}
          <div className="col-span-full mt-1 flex gap-2">
            <input
              value={newArmName}
              onChange={(e) => setNewArmName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void addArm();
                }
              }}
              placeholder={`Add an arm to ${REALM_LABELS[realm]}…`}
              aria-label="New giving arm name"
              className="input flex-1"
            />
            <button
              type="button"
              onClick={() => void addArm()}
              disabled={!newArmName.trim() || addingArm}
              className="btn-ghost shrink-0"
            >
              {addingArm ? "Adding…" : "Add"}
            </button>
          </div>
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
