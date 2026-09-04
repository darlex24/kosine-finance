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
    currency: str = "CAD"


class AccountOut(AccountIn):
    id: str


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
    currency: str | None = None       # defaults to the user's base currency
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
    suggested_category_slug: str | None = None
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


# ------------------------------------------------------------ V2: profile

class ProfileOut(BaseModel):
    id: str
    email: str
    full_name: str | None = None
    ministry_role: MinistryRole = MinistryRole.MEMBER
    home_church: str | None = None
    base_currency: str = "CAD"
    country_code: str = "CA"
    default_province: str | None = None


class ProfileIn(BaseModel):
    full_name: str | None = None
    ministry_role: MinistryRole | None = None
    home_church: str | None = None
    base_currency: str | None = None
    country_code: str | None = None
    default_province: str | None = None


# ------------------------------------------------------------ V2: catalog

class CurrencyOut(BaseModel):
    code: str
    name: str
    symbol: str
    decimal_digits: int = 2


class CategoryOut(BaseModel):
    id: str
    slug: str
    parent_id: str | None = None
    name: str
    group: str
    icon: str | None = None
    is_giving: bool = False
    sort_order: int = 0
    is_system: bool = True


class CategoryIn(BaseModel):
    name: str
    parent_id: str | None = None
    group: str = "Other"
    icon: str | None = None


class PlatformKind(str, Enum):
    BROKERAGE = "brokerage"
    CRYPTO_EXCHANGE = "crypto_exchange"
    ROBO_ADVISOR = "robo_advisor"
    BANK = "bank"
    PENSION = "pension"
    REAL_ESTATE = "real_estate"
    P2P_LENDING = "p2p_lending"
    OTHER = "other"


class PlatformIn(BaseModel):
    name: str
    kind: PlatformKind = PlatformKind.OTHER
    country_code: str | None = None
    website: str | None = None


class PlatformOut(PlatformIn):
    id: str
    slug: str
    is_system: bool = True


# --------------------------------------------------- V2: assets & liabilities

class AssetClass(str, Enum):
    CASH = "cash"
    EQUITY = "equity"
    FUND = "fund"
    CRYPTO = "crypto"
    BOND = "bond"
    REAL_ESTATE = "real_estate"
    BUSINESS = "business"
    RETIREMENT = "retirement"
    INSURANCE = "insurance"
    COLLECTIBLE = "collectible"
    OTHER = "other"


class LiabilityKind(str, Enum):
    MORTGAGE = "mortgage"
    CREDIT_CARD = "credit_card"
    STUDENT_LOAN = "student_loan"
    PERSONAL_LOAN = "personal_loan"
    AUTO_LOAN = "auto_loan"
    BUSINESS_LOAN = "business_loan"
    TAX_OWING = "tax_owing"
    OTHER = "other"


class AssetIn(BaseModel):
    name: str
    asset_class: AssetClass
    platform_id: str | None = None
    account_id: str | None = None
    currency: str = "CAD"
    quantity: Decimal | None = None
    unit_cost: Decimal | None = None
    current_value: Decimal = Decimal("0")
    as_of: DateType | None = None
    notes: str | None = None
    is_archived: bool = False


class AssetOut(AssetIn):
    id: str


class AssetPatch(BaseModel):
    name: str | None = None
    asset_class: AssetClass | None = None
    platform_id: str | None = None
    account_id: str | None = None
    currency: str | None = None
    quantity: Decimal | None = None
    unit_cost: Decimal | None = None
    current_value: Decimal | None = None
    as_of: DateType | None = None
    notes: str | None = None
    is_archived: bool | None = None


class LiabilityIn(BaseModel):
    name: str
    liability_kind: LiabilityKind
    currency: str = "CAD"
    current_balance: Decimal = Decimal("0")
    interest_rate: Decimal | None = None
    minimum_payment: Decimal | None = None
    as_of: DateType | None = None
    notes: str | None = None
    is_archived: bool = False


class LiabilityOut(LiabilityIn):
    id: str


class LiabilityPatch(BaseModel):
    name: str | None = None
    liability_kind: LiabilityKind | None = None
    currency: str | None = None
    current_balance: Decimal | None = None
    interest_rate: Decimal | None = None
    minimum_payment: Decimal | None = None
    as_of: DateType | None = None
    notes: str | None = None
    is_archived: bool | None = None


# ------------------------------------------------------------ V2: ledger

class LedgerEntryType(str, Enum):
    EXPENSE = "expense"
    INCOME = "income"
    TRANSFER = "transfer"
    SAVINGS = "savings"
    INVESTMENT = "investment"
    GIVING = "giving"


class EntrySource(str, Enum):
    MANUAL = "manual"
    OCR = "ocr"
    IMPORT = "import"


class LedgerRowIn(BaseModel):
    date: DateType
    entry_type: LedgerEntryType = LedgerEntryType.EXPENSE
    amount: Decimal
    currency: str = "CAD"
    category_id: str | None = None
    category_slug: str | None = None      # convenience for OCR / imports
    platform_id: str | None = None
    account_id: str | None = None
    budget_id: str | None = None
    merchant: str | None = None
    memo: str | None = None
    tags: list[str] = []
    source: EntrySource = EntrySource.MANUAL
    receipt_image_url: str | None = None
    receipt_storage_path: str | None = None
    ocr_confidence: float | None = None

    # Present only for entry_type = giving; upserts kingdom_giving_records.
    giving_arm: GivingArm | None = None
    giving_recipient: str | None = None
    charity_registration_number: str | None = None
    pledge_fulfilled_status: PledgeStatus | None = None
    pledge_total: Decimal | None = None


class LedgerRowPatch(BaseModel):
    """Every field optional — this is what makes mistake correction cheap."""

    date: DateType | None = None
    entry_type: LedgerEntryType | None = None
    amount: Decimal | None = None
    currency: str | None = None
    category_id: str | None = None
    platform_id: str | None = None
    account_id: str | None = None
    merchant: str | None = None
    memo: str | None = None
    tags: list[str] | None = None
    receipt_image_url: str | None = None

    giving_arm: GivingArm | None = None
    giving_recipient: str | None = None
    charity_registration_number: str | None = None
    pledge_fulfilled_status: PledgeStatus | None = None
    pledge_total: Decimal | None = None


class LedgerRowOut(BaseModel):
    id: str
    date: DateType
    entry_type: LedgerEntryType
    amount: Decimal
    currency: str
    base_amount: Decimal
    base_currency: str
    fx_rate: Decimal
    merchant: str | None = None
    memo: str | None = None
    tags: list[str] = []
    source: EntrySource = EntrySource.MANUAL
    receipt_image_url: str | None = None
    receipt_storage_path: str | None = None
    ocr_confidence: float | None = None
    category_id: str | None = None
    category_slug: str | None = None
    category_name: str | None = None
    category_group: str | None = None
    category_icon: str | None = None
    platform_id: str | None = None
    platform_name: str | None = None
    account_id: str | None = None
    account_name: str | None = None
    giving_record_id: str | None = None
    giving_arm: GivingArm | None = None
    giving_realm: Realm | None = None
    giving_recipient: str | None = None
    tax_deductible_flag: bool | None = None
    pledge_fulfilled_status: PledgeStatus | None = None
    tax_year: int | None = None


class LedgerPage(BaseModel):
    rows: list[LedgerRowOut]
    next_cursor: str | None = None


class BulkDeleteIn(BaseModel):
    ids: list[str]


# ---------------------------------------------------------- V2: net worth

class NetWorthPoint(BaseModel):
    captured_on: DateType
    net_worth: Decimal


class NetWorthOut(BaseModel):
    base_currency: str
    total_assets: Decimal
    total_liabilities: Decimal
    net_worth: Decimal
    liquid_cash: Decimal
    investable_assets: Decimal
    previous_net_worth: Decimal | None = None
    change_amount: Decimal | None = None
    change_pct: float | None = None
    trend: list[NetWorthPoint] = []


class CashFlowPoint(BaseModel):
    year: int
    month: int
    entry_type: LedgerEntryType
    total: Decimal


class AnnualSummary(BaseModel):
    """One year of the ledger, rolled up. Always recalculated from the entries,
    never frozen — correcting an old row moves its year with it."""

    year: int
    base_currency: str
    income: Decimal
    expenses: Decimal
    giving: Decimal
    saved: Decimal
    net: Decimal
    giving_rate: float | None = None
    savings_rate: float | None = None


class CategorySpend(BaseModel):
    category_group: str
    category_name: str
    total: Decimal


class FxRefreshOut(BaseModel):
    base: str
    rate_date: DateType
    pairs: int


class OcrCommitIn(BaseModel):
    """The user's reviewed OCR extraction, ready to become a ledger row."""

    row: LedgerRowIn
    ocr_raw: dict | None = None
