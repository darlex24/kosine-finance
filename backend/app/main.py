from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routers import canada, core, giving, ocr

settings = get_settings()

app = FastAPI(
    title="Kosine Finance API",
    description="Canadian personal finance and Kingdom stewardship for ministers and members.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(core.router, prefix="/api", tags=["core"])
app.include_router(giving.router, prefix="/api", tags=["giving"])
app.include_router(ocr.router, prefix="/api", tags=["ocr"])
app.include_router(canada.router, prefix="/api", tags=["canada"])


@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok", "tax_year": settings.current_tax_year}
