// Client-side mirror of the giving taxonomy, used to render the picker before
// /api/giving/arms resolves. The API remains the source of truth for CRA flags.

import { formatMoney } from "./money";

export type Realm =
  | "core_covenant"
  | "ministry_partnership"
  | "seeds_special"
  | "alms_compassion";

export type GivingArm = {
  arm: string;
  display_name: string;
  realm: Realm;
  default_tax_deductible: boolean;
  requires_registered_charity: boolean;
  cra_note?: string | null;
};

export const REALM_LABELS: Record<Realm, string> = {
  core_covenant: "Core Covenant Giving",
  ministry_partnership: "Ministry Partnership Arms",
  seeds_special: "Seeds & Special Offerings",
  alms_compassion: "Alms & Compassion",
};

export const REALM_ORDER: Realm[] = [
  "core_covenant",
  "ministry_partnership",
  "seeds_special",
  "alms_compassion",
];

export const GIVING_ARMS: GivingArm[] = [
  { arm: "tithe", display_name: "Tithe", realm: "core_covenant", default_tax_deductible: true, requires_registered_charity: true },
  { arm: "firstfruit", display_name: "Firstfruit", realm: "core_covenant", default_tax_deductible: true, requires_registered_charity: true },
  { arm: "free_will_offering", display_name: "Free Will Offering", realm: "core_covenant", default_tax_deductible: true, requires_registered_charity: true },
  { arm: "vow", display_name: "Vow", realm: "core_covenant", default_tax_deductible: true, requires_registered_charity: true },
  { arm: "pledge", display_name: "Pledge", realm: "core_covenant", default_tax_deductible: true, requires_registered_charity: true },
  { arm: "thanksgiving_offering", display_name: "Thanksgiving Offering", realm: "core_covenant", default_tax_deductible: true, requires_registered_charity: true },

  { arm: "rhapsody_of_realities", display_name: "Rhapsody of Realities / Publishing", realm: "ministry_partnership", default_tax_deductible: true, requires_registered_charity: true },
  { arm: "healing_school", display_name: "Healing School", realm: "ministry_partnership", default_tax_deductible: true, requires_registered_charity: true },
  { arm: "innercity_mission", display_name: "InnerCity Mission for Children", realm: "ministry_partnership", default_tax_deductible: true, requires_registered_charity: true },
  { arm: "loveworld_networks", display_name: "Loveworld Networks / Media", realm: "ministry_partnership", default_tax_deductible: true, requires_registered_charity: true },
  { arm: "campus_ministry", display_name: "Campus Ministry", realm: "ministry_partnership", default_tax_deductible: true, requires_registered_charity: true },
  { arm: "foundation_school", display_name: "Foundation School", realm: "ministry_partnership", default_tax_deductible: true, requires_registered_charity: true },
  { arm: "local_church_project", display_name: "Local Church Project", realm: "ministry_partnership", default_tax_deductible: true, requires_registered_charity: true },

  { arm: "special_seed", display_name: "Special Seed", realm: "seeds_special", default_tax_deductible: true, requires_registered_charity: true },
  { arm: "prophet_seed", display_name: "Prophet / Clergy Honorarium", realm: "seeds_special", default_tax_deductible: false, requires_registered_charity: false, cra_note: "A personal gift to a minister is not receiptable." },
  { arm: "building_fund", display_name: "Building Fund", realm: "seeds_special", default_tax_deductible: true, requires_registered_charity: true },
  { arm: "land_seed", display_name: "Land Seed", realm: "seeds_special", default_tax_deductible: true, requires_registered_charity: true },
  { arm: "crusade_seed", display_name: "Crusade / Mega-Event Seed", realm: "seeds_special", default_tax_deductible: true, requires_registered_charity: true },
  { arm: "love_offering", display_name: "Love Offering", realm: "seeds_special", default_tax_deductible: false, requires_registered_charity: false, cra_note: "Receiptable only through the general fund." },

  { arm: "alms_to_the_poor", display_name: "Alms to the Poor", realm: "alms_compassion", default_tax_deductible: false, requires_registered_charity: false, cra_note: "Direct gifts to individuals are never receiptable." },
  { arm: "benevolence_fund", display_name: "Benevolence Fund", realm: "alms_compassion", default_tax_deductible: true, requires_registered_charity: true },
  { arm: "widows_and_orphans", display_name: "Widows & Orphans Support", realm: "alms_compassion", default_tax_deductible: true, requires_registered_charity: true },
];

export function isReceiptable(arm: GivingArm, charityNumber?: string | null): boolean {
  if (arm.requires_registered_charity && !charityNumber?.trim()) return false;
  return arm.default_tax_deductible;
}

/** Legacy CAD helper, kept so existing callers keep working. New code should use
 *  `formatMoney` from `lib/money` and pass the row's own currency. */
export const cad = (value: number) => formatMoney(value, "CAD", { whole: true });
