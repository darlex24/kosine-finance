"""Canadian registered-account limits and contribution room."""

from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status

from ..config import Settings, get_settings
from ..deps import CurrentUser, get_current_user
from ..schemas import CanadianLimits, ContributionRoom

router = APIRouter()

# 2026 figures, mirrored from public.canadian_limits so the API answers even
# before the migration has been applied.
LIMITS_2026 = CanadianLimits(
    tax_year=2026,
    tfsa_annual_limit=Decimal("7000"),
    rrsp_dollar_limit=Decimal("33810"),
    rrsp_income_pct=Decimal("0.18"),
    fhsa_annual_limit=Decimal("8000"),
    fhsa_lifetime_limit=Decimal("40000"),
    charitable_income_cap_pct=Decimal("0.75"),
)

LIMITS: dict[int, CanadianLimits] = {2026: LIMITS_2026}


@router.get("/canada/limits", response_model=CanadianLimits)
def get_limits(tax_year: int | None = None, settings: Settings = Depends(get_settings)):
    year = tax_year or settings.current_tax_year
    limits = LIMITS.get(year)
    if limits is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No limits on file for {year}")
    return limits


@router.get("/canada/room", response_model=ContributionRoom)
def contribution_room(
    earned_income: Decimal,
    tfsa_contributed: Decimal = Decimal("0"),
    rrsp_contributed: Decimal = Decimal("0"),
    fhsa_contributed: Decimal = Decimal("0"),
    tax_year: int | None = None,
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    """Current-year room only — carry-forward needs the CRA Notice of Assessment."""
    limits = get_limits(tax_year, settings)
    rrsp_limit = min(earned_income * limits.rrsp_income_pct, limits.rrsp_dollar_limit)

    def remaining(limit: Decimal, used: Decimal) -> Decimal:
        return max(limit - used, Decimal("0")).quantize(Decimal("0.01"))

    return ContributionRoom(
        tax_year=limits.tax_year,
        tfsa_room=remaining(limits.tfsa_annual_limit, tfsa_contributed),
        rrsp_room=remaining(rrsp_limit, rrsp_contributed),
        fhsa_room=remaining(limits.fhsa_annual_limit, fhsa_contributed),
        charitable_claim_cap=(earned_income * limits.charitable_income_cap_pct).quantize(
            Decimal("0.01")
        ),
    )
