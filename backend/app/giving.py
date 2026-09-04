"""Canonical taxonomy of Kingdom giving arms and their CRA treatment.

This mirrors `public.giving_arm_rules` in the database so the API can validate
and explain a giving arm without a round-trip, and so the OCR classifier has a
vocabulary to map free-text receipt lines onto.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Realm(str, Enum):
    CORE_COVENANT = "core_covenant"
    MINISTRY_PARTNERSHIP = "ministry_partnership"
    SEEDS_SPECIAL = "seeds_special"
    ALMS_COMPASSION = "alms_compassion"


class GivingArm(str, Enum):
    # Core covenant giving
    TITHE = "tithe"
    FIRSTFRUIT = "firstfruit"
    FREE_WILL_OFFERING = "free_will_offering"
    VOW = "vow"
    PLEDGE = "pledge"
    THANKSGIVING_OFFERING = "thanksgiving_offering"
    # Ministry partnership arms
    RHAPSODY_OF_REALITIES = "rhapsody_of_realities"
    HEALING_SCHOOL = "healing_school"
    INNERCITY_MISSION = "innercity_mission"
    LOVEWORLD_NETWORKS = "loveworld_networks"
    CAMPUS_MINISTRY = "campus_ministry"
    FOUNDATION_SCHOOL = "foundation_school"
    LOCAL_CHURCH_PROJECT = "local_church_project"
    # Seeds & special offerings
    SPECIAL_SEED = "special_seed"
    PROPHET_SEED = "prophet_seed"
    BUILDING_FUND = "building_fund"
    LAND_SEED = "land_seed"
    CRUSADE_SEED = "crusade_seed"
    LOVE_OFFERING = "love_offering"
    # Alms & compassion
    ALMS_TO_THE_POOR = "alms_to_the_poor"
    BENEVOLENCE_FUND = "benevolence_fund"
    WIDOWS_AND_ORPHANS = "widows_and_orphans"


class PledgeStatus(str, Enum):
    NOT_APPLICABLE = "not_applicable"
    OUTSTANDING = "outstanding"
    PARTIAL = "partial"
    FULFILLED = "fulfilled"


@dataclass(frozen=True)
class ArmRule:
    arm: GivingArm
    realm: Realm
    display_name: str
    # True when a gift of this kind, made to a CRA-registered charity, may be
    # acknowledged with an official donation receipt.
    default_tax_deductible: bool
    # True when the receipt depends on the recipient being CRA-registered.
    requires_registered_charity: bool
    cra_note: str | None = None
    # Words that hint at this arm on a receipt or giving statement.
    keywords: tuple[str, ...] = ()


_R = Realm
_A = GivingArm

ARM_RULES: dict[GivingArm, ArmRule] = {
    r.arm: r
    for r in [
        ArmRule(_A.TITHE, _R.CORE_COVENANT, "Tithe", True, True,
                "Receiptable when paid to the registered church.",
                ("tithe", "tithes", "10%")),
        ArmRule(_A.FIRSTFRUIT, _R.CORE_COVENANT, "Firstfruit", True, True,
                "Receiptable when paid to the registered church.",
                ("firstfruit", "first fruit", "firstfruits")),
        ArmRule(_A.FREE_WILL_OFFERING, _R.CORE_COVENANT, "Free Will Offering", True, True,
                "Receiptable if given to the charity, not an individual.",
                ("free will", "freewill", "offering")),
        ArmRule(_A.VOW, _R.CORE_COVENANT, "Vow", True, True,
                "Receiptable on payment, not on the promise.", ("vow",)),
        ArmRule(_A.PLEDGE, _R.CORE_COVENANT, "Pledge", True, True,
                "Only the amount actually paid in the year is receiptable.",
                ("pledge", "commitment")),
        ArmRule(_A.THANKSGIVING_OFFERING, _R.CORE_COVENANT, "Thanksgiving Offering", True, True,
                None, ("thanksgiving", "thank offering")),

        ArmRule(_A.RHAPSODY_OF_REALITIES, _R.MINISTRY_PARTNERSHIP,
                "Rhapsody of Realities / Publishing", True, True,
                "Receiptable only if the receiving entity is CRA-registered.",
                ("rhapsody", "ror", "sponsor", "publishing")),
        ArmRule(_A.HEALING_SCHOOL, _R.MINISTRY_PARTNERSHIP, "Healing School", True, True,
                "Receiptable only if the receiving entity is CRA-registered.",
                ("healing school", "healing streams")),
        ArmRule(_A.INNERCITY_MISSION, _R.MINISTRY_PARTNERSHIP,
                "InnerCity Mission for Children", True, True,
                "Receiptable only if the receiving entity is CRA-registered.",
                ("innercity", "inner city", "icm")),
        ArmRule(_A.LOVEWORLD_NETWORKS, _R.MINISTRY_PARTNERSHIP,
                "Loveworld Networks / Media", True, True,
                "Receiptable only if the receiving entity is CRA-registered.",
                ("loveworld", "lw plus", "ceflix", "media")),
        ArmRule(_A.CAMPUS_MINISTRY, _R.MINISTRY_PARTNERSHIP, "Campus Ministry", True, True,
                None, ("campus", "cmd", "bltc")),
        ArmRule(_A.FOUNDATION_SCHOOL, _R.MINISTRY_PARTNERSHIP, "Foundation School", True, True,
                None, ("foundation school",)),
        ArmRule(_A.LOCAL_CHURCH_PROJECT, _R.MINISTRY_PARTNERSHIP, "Local Church Project",
                True, True, None, ("church project", "project")),

        ArmRule(_A.SPECIAL_SEED, _R.SEEDS_SPECIAL, "Special Seed", True, True,
                "Receiptable if given to the charity with no benefit received in return.",
                ("special seed", "seed")),
        ArmRule(_A.PROPHET_SEED, _R.SEEDS_SPECIAL, "Prophet / Clergy Honorarium", False, False,
                "A personal gift to an individual minister is a gift, not a donation. "
                "Not receiptable; may be taxable income to the recipient.",
                ("prophet", "honorarium", "man of god", "ministers seed")),
        ArmRule(_A.BUILDING_FUND, _R.SEEDS_SPECIAL, "Building Fund", True, True, None,
                ("building", "edifice")),
        ArmRule(_A.LAND_SEED, _R.SEEDS_SPECIAL, "Land Seed", True, True, None, ("land",)),
        ArmRule(_A.CRUSADE_SEED, _R.SEEDS_SPECIAL, "Crusade / Mega-Event Seed", True, True,
                "Not receiptable where a ticket or admission benefit is received.",
                ("crusade", "convention", "iscd", "night of bliss")),
        ArmRule(_A.LOVE_OFFERING, _R.SEEDS_SPECIAL, "Love Offering", False, False,
                "Receiptable only when paid to the general fund of the charity, "
                "not designated to a person.",
                ("love offering", "love gift")),

        ArmRule(_A.ALMS_TO_THE_POOR, _R.ALMS_COMPASSION, "Alms to the Poor", False, False,
                "Direct gifts to individuals are never receiptable under CRA rules.",
                ("alms", "poor", "charity to individual")),
        ArmRule(_A.BENEVOLENCE_FUND, _R.ALMS_COMPASSION, "Benevolence Fund", True, True,
                "Receiptable when the charity retains discretion over disbursement.",
                ("benevolence", "compassion fund")),
        ArmRule(_A.WIDOWS_AND_ORPHANS, _R.ALMS_COMPASSION, "Widows & Orphans Support",
                True, True,
                "Receiptable through the charity program; not when handed to a person.",
                ("widow", "orphan")),
    ]
}


def is_tax_deductible(arm: GivingArm, charity_registration_number: str | None) -> bool:
    """CRA treatment for one gift.

    A gift is receiptable only when the arm itself is receiptable *and*, where
    the arm requires it, the recipient carries a CRA registration number.
    """
    rule = ARM_RULES[arm]
    if rule.requires_registered_charity and not (charity_registration_number or "").strip():
        return False
    return rule.default_tax_deductible


def classify_text(text: str) -> GivingArm | None:
    """Best-effort mapping of a receipt line onto a giving arm."""
    haystack = text.lower()
    best: tuple[int, GivingArm] | None = None
    for rule in ARM_RULES.values():
        for kw in rule.keywords:
            if kw in haystack and (best is None or len(kw) > best[0]):
                best = (len(kw), rule.arm)
    return best[1] if best else None
