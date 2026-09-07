/** Row shapes returned by the API. Mirrors backend/app/schemas.py. */

import type { Realm } from "./givingArms";

/** The `giving_arm` enum value, e.g. "tithe". `GivingArm` in ./givingArms is the
 *  richer display record keyed by this slug. */
export type GivingArmSlug = string;

export type LedgerEntryType =
  | "expense"
  | "income"
  | "transfer"
  | "savings"
  | "investment"
  | "giving";

export type EntrySource = "manual" | "ocr" | "import";

export const ENTRY_TYPES: { value: LedgerEntryType; label: string }[] = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "giving", label: "Giving" },
  { value: "savings", label: "Savings" },
  { value: "investment", label: "Investment" },
  { value: "transfer", label: "Transfer" },
];

/** Types that take money out of the pocket — rows are stored negative. */
export const OUTFLOW_TYPES: LedgerEntryType[] = [
  "expense",
  "giving",
  "savings",
  "investment",
];

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  ministry_role: "minister" | "pastor" | "leader" | "member";
  home_church: string | null;
  base_currency: string;
  country_code: string;
  default_province: string | null;
};

export type Currency = {
  code: string;
  name: string;
  symbol: string;
  decimal_digits: number;
};

export type Category = {
  id: string;
  slug: string;
  parent_id: string | null;
  name: string;
  group: string;
  icon: string | null;
  is_giving: boolean;
  sort_order: number;
  is_system: boolean;
};

export type PlatformKind =
  | "brokerage"
  | "crypto_exchange"
  | "robo_advisor"
  | "bank"
  | "pension"
  | "real_estate"
  | "p2p_lending"
  | "other";

export type Platform = {
  id: string;
  slug: string;
  name: string;
  kind: PlatformKind;
  country_code: string | null;
  website: string | null;
  is_system: boolean;
};

export type AssetClass =
  | "cash"
  | "equity"
  | "fund"
  | "crypto"
  | "bond"
  | "real_estate"
  | "business"
  | "retirement"
  | "insurance"
  | "collectible"
  | "other";

export type LiabilityKind =
  | "mortgage"
  | "credit_card"
  | "student_loan"
  | "personal_loan"
  | "auto_loan"
  | "business_loan"
  | "tax_owing"
  | "other";

export type Asset = {
  id: string;
  name: string;
  asset_class: AssetClass;
  platform_id: string | null;
  account_id: string | null;
  currency: string;
  quantity: number | null;
  unit_cost: number | null;
  current_value: number;
  as_of: string;
  notes: string | null;
  is_archived: boolean;
};

export type Liability = {
  id: string;
  name: string;
  liability_kind: LiabilityKind;
  currency: string;
  current_balance: number;
  interest_rate: number | null;
  minimum_payment: number | null;
  as_of: string;
  notes: string | null;
  is_archived: boolean;
};

export type LedgerRow = {
  id: string;
  date: string;
  entry_type: LedgerEntryType;
  amount: number;
  currency: string;
  base_amount: number;
  base_currency: string;
  fx_rate: number;
  merchant: string | null;
  memo: string | null;
  tags: string[];
  source: EntrySource;
  receipt_image_url: string | null;
  receipt_storage_path: string | null;
  ocr_confidence: number | null;
  category_id: string | null;
  category_slug: string | null;
  category_name: string | null;
  category_group: string | null;
  category_icon: string | null;
  platform_id: string | null;
  platform_name: string | null;
  account_id: string | null;
  account_name: string | null;
  giving_record_id: string | null;
  giving_arm: GivingArmSlug | null;
  giving_realm: Realm | null;
  giving_recipient: string | null;
  tax_deductible_flag: boolean | null;
  pledge_fulfilled_status: string | null;
  tax_year: number | null;
};

export type LedgerPage = {
  rows: LedgerRow[];
  next_cursor: string | null;
};

export type LedgerFilters = {
  date_from?: string;
  date_to?: string;
  entry_type?: LedgerEntryType;
  category_id?: string;
  platform_id?: string;
  account_id?: string;
  currency?: string;
  q?: string;
};

export type LedgerDraft = {
  date: string;
  entry_type: LedgerEntryType;
  amount: number;
  currency: string;
  category_id?: string | null;
  category_slug?: string | null;
  platform_id?: string | null;
  account_id?: string | null;
  merchant?: string | null;
  memo?: string | null;
  tags?: string[];
  source?: EntrySource;
  receipt_image_url?: string | null;
  receipt_storage_path?: string | null;
  ocr_confidence?: number | null;
  giving_arm?: GivingArmSlug | null;
  giving_recipient?: string | null;
  charity_registration_number?: string | null;
};

export type NetWorthPoint = { captured_on: string; net_worth: number };

export type NetWorth = {
  base_currency: string;
  total_assets: number;
  total_liabilities: number;
  net_worth: number;
  liquid_cash: number;
  investable_assets: number;
  previous_net_worth: number | null;
  change_amount: number | null;
  change_pct: number | null;
  trend: NetWorthPoint[];
};

export type CashFlowPoint = {
  year: number;
  month: number;
  entry_type: LedgerEntryType;
  total: number;
};

export type AnnualSummary = {
  year: number;
  base_currency: string;
  income: number;
  expenses: number;
  giving: number;
  saved: number;
  net: number;
  giving_rate: number | null;
  savings_rate: number | null;
};

export type CategorySpend = {
  category_group: string;
  category_name: string;
  total: number;
  category_id: string | null;
  category_icon: string | null;
  entry_type: LedgerEntryType | null;
  year: number | null;
  month: number | null;
  entry_count: number;
  base_currency: string | null;
};

/** A giving arm as the API returns it. Since 0011 this is a per-user catalogue:
 *  the seeded Loveworld arms plus whatever the user defined for their church. */
export type ArmRule = {
  arm: string;
  realm: Realm;
  display_name: string;
  default_tax_deductible: boolean;
  requires_registered_charity: boolean;
  cra_note: string | null;
  is_system: boolean;
  sort_order: number;
};

export type Budget = {
  id: string;
  year: number;
  month: number;
  total_income: number;
  allocated_giving: number;
  allocated_living: number;
  allocated_savings: number;
  notes: string | null;
};

export type Account = {
  id: string;
  name: string;
  type: string;
  institution: string | null;
  balance: number;
  currency: string;
};

export type GivingByArm = {
  year: number;
  month: number;
  giving_arm: string;
  display_name: string;
  realm: Realm;
  is_system: boolean;
  base_currency: string;
  total: number;
  entry_count: number;
  any_receiptable: boolean;
};

export type BudgetLine = {
  category_id: string | null;
  category_name: string;
  category_group: string;
  entry_type: LedgerEntryType | null;
  allocated: number;
  actual: number;
  /** allocated - actual. Negative means overspent. */
  variance: number;
  /** null when nothing was budgeted — a different state from 0% used. */
  used_pct: number | null;
  entry_count: number;
};

export type BudgetMonth = {
  year: number;
  month: number;
  base_currency: string;
  total_income: number;
  total_allocated: number;
  total_actual: number;
  unallocated: number;
  lines: BudgetLine[];
};
