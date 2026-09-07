import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .services.ratelimit import write_limit_middleware
from .routers import (
    assets,
    budget,
    canada,
    catalog,
    core,
    giving,
    ledger,
    networth,
    ocr,
)

settings = get_settings()

app = FastAPI(
    title="Kosine Finance API",
    description=(
        "Global financial stewardship, investment and net-worth tracking "
        "for ministers of the gospel."
    ),
    version="2.0.0",
)

# "*" with allow_credentials is the classic cross-origin account-takeover
# combination — any site could then call the API as a signed-in user. The
# browser spec forbids it, but relying on that leaves the app one config change
# from a silent hole, so refuse the combination outright at startup.
_origins = settings.cors_origin_list
if "*" in _origins:
    raise RuntimeError(
        "CORS_ORIGINS must list explicit origins, not '*', because the API is "
        "served with credentials. Set it to your deployed frontend URL."
    )

# Everything below is checked at import so a misconfigured deploy dies on the
# first boot, loudly, instead of serving traffic and failing later on whichever
# request happens to need the missing piece.
_problems: list[str] = []

if not settings.supabase_url or "placeholder" in settings.supabase_url.lower():
    _problems.append("SUPABASE_URL is unset or still a placeholder")
if not settings.supabase_anon_key:
    _problems.append("SUPABASE_ANON_KEY is unset")
if not settings.supabase_service_role_key or "placeholder" in settings.supabase_service_role_key.lower():
    _problems.append(
        "SUPABASE_SERVICE_ROLE_KEY is unset or a placeholder — receipt storage "
        "and account deletion cannot work without it"
    )

_is_production = os.getenv("ENVIRONMENT", "development").lower() in {"production", "prod"}
if _is_production:
    if any(o.startswith("http://") and "localhost" not in o for o in _origins):
        _problems.append("CORS_ORIGINS contains a plaintext http:// origin")
    if not _origins or all("localhost" in o for o in _origins):
        _problems.append(
            "CORS_ORIGINS still points at localhost — set it to the deployed frontend URL"
        )
    if not settings.openai_api_key:
        # A warning, not a failure: everything except receipt scanning works.
        logging.getLogger(__name__).warning(
            "OPENAI_API_KEY is unset — receipt scanning will return 503."
        )

if _problems:
    raise RuntimeError(
        "Refusing to start with an incomplete configuration: " + "; ".join(_problems)
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    # Must cover every method the routers actually expose. Omitting one does
    # not fail loudly: the browser blocks the preflight, fetch rejects, and the
    # client reports it as "could not reach the API". test_cors_allows_every
    # _method_the_api_uses keeps this list honest.
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.middleware("http")(write_limit_middleware)

app.include_router(core.router, prefix="/api", tags=["core"])
app.include_router(giving.router, prefix="/api", tags=["giving"])
app.include_router(ocr.router, prefix="/api", tags=["ocr"])
app.include_router(canada.router, prefix="/api", tags=["canada"])
app.include_router(catalog.router, prefix="/api", tags=["catalog"])
app.include_router(budget.router, prefix="/api", tags=["budget"])
app.include_router(ledger.router, prefix="/api", tags=["ledger"])
app.include_router(assets.router, prefix="/api", tags=["assets"])
app.include_router(networth.router, prefix="/api", tags=["net worth"])


@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok", "tax_year": settings.current_tax_year}
