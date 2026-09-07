from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

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
