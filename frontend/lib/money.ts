/** Currency formatting for a ledger that spans the globe.
 *
 * Every row carries its own ISO code, so nothing here assumes a base currency.
 * Minor units come from `Intl`, which knows that JPY has none and KWD has three.
 */

const cache = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, compact: boolean, showCents: boolean) {
  const key = `${currency}|${compact}|${showCents}`;
  const hit = cache.get(key);
  if (hit) return hit;

  let made: Intl.NumberFormat;
  try {
    made = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      notation: compact ? "compact" : "standard",
      ...(showCents ? {} : { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
    });
  } catch {
    // Unknown or malformed code — fall back to a plain number with the code.
    made = new Intl.NumberFormat(undefined, {
      notation: compact ? "compact" : "standard",
      minimumFractionDigits: showCents ? 2 : 0,
      maximumFractionDigits: showCents ? 2 : 0,
    });
  }
  cache.set(key, made);
  return made;
}

export type MoneyOptions = {
  /** Round to whole units — for headline figures where cents are noise. */
  whole?: boolean;
  /** 1.2M rather than 1,234,567 — for sparkline axes and tight tiles. */
  compact?: boolean;
  /** Always show a leading + or −. */
  signed?: boolean;
};

export function formatMoney(
  amount: number | string | null | undefined,
  currency = "CAD",
  options: MoneyOptions = {},
): string {
  const value = Number(amount ?? 0);
  if (!Number.isFinite(value)) return "—";

  const { whole = false, compact = false, signed = false } = options;
  const text = formatter(currency.toUpperCase(), compact, !whole).format(
    signed ? Math.abs(value) : value,
  );
  if (!signed) return text;
  return `${value < 0 ? "−" : "+"}${text}`;
}

/** Magnitude only — the ledger stores outflows negative, but a grid cell in an
 *  "Expense" row should read 42.00, not −42.00. */
export function formatAbs(
  amount: number | string | null | undefined,
  currency = "CAD",
  options: MoneyOptions = {},
): string {
  return formatMoney(Math.abs(Number(amount ?? 0)), currency, options);
}

export function currencySymbol(currency: string): string {
  try {
    return (
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency.toUpperCase(),
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      })
        .formatToParts(0)
        .find((part) => part.type === "currency")?.value ?? currency
    );
  } catch {
    return currency;
  }
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}%`;
}

/** Parse what a user actually types into an amount cell: "1,299.50", "£12", "(45)". */
export function parseAmount(input: string): number | null {
  const cleaned = input.trim().replace(/[^\d.,()\-]/g, "");
  if (!cleaned) return null;
  const negative = /^\(.*\)$/.test(cleaned) || cleaned.startsWith("-");
  const digits = cleaned.replace(/[()\-]/g, "");

  // Treat the last separator as the decimal point; anything earlier is grouping.
  const lastComma = digits.lastIndexOf(",");
  const lastDot = digits.lastIndexOf(".");
  let normalised = digits;
  if (lastComma > lastDot) {
    normalised = digits.replace(/\./g, "").replace(",", ".");
  } else {
    normalised = digits.replace(/,/g, "");
  }

  const value = Number(normalised);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}
