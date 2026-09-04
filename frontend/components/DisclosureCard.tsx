"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";

/**
 * Progressive disclosure: the card shows one number. Detail — asset breakdowns,
 * per-arm giving, contribution room — stays folded until it is asked for.
 */
export function DisclosureCard({
  label,
  value,
  hint,
  accent = false,
  children,
}: {
  label: string;
  value: string;
  hint?: React.ReactNode;
  accent?: boolean;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(children);

  return (
    <motion.section
      layout
      transition={{ type: "spring", stiffness: 280, damping: 30 }}
      className={accent ? "card-gold" : "card"}
    >
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        aria-expanded={expandable ? open : undefined}
        className="flex w-full items-start justify-between gap-4 text-left"
        disabled={!expandable}
      >
        <div>
          <p className="label">{label}</p>
          <p className={`figure mt-2 ${accent ? "gold-text" : "text-white"}`}>{value}</p>
          {hint && <div className="mt-2 text-xs text-navy-300">{hint}</div>}
        </div>
        {expandable && (
          <motion.span
            animate={{ rotate: open ? 180 : 0 }}
            className="mt-1 text-navy-300"
            aria-hidden
          >
            ▾
          </motion.span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="detail"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="mt-4 border-t border-white/5 pt-4 text-sm">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
