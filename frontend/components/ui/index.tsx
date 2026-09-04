"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";

/** Shared primitives for the V2 surface.
 *
 * Everything here is built from the navy/gold tokens in tailwind.config.ts and
 * the `.card` / `.input` / `.btn-*` component classes in globals.css. Gold is an
 * accent, never a fill: it marks the primary action, the active state and the
 * focus ring, and nothing else.
 */

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// ------------------------------------------------------------------ layout

export function Card({
  className,
  children,
  accent = false,
}: {
  className?: string;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return <div className={cx(accent ? "card-gold" : "card", className)}>{children}</div>;
}

export function SectionHeading({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-navy-50">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-navy-300">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

// ------------------------------------------------------------------- stats

export function StatTile({
  label,
  value,
  hint,
  delta,
  accent = false,
  children,
}: {
  label: string;
  value: string;
  hint?: string;
  delta?: { text: string; positive: boolean } | null;
  accent?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className={cx(accent ? "card-gold" : "card", "flex flex-col gap-1")}
    >
      <p className="label">{label}</p>
      <p
        className={cx(
          "figure",
          accent ? "gold-text" : "text-navy-50",
        )}
      >
        {value}
      </p>
      <div className="flex items-center gap-2 text-xs">
        {delta && (
          <span className={delta.positive ? "text-emerald-300" : "text-red-300"}>
            {delta.text}
          </span>
        )}
        {hint && <span className="text-navy-300">{hint}</span>}
      </div>
      {children}
    </motion.div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cx("animate-pulse rounded-lg bg-white/5 motion-reduce:animate-none", className)}
    />
  );
}

// ------------------------------------------------------------------ inputs

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "gold" | "ghost" | "danger" | "quiet";
};

export function Button({ variant = "ghost", className, ...rest }: ButtonProps) {
  const base =
    variant === "gold"
      ? "btn-gold"
      : variant === "danger"
        ? "rounded-xl border border-red-400/30 px-4 py-2.5 text-sm font-medium text-red-300 transition hover:bg-red-400/10"
        : variant === "quiet"
          ? "rounded-lg px-2.5 py-1.5 text-xs text-navy-300 transition hover:text-gold-300"
          : "btn-ghost";
  return (
    <button
      className={cx(
        base,
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50",
        className,
      )}
      {...rest}
    />
  );
}

export const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input {...props} className={cx("input", props.className)} />
);

export const Select = (props: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...props} className={cx("input appearance-none pr-8", props.className)} />
);

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-navy-300">{hint}</span>}
    </label>
  );
}

// ---------------------------------------------------------------- combobox

export type Option = { value: string; label: string; group?: string; hint?: string };

/** Type-ahead picker for the long lists — categories and platforms — where a
 *  native <select> of 100+ options would be unusable. */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Search…",
  autoFocus = false,
  onDismiss,
  className,
}: {
  options: Option[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onDismiss?: () => void;
  className?: string;
}) {
  const selected = options.find((o) => o.value === value) ?? null;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(autoFocus);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const pool = needle
      ? options.filter(
          (o) =>
            o.label.toLowerCase().includes(needle) ||
            (o.group ?? "").toLowerCase().includes(needle),
        )
      : options;
    return pool.slice(0, 60);
  }, [options, query]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    function onClickAway(event: MouseEvent) {
      if (!boxRef.current?.contains(event.target as Node)) {
        setOpen(false);
        onDismiss?.();
      }
    }
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, [onDismiss]);

  return (
    <div ref={boxRef} className={cx("relative", className)}>
      <input
        className="input"
        autoFocus={autoFocus}
        placeholder={selected ? selected.label : placeholder}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const pick = matches[active];
            if (pick) {
              onChange(pick.value);
              setQuery("");
              setOpen(false);
              onDismiss?.();
            }
          } else if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
            onDismiss?.();
          }
        }}
      />

      {open && matches.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-64 w-full min-w-[16rem] overflow-auto rounded-xl border border-white/10 bg-navy-900 p-1 shadow-card">
          {matches.map((option, i) => (
            <li key={option.value}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(option.value);
                  setQuery("");
                  setOpen(false);
                  onDismiss?.();
                }}
                className={cx(
                  "flex w-full items-baseline justify-between gap-3 rounded-lg px-3 py-1.5 text-left text-sm",
                  i === active ? "bg-gold-500/15 text-gold-100" : "text-navy-100",
                )}
              >
                <span>{option.label}</span>
                {option.group && (
                  <span className="text-[10px] uppercase tracking-wide text-navy-300">
                    {option.group}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- pills

export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "ok" | "warn" | "gold";
  children: React.ReactNode;
}) {
  const tones = {
    neutral: "pill bg-white/5 text-navy-100 ring-1 ring-inset ring-white/10",
    ok: "pill-ok",
    warn: "pill-warn",
    gold: "pill bg-gold-500/15 text-gold-200 ring-1 ring-inset ring-gold-500/30",
  } as const;
  return <span className={tones[tone]}>{children}</span>;
}

// ------------------------------------------------------------------ sheet

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 bg-navy-950/70 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 420, damping: 40 }}
            className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l border-white/10 bg-navy-900 p-6"
            role="dialog"
            aria-label={title}
          >
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
              <Button variant="quiet" onClick={onClose}>
                Close
              </Button>
            </div>
            {children}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

// ------------------------------------------------------------------ toast

export type ToastAction = { label: string; onClick: () => void };

export function Toast({
  message,
  action,
  onDismiss,
}: {
  message: string | null;
  action?: ToastAction | null;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDismiss, action ? 8000 : 4000);
    return () => clearTimeout(timer);
  }, [message, action, onDismiss]);

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.18 }}
          role="status"
          className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-xl border border-white/10 bg-navy-900/95 px-4 py-3 text-sm shadow-card backdrop-blur"
        >
          <span className="text-navy-100">{message}</span>
          {action && (
            <button
              onClick={() => {
                action.onClick();
                onDismiss();
              }}
              className="font-semibold text-gold-300 hover:underline"
            >
              {action.label}
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Small state machine so pages can say `toast.show("Deleted", { label: "Undo", … })`. */
export function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  const [action, setAction] = useState<ToastAction | null>(null);

  return {
    message,
    action,
    show: (text: string, undo?: ToastAction) => {
      setMessage(text);
      setAction(undo ?? null);
    },
    dismiss: () => {
      setMessage(null);
      setAction(null);
    },
  };
}
