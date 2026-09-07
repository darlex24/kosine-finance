/** Chart colour, validated rather than chosen by eye.
 *
 * Every value here was produced in OKLCH and run through the dataviz palette
 * validator against this app's own dark surfaces (navy-900 #081226 for cards,
 * navy-950 #050b18 for the canvas). The previous ad-hoc palette in
 * `components/dashboard/charts.tsx` failed three of the five checks — it sat
 * outside the dark lightness band, two of its colours fell under the chroma
 * floor and read as grey, and sky-blue against violet was ΔE 5.2 under
 * deuteranopia, meaning red-green colourblind readers could not separate
 * savings from investments at all.
 */

import type { LedgerEntryType } from "./types";

/** Categorical: identity. Hues ~72° apart, gold pinned to the brand angle.
 *
 * Passes all five checks under the strict all-pairs rule on both surfaces.
 * CVD separation is ΔE 6.4 at worst, which sits in the 6–8 floor band — legal
 * only alongside secondary encoding, so every chart using these MUST also carry
 * direct labels, segment gaps or a legend. That is not decoration here.
 */
export const SERIES: Record<LedgerEntryType, string> = {
  income: "#0ab074",
  expense: "#3690e3",
  giving: "#ad8700",
  savings: "#b36bc4",
  investment: "#c34f4b",
  // Transfers move money between the user's own pots and net to zero, so they
  // are excluded from outflow charts entirely — which also keeps any single
  // chart at five series, the point where all-pairs separation still holds.
  transfer: "#5a6b8c",
};

export const OUTFLOW_TYPES: LedgerEntryType[] = [
  "expense",
  "giving",
  "savings",
  "investment",
];

export const SERIES_LABEL: Record<LedgerEntryType, string> = {
  income: "Income",
  expense: "Expenses",
  giving: "Giving",
  savings: "Savings",
  investment: "Investment",
  transfer: "Transfers",
};

/** Sequential: magnitude. One hue, light→dark, for ranked category groups.
 *
 * A ranked breakdown is magnitude, not identity, so it takes a single-hue ramp
 * rather than categorical hues — which also keeps the donut unmistakably on
 * brand. Passes lightness monotonicity, adjacent ΔL and single-hue checks.
 */
export const GOLD_RAMP = [
  "#eadeb9",
  "#d1bf8b",
  "#b8a25c",
  "#a08422",
  "#896800",
  "#724b00",
];

/** Beyond the ramp everything folds into one muted step — a ninth generated hue
 *  is never the answer. */
export const OTHER_COLOR = "#4a5670";

export function rampColor(index: number): string {
  return index < GOLD_RAMP.length ? GOLD_RAMP[index] : OTHER_COLOR;
}

// Recessive grid and axes: present enough to read against, never competing with
// the data.
export const AXIS = "#8fa3c8";
export const GRID = "rgba(255,255,255,0.06)";
export const SURFACE = "#081226";

/** The 2px surface-coloured gap that separates stacked segments and adjacent
 *  marks, so touching fills never blend into one shape. */
export const SEGMENT_GAP = { stroke: SURFACE, strokeWidth: 2 };

export const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
