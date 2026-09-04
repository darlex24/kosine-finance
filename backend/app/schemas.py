from __future__ import annotations

from datetime import date as DateType
from decimal import Decimal
from enum import Enum

from pydantic import BaseModel, Field

from .giving import GivingArm, PledgeStatus, Realm


class MinistryRole(str, Enum):
    MINISTER = "minister"
    PASTOR = "pastor"
    LEADER = "leader"
    MEMBER = "member"


class AccountType(str, Enum):
    CHEQUING = "chequing"
    SAVINGS = "savings"
    TFSA = "tfsa"
    RRSP = "rrsp"
    FHSA = "fhsa"
    RESP = "resp"
    CREDIT_CARD = "credit_card"
    CASH = "cash"


# ----------------------------------------------------------------- accounts

class AccountIn(BaseModel):
    name: str
    type: AccountType
    institution: str | None = None
    balance: Decimal = Decimal("0")


class AccountOut(AccountIn):
    id: str
    currency: str = "CAD"


# ----------------------------------------------------------------- budgets

class BudgetIn(BaseModel):
    month: int = Field(ge=1, le=12)
    year: int = Field(ge=2000, le=2100)
    total_income: Decimal = Decimal("0")
    allocated_giving: Decimal = Decimal("0")
    allocated_living: Decimal = Decimal("0")
    allocated_savings: Decimal = Decimal("0")
    notes: str | None = None


class BudgetOut(BudgetIn):
    id: str


# ------------------------------------------------------------ transactions

class TransactionIn(BaseModel):
    account_id: str | None = None
    budget_id: str | None = None
    amount: Decimal
    category: str
    date: DateType
    merchant: str | None = None
    memo: str | None = None
    receipt_image_url: str | None = None


class TransactionOut(TransactionIn):
    id: str


# ----------------------------------------------------------------- giving

class GivingIn(BaseModel):
    """A gift. Either attach it to an existing transaction, or send the
    transaction fields and the API will create both in one call."""

    transaction_id: str | None = None
    amount: Decimal | None = None
    date: DateType | None = None
    account_id: str | None = None

    giving_arm: GivingArm
    recipient: str | None = None
    charity_registration_number: str | None = None
    pledge_fulfilled_status: PledgeStatus = PledgeStatus.NOT_APPLICABLE
    pledge_total: Decimal | None = None
    receipt_image_url: str | None = None


class GivingOut(BaseModel):
    id: str
    transaction_id: str
    giving_arm: GivingArm
    realm: Realm
    recipient: str | None
    charity_registration_number: str | None
    pledge_fulfilled_status: PledgeStatus
    pledge_total: Decimal | None
    tax_deductible_flag: bool
    official_receipt_received: bool
    tax_year: int | None


class ArmRuleOut(BaseModel):
    arm: GivingArm
    realm: Realm
    display_name: str
    default_tax_deductible: bool
    requires_registered_charity: bool
    cra_note: str | None


class GivingSummary(BaseModel):
    tax_year: int
    total_given: Decimal
    receiptable_total: Decimal
    non_receiptable_total: Decimal
    by_arm: dict[str, Decimal]
    by_realm: dict[str, Decimal]
    estimated_federal_credit: Decimal
    outstanding_pledges: Decimal


# ------------------------------------------------------------------- OCR

class OcrLineItem(BaseModel):
    description: str
    amount: Decimal
    suggested_giving_arm: GivingArm | None = None


class OcrResult(BaseModel):
    document_type: str  # "receipt" | "giving_statement" | "unknown"
    merchant: str | None = None
    charity_registration_number: str | None = None
    date: DateType | None = None
    total: Decimal | None = None
    currency: str = "CAD"
    line_items: list[OcrLineItem] = []
    suggested_category: str | None = None
    suggested_giving_arm: GivingArm | None = None
    tax_deductible_flag: bool = False
    confidence: float = 0.0
    notes: str | None = None


# ---------------------------------------------------------------- limits

class CanadianLimits(BaseModel):
    tax_year: int
    tfsa_annual_limit: Decimal
    rrsp_dollar_limit: Decimal
    rrsp_income_pct: Decimal
    fhsa_annual_limit: Decimal
    fhsa_lifetime_limit: Decimal
    charitable_income_cap_pct: Decimal


class ContributionRoom(BaseModel):
    tax_year: int
    tfsa_room: Decimal
    rrsp_room: Decimal
    fhsa_room: Decimal
    charitable_claim_cap: Decimal
