# Kosine Finance

Global financial stewardship, investment and net-worth tracking for ministers of the gospel.

```
supabase/migrations/0001_init.sql             schema, RLS, giving taxonomy, CRA rules, 2026 limits
supabase/migrations/0002_global_taxonomy.sql  currencies, FX, categories, platforms, assets, liabilities
supabase/migrations/0003_omni_ledger.sql      transactions → multi-currency ledger rows
supabase/migrations/0004_views.sql            net worth, cash flow, ledger and category views
backend/                                      FastAPI + Supabase + GPT-4o Vision OCR
frontend/                                     Next.js 14 (App Router), Tailwind, Framer Motion
```

## What V2 adds

- **Stewardship Dashboard** — a real-time net-worth engine (`v_net_worth`) over assets,
  liabilities and cash, in whatever base currency the user picks, with snapshot history.
- **Omni-Ledger** (`/ledger`) — a spreadsheet-style grid over `transactions` with inline
  editing, keyboard navigation, bulk delete with undo, and filters. Full CRUD: any manual or
  scanned entry can be corrected or removed in place.
- **Multi-currency** — every row stores its native amount *and* a base-currency amount priced
  at that row's own date from `fx_rates`, so historical totals do not drift.
- **Global taxonomy** — ~100 seeded expense categories across 21 groups, plus
  `investment_platforms` covering brokerages, exchanges and banks across regions. Users can
  add their own.
- **Universal OCR** — receipts in any language or currency; `POST /api/ocr/commit` writes the
  reviewed extraction straight into the ledger.
- **Region modules** — the Canadian tax surface (TFSA/RRSP/FHSA, CRA credit) now renders only
  when `users.country_code = 'CA'`. `kingdom_giving_records` is unchanged, and giving now also
  appears in cash flow as its own outflow band.

## Run it

**1. Database** — in the Supabase SQL editor, run the migrations in order: `0001_init.sql`,
`0002_global_taxonomy.sql`, `0003_omni_ledger.sql`, `0004_views.sql`. `0002`–`0004` are
additive and backfill existing rows, so an existing database keeps its data.
Then create a private Storage bucket named `receipts`.

**1b. Exchange rates** — once the API is up, call `POST /api/fx/refresh` (ECB reference rates
via Frankfurter, no key needed). Until it is called, foreign amounts are stored at par.

**2. Backend**

```bash
cd backend
python -m venv .venv && .venv/Scripts/activate     # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env                                # fill in Supabase + OpenAI keys
uvicorn app.main:app --reload
```

Docs at http://localhost:8000/docs.

**3. Frontend**

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

## How the giving engine works

Every gift is one row in `kingdom_giving_records`, pointing at a `transactions` row that
carries the money. The `giving_arm` enum covers all four realms:

| Realm | Arms |
| --- | --- |
| Core covenant | Tithe, Firstfruit, Free Will Offering, Vow, Pledge, Thanksgiving Offering |
| Ministry partnership | Rhapsody of Realities, Healing School, InnerCity Mission, Loveworld Networks, Campus Ministry, Foundation School, Local Church Project |
| Seeds & special | Special Seed, Prophet/Clergy Honorarium, Building Fund, Land Seed, Crusade Seed, Love Offering |
| Alms & compassion | Alms to the Poor, Benevolence Fund, Widows & Orphans |

### Canadian tax automation

`tax_deductible_flag` is never taken from the user or from the OCR model. It is derived in
three places that agree with each other:

- `public.apply_giving_arm_defaults()` — a `BEFORE INSERT OR UPDATE` trigger, the last word;
- `backend/app/giving.py::is_tax_deductible` — the same rule in the API;
- `frontend/lib/givingArms.ts::isReceiptable` — the same rule for live feedback in the form.

The rule: a gift is receiptable when the arm is receiptable **and**, where the arm requires
it, the recipient carries a CRA registration number. So a tithe to the registered church is
receiptable; a **Prophet/Clergy Honorarium** paid to a minister personally is not (it is a
gift to an individual, and may be taxable income to them); **Alms to the Poor** handed
directly to someone is not; a **Love Offering** is receiptable only through the charity's
general fund. `/api/giving/summary` splits the year into receiptable vs. personal totals and
estimates the federal credit at 15% on the first $200 and 29% above.

### OCR

`POST /api/ocr/scan` sends the image to GPT-4o Vision with a JSON-only schema and reads
receipts from anywhere: it infers the ISO-4217 currency from the printed symbol, tax wording
and locale, normalises the date, and classifies the spend against the seeded category slugs.
Giving statements are additionally mapped onto a giving arm — by the model's own label where
it is valid, otherwise by keyword ("rhapsody", "healing school", "firstfruit", "honorarium"…).

Two things are never trusted from the model: deductibility is recomputed locally, and a
category slug that is not one we seeded is discarded rather than written through.

`/api/ocr/scan` still writes nothing. `POST /api/ocr/commit` takes the extraction *after* the
user has reviewed and corrected it in the scan preview, stores the image, and inserts the
ledger row — so the picture lands in the grid without manual typing, and low-confidence
fields are flagged for review rather than silently accepted.

## Security

Isolation is enforced by Postgres, not by application code. Each request builds a Supabase
client bound to the caller's JWT (`backend/app/deps.py`), so every query runs under the
`*_owner` RLS policies. The V2 views are declared `security_invoker = true`, so reading
`v_net_worth` or `v_ledger_rows` is still subject to the caller's own policies. The
service-role key is used only for Storage and reference data. `frontend/middleware.ts` adds a
server-side session check ahead of the client-side `AuthProvider` gate.

## Not yet built

Bank-feed import, provincial credit rates beyond the federal calculation, pledge schedules
with reminders, T1 export, and live market pricing for holdings (asset values are what you
enter). There is no automated test suite yet. The 2026 figures
(TFSA $7,000, RRSP $33,810, FHSA $8,000/$40,000) are hardcoded in
`backend/app/routers/canada.py` and `public.canadian_limits` — confirm them against the CRA
before filing, and confirm any charity's registration number in the CRA charities listing.

Estimates only; not tax advice.
