# Kosine Finance

Canadian personal finance and Kingdom stewardship for ministers, leaders and church members.

```
supabase/migrations/0001_init.sql   schema, RLS, giving taxonomy, CRA rules, 2026 limits
backend/                            FastAPI + Supabase + GPT-4o Vision OCR
frontend/                           Next.js 14 (App Router), Tailwind, Framer Motion
```

## Run it

**1. Database** — in the Supabase SQL editor, run `supabase/migrations/0001_init.sql`.
Then create a private Storage bucket named `receipts`.

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

`POST /api/ocr/scan` sends the image to GPT-4o Vision with a JSON-only schema, then maps each
line onto a giving arm — by the model's own label where it is valid, otherwise by keyword
("rhapsody", "healing school", "firstfruit", "honorarium"…). Deductibility is recomputed
locally afterwards, so a hallucinated flag can never reach a tax return. Nothing is written:
the client reviews the extraction and then posts to `/api/giving`.

## Security

Isolation is enforced by Postgres, not by application code. Each request builds a Supabase
client bound to the caller's JWT (`backend/app/deps.py`), so every query runs under the
`*_owner` RLS policies. The service-role key is used only for Storage and reference data.

## Not yet built

Supabase Auth screens (sign-in/sign-up), bank-feed import, provincial credit rates beyond the
federal calculation, pledge schedules with reminders, and T1 export. The 2026 figures
(TFSA $7,000, RRSP $33,810, FHSA $8,000/$40,000) are hardcoded in
`backend/app/routers/canada.py` and `public.canadian_limits` — confirm them against the CRA
before filing, and confirm any charity's registration number in the CRA charities listing.

Estimates only; not tax advice.
