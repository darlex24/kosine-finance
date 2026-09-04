-- Kosine Finance V2 — global taxonomy, multi-currency and the net-worth inputs.
-- Purely additive: 0001 objects are extended, never dropped.

-- ---------------------------------------------------------------- currencies

create table public.currencies (
  code char(3) primary key,
  name text not null,
  symbol text not null,
  decimal_digits smallint not null default 2
);

insert into public.currencies (code, name, symbol, decimal_digits) values
  ('AED','UAE Dirham','د.إ',2),
  ('ARS','Argentine Peso','$',2),
  ('AUD','Australian Dollar','A$',2),
  ('BDT','Bangladeshi Taka','৳',2),
  ('BGN','Bulgarian Lev','лв',2),
  ('BRL','Brazilian Real','R$',2),
  ('BWP','Botswana Pula','P',2),
  ('CAD','Canadian Dollar','$',2),
  ('CHF','Swiss Franc','CHF',2),
  ('CLP','Chilean Peso','$',0),
  ('CNY','Chinese Yuan','¥',2),
  ('COP','Colombian Peso','$',2),
  ('CZK','Czech Koruna','Kč',2),
  ('DKK','Danish Krone','kr',2),
  ('EGP','Egyptian Pound','E£',2),
  ('ETB','Ethiopian Birr','Br',2),
  ('EUR','Euro','€',2),
  ('GBP','Pound Sterling','£',2),
  ('GHS','Ghanaian Cedi','₵',2),
  ('HKD','Hong Kong Dollar','HK$',2),
  ('HUF','Hungarian Forint','Ft',2),
  ('IDR','Indonesian Rupiah','Rp',2),
  ('ILS','Israeli New Shekel','₪',2),
  ('INR','Indian Rupee','₹',2),
  ('JMD','Jamaican Dollar','J$',2),
  ('JPY','Japanese Yen','¥',0),
  ('KES','Kenyan Shilling','KSh',2),
  ('KRW','South Korean Won','₩',0),
  ('LKR','Sri Lankan Rupee','Rs',2),
  ('MAD','Moroccan Dirham','د.م.',2),
  ('MUR','Mauritian Rupee','₨',2),
  ('MWK','Malawian Kwacha','MK',2),
  ('MXN','Mexican Peso','$',2),
  ('MYR','Malaysian Ringgit','RM',2),
  ('NAD','Namibian Dollar','N$',2),
  ('NGN','Nigerian Naira','₦',2),
  ('NOK','Norwegian Krone','kr',2),
  ('NZD','New Zealand Dollar','NZ$',2),
  ('PHP','Philippine Peso','₱',2),
  ('PKR','Pakistani Rupee','₨',2),
  ('PLN','Polish Zloty','zł',2),
  ('QAR','Qatari Riyal','ر.ق',2),
  ('RON','Romanian Leu','lei',2),
  ('RSD','Serbian Dinar','дин',2),
  ('RWF','Rwandan Franc','FRw',0),
  ('SAR','Saudi Riyal','ر.س',2),
  ('SEK','Swedish Krona','kr',2),
  ('SGD','Singapore Dollar','S$',2),
  ('THB','Thai Baht','฿',2),
  ('TRY','Turkish Lira','₺',2),
  ('TTD','Trinidad & Tobago Dollar','TT$',2),
  ('TZS','Tanzanian Shilling','TSh',2),
  ('UAH','Ukrainian Hryvnia','₴',2),
  ('UGX','Ugandan Shilling','USh',0),
  ('USD','United States Dollar','$',2),
  ('VND','Vietnamese Dong','₫',0),
  ('XAF','Central African CFA Franc','FCFA',0),
  ('XOF','West African CFA Franc','CFA',0),
  ('ZAR','South African Rand','R',2),
  ('ZMW','Zambian Kwacha','ZK',2)
on conflict (code) do nothing;

-- ---------------------------------------------------------------- FX rates

create table public.fx_rates (
  base  char(3) not null references public.currencies (code),
  quote char(3) not null references public.currencies (code),
  rate_date date not null,
  rate numeric(18, 8) not null check (rate > 0),
  fetched_at timestamptz not null default now(),
  primary key (base, quote, rate_date)
);
create index fx_rates_lookup_idx on public.fx_rates (base, quote, rate_date desc);

-- The single conversion primitive. Uses the newest rate on or before the given
-- date; falls back to the newest rate we hold, then to the inverse pair.
create or replace function public.fx_convert(
  amount numeric,
  from_ccy char(3),
  to_ccy char(3),
  on_date date default current_date
) returns numeric
language sql stable as $$
  select case
    when amount is null then null
    when from_ccy is null or to_ccy is null or from_ccy = to_ccy then amount
    else amount * coalesce(
      (select r.rate from public.fx_rates r
        where r.base = from_ccy and r.quote = to_ccy and r.rate_date <= on_date
        order by r.rate_date desc limit 1),
      (select r.rate from public.fx_rates r
        where r.base = from_ccy and r.quote = to_ccy
        order by r.rate_date desc limit 1),
      (select 1 / r.rate from public.fx_rates r
        where r.base = to_ccy and r.quote = from_ccy and r.rate_date <= on_date
        order by r.rate_date desc limit 1),
      (select 1 / r.rate from public.fx_rates r
        where r.base = to_ccy and r.quote = from_ccy
        order by r.rate_date desc limit 1),
      1
    )
  end;
$$;

-- ------------------------------------------------------- users go global

alter table public.users
  add column if not exists base_currency char(3) not null default 'CAD'
    references public.currencies (code),
  add column if not exists country_code char(2) not null default 'CA';

-- ---------------------------------------------------------------- taxonomy

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  parent_id uuid references public.expense_categories (id) on delete cascade,
  name text not null,
  "group" text not null,
  icon text,
  is_giving boolean not null default false,
  sort_order int not null default 0,
  is_system boolean not null default true,
  user_id uuid references public.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index expense_categories_parent_idx on public.expense_categories (parent_id);
create index expense_categories_user_idx on public.expense_categories (user_id);

-- Groups first (parent rows), then children resolved by slug.
insert into public.expense_categories (slug, name, "group", icon, is_giving, sort_order) values
  ('housing','Housing','Housing','home',false,10),
  ('utilities','Utilities','Utilities','zap',false,20),
  ('food','Food & Groceries','Food & Groceries','shopping-basket',false,30),
  ('transport','Transport','Transport','car',false,40),
  ('health','Health & Medical','Health & Medical','heart-pulse',false,50),
  ('insurance','Insurance','Insurance','shield',false,60),
  ('education','Education','Education','graduation-cap',false,70),
  ('family','Family & Childcare','Family & Childcare','baby',false,80),
  ('personal','Personal & Clothing','Personal & Clothing','shirt',false,90),
  ('ministry','Ministry & Church','Ministry & Church','church',false,100),
  ('giving','Giving & Charity','Giving & Charity','hand-heart',true,110),
  ('business','Business & Professional','Business & Professional','briefcase',false,120),
  ('taxes','Taxes & Government','Taxes & Government','landmark',false,130),
  ('debt','Debt & Loan Repayment','Debt & Loan Repayment','credit-card',false,140),
  ('savings_investment','Savings & Investment','Savings & Investment','trending-up',false,150),
  ('travel','Travel','Travel','plane',false,160),
  ('communications','Communications & Digital','Communications & Digital','wifi',false,170),
  ('fees','Fees & Charges','Fees & Charges','receipt',false,180),
  ('gifts','Gifts & Celebrations','Gifts & Celebrations','gift',false,190),
  ('income','Income','Income','wallet',false,200),
  ('other','Other','Other','circle-dashed',false,999)
on conflict (slug) do nothing;

insert into public.expense_categories (slug, parent_id, name, "group", is_giving, sort_order)
select c.slug, p.id, c.name, p."group", p.is_giving, c.sort_order
from (values
  ('housing_rent','housing','Rent',1),
  ('housing_mortgage','housing','Mortgage Payment',2),
  ('housing_property_tax','housing','Property Tax / Rates',3),
  ('housing_maintenance','housing','Repairs & Maintenance',4),
  ('housing_furnishings','housing','Furnishings & Appliances',5),
  ('housing_service_charge','housing','Service & Estate Charges',6),
  ('utilities_electricity','utilities','Electricity',1),
  ('utilities_water','utilities','Water & Sewage',2),
  ('utilities_gas','utilities','Gas & Heating',3),
  ('utilities_waste','utilities','Waste & Sanitation',4),
  ('utilities_generator','utilities','Generator & Fuel',5),
  ('utilities_solar','utilities','Solar & Battery',6),
  ('food_groceries','food','Groceries',1),
  ('food_dining','food','Dining Out',2),
  ('food_delivery','food','Food Delivery',3),
  ('food_beverages','food','Beverages & Coffee',4),
  ('food_hospitality','food','Hospitality & Entertaining',5),
  ('transport_fuel','transport','Fuel',1),
  ('transport_public','transport','Public Transit',2),
  ('transport_ride_hailing','transport','Ride Hailing & Taxi',3),
  ('transport_maintenance','transport','Vehicle Maintenance',4),
  ('transport_parking','transport','Parking & Tolls',5),
  ('transport_licensing','transport','Licensing & Registration',6),
  ('health_consultation','health','Doctor & Consultation',1),
  ('health_pharmacy','health','Pharmacy & Medication',2),
  ('health_dental','health','Dental',3),
  ('health_optical','health','Optical',4),
  ('health_therapy','health','Therapy & Counselling',5),
  ('health_fitness','health','Fitness & Wellness',6),
  ('insurance_health','insurance','Health Insurance',1),
  ('insurance_life','insurance','Life Insurance',2),
  ('insurance_auto','insurance','Auto Insurance',3),
  ('insurance_home','insurance','Home & Contents Insurance',4),
  ('insurance_travel','insurance','Travel Insurance',5),
  ('education_tuition','education','Tuition & Fees',1),
  ('education_books','education','Books & Materials',2),
  ('education_courses','education','Courses & Certification',3),
  ('education_conferences','education','Conferences & Seminars',4),
  ('family_childcare','family','Childcare & Nanny',1),
  ('family_school','family','Children''s Schooling',2),
  ('family_support','family','Family Support & Remittance',3),
  ('family_activities','family','Children''s Activities',4),
  ('personal_clothing','personal','Clothing & Footwear',1),
  ('personal_grooming','personal','Grooming & Barbering',2),
  ('personal_laundry','personal','Laundry & Dry Cleaning',3),
  ('personal_leisure','personal','Leisure & Recreation',4),
  ('ministry_travel','ministry','Ministry Travel',1),
  ('ministry_materials','ministry','Ministry Materials & Literature',2),
  ('ministry_hospitality','ministry','Ministry Hospitality',3),
  ('ministry_equipment','ministry','Ministry Equipment & Media',4),
  ('ministry_venue','ministry','Venue & Event Hire',5),
  ('ministry_vestments','ministry','Vestments & Apparel',6),
  ('giving_tithe','giving','Tithe',1),
  ('giving_offering','giving','Offering',2),
  ('giving_partnership','giving','Ministry Partnership',3),
  ('giving_seed','giving','Seed & Special Giving',4),
  ('giving_alms','giving','Alms & Benevolence',5),
  ('business_supplies','business','Supplies & Equipment',1),
  ('business_software','business','Software & Subscriptions',2),
  ('business_professional_fees','business','Professional Fees',3),
  ('business_marketing','business','Marketing & Advertising',4),
  ('business_payroll','business','Payroll & Contractors',5),
  ('taxes_income','taxes','Income Tax',1),
  ('taxes_sales','taxes','Sales Tax / VAT',2),
  ('taxes_social','taxes','Social Security & Pension Contributions',3),
  ('taxes_permits','taxes','Permits & Government Fees',4),
  ('debt_credit_card','debt','Credit Card Repayment',1),
  ('debt_personal_loan','debt','Personal Loan Repayment',2),
  ('debt_student_loan','debt','Student Loan Repayment',3),
  ('debt_interest','debt','Interest Charges',4),
  ('savings_emergency','savings_investment','Emergency Fund',1),
  ('savings_deposit','savings_investment','Savings Deposit',2),
  ('savings_retirement','savings_investment','Retirement Contribution',3),
  ('savings_brokerage','savings_investment','Brokerage / Securities',4),
  ('savings_crypto','savings_investment','Crypto Purchase',5),
  ('savings_real_estate','savings_investment','Real Estate Investment',6),
  ('travel_flights','travel','Flights',1),
  ('travel_lodging','travel','Lodging',2),
  ('travel_ground','travel','Ground Transport',3),
  ('travel_visa','travel','Visa & Documentation',4),
  ('travel_per_diem','travel','Meals & Per Diem',5),
  ('comms_mobile','communications','Mobile & Airtime',1),
  ('comms_internet','communications','Internet & Data',2),
  ('comms_streaming','communications','Streaming & Media',3),
  ('comms_hardware','communications','Devices & Hardware',4),
  ('fees_bank','fees','Bank Charges',1),
  ('fees_transfer','fees','Transfer & Remittance Fees',2),
  ('fees_platform','fees','Platform & Brokerage Fees',3),
  ('fees_penalty','fees','Penalties & Late Fees',4),
  ('gifts_personal','gifts','Personal Gifts',1),
  ('gifts_celebration','gifts','Celebrations & Events',2),
  ('gifts_condolence','gifts','Condolence & Support',3),
  ('income_salary','income','Salary & Wages',1),
  ('income_honorarium','income','Honorarium & Ministry Income',2),
  ('income_business','income','Business Income',3),
  ('income_investment','income','Investment Income',4),
  ('income_rental','income','Rental Income',5),
  ('income_gift_received','income','Gifts Received',6),
  ('other_uncategorised','other','Uncategorised',1)
) as c(slug, parent_slug, name, sort_order)
join public.expense_categories p on p.slug = c.parent_slug
on conflict (slug) do nothing;

-- ------------------------------------------------------ investment platforms

create type platform_kind as enum (
  'brokerage', 'crypto_exchange', 'robo_advisor', 'bank',
  'pension', 'real_estate', 'p2p_lending', 'other'
);

create table public.investment_platforms (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  kind platform_kind not null,
  country_code char(2),              -- null = globally available
  website text,
  is_system boolean not null default true,
  user_id uuid references public.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index investment_platforms_user_idx on public.investment_platforms (user_id);

insert into public.investment_platforms (slug, name, kind, country_code, website) values
  ('interactive_brokers','Interactive Brokers','brokerage',null,'interactivebrokers.com'),
  ('vanguard','Vanguard','brokerage',null,'vanguard.com'),
  ('fidelity','Fidelity','brokerage',null,'fidelity.com'),
  ('charles_schwab','Charles Schwab','brokerage','US','schwab.com'),
  ('robinhood','Robinhood','brokerage','US','robinhood.com'),
  ('wealthsimple','Wealthsimple','robo_advisor','CA','wealthsimple.com'),
  ('questrade','Questrade','brokerage','CA','questrade.com'),
  ('rbc_direct_investing','RBC Direct Investing','brokerage','CA','rbcdirectinvesting.com'),
  ('td_direct_investing','TD Direct Investing','brokerage','CA','td.com'),
  ('hargreaves_lansdown','Hargreaves Lansdown','brokerage','GB','hl.co.uk'),
  ('trading212','Trading 212','brokerage',null,'trading212.com'),
  ('etoro','eToro','brokerage',null,'etoro.com'),
  ('degiro','DEGIRO','brokerage',null,'degiro.com'),
  ('revolut','Revolut','bank',null,'revolut.com'),
  ('wise','Wise','bank',null,'wise.com'),
  ('zerodha','Zerodha','brokerage','IN','zerodha.com'),
  ('groww','Groww','brokerage','IN','groww.in'),
  ('easyequities','EasyEquities','brokerage','ZA','easyequities.co.za'),
  ('bamboo','Bamboo','brokerage','NG','investbamboo.com'),
  ('risevest','Risevest','brokerage','NG','risevest.com'),
  ('piggyvest','PiggyVest','bank','NG','piggyvest.com'),
  ('cowrywise','Cowrywise','robo_advisor','NG','cowrywise.com'),
  ('chipper_cash','Chipper Cash','bank',null,'chippercash.com'),
  ('binance','Binance','crypto_exchange',null,'binance.com'),
  ('coinbase','Coinbase','crypto_exchange',null,'coinbase.com'),
  ('kraken','Kraken','crypto_exchange',null,'kraken.com'),
  ('luno','Luno','crypto_exchange',null,'luno.com'),
  ('quidax','Quidax','crypto_exchange','NG','quidax.com'),
  ('ledger_wallet','Self-Custody Wallet','crypto_exchange',null,null),
  ('employer_pension','Employer Pension Scheme','pension',null,null),
  ('government_pension','Government Pension / Social Security','pension',null,null),
  ('direct_property','Direct Property Holding','real_estate',null,null),
  ('reit','REIT / Property Fund','real_estate',null,null),
  ('other_platform','Other Platform','other',null,null)
on conflict (slug) do nothing;

-- --------------------------------------------------- assets & liabilities

create type asset_class as enum (
  'cash', 'equity', 'fund', 'crypto', 'bond', 'real_estate',
  'business', 'retirement', 'insurance', 'collectible', 'other'
);

create type liability_kind as enum (
  'mortgage', 'credit_card', 'student_loan', 'personal_loan',
  'auto_loan', 'business_loan', 'tax_owing', 'other'
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null,
  asset_class asset_class not null,
  platform_id uuid references public.investment_platforms (id) on delete set null,
  account_id uuid references public.accounts (id) on delete set null,
  currency char(3) not null default 'CAD' references public.currencies (code),
  quantity numeric(20, 8),
  unit_cost numeric(20, 8),
  current_value numeric(18, 2) not null default 0,
  as_of date not null default current_date,
  notes text,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index assets_user_idx on public.assets (user_id) where not is_archived;

create table public.liabilities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null,
  liability_kind liability_kind not null,
  currency char(3) not null default 'CAD' references public.currencies (code),
  current_balance numeric(18, 2) not null default 0,
  interest_rate numeric(6, 4),
  minimum_payment numeric(18, 2),
  as_of date not null default current_date,
  notes text,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index liabilities_user_idx on public.liabilities (user_id) where not is_archived;

create table public.net_worth_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  captured_on date not null default current_date,
  base_currency char(3) not null references public.currencies (code),
  total_assets numeric(18, 2) not null default 0,
  total_liabilities numeric(18, 2) not null default 0,
  net_worth numeric(18, 2) not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, captured_on)
);
create index net_worth_snapshots_user_idx
  on public.net_worth_snapshots (user_id, captured_on desc);

-- ---------------------------------------------------------------- RLS

alter table public.currencies           enable row level security;
alter table public.fx_rates             enable row level security;
alter table public.expense_categories   enable row level security;
alter table public.investment_platforms enable row level security;
alter table public.assets               enable row level security;
alter table public.liabilities          enable row level security;
alter table public.net_worth_snapshots  enable row level security;

-- Reference data: readable by any signed-in user, writable only by the service role.
create policy currencies_read on public.currencies
  for select using (auth.role() = 'authenticated');
create policy fx_rates_read on public.fx_rates
  for select using (auth.role() = 'authenticated');

-- Catalogue tables: system rows plus the user's own custom rows.
create policy categories_read on public.expense_categories
  for select using (user_id is null or user_id = auth.uid());
create policy categories_write on public.expense_categories
  for insert with check (user_id = auth.uid() and not is_system);
create policy categories_update on public.expense_categories
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy categories_delete on public.expense_categories
  for delete using (user_id = auth.uid());

create policy platforms_read on public.investment_platforms
  for select using (user_id is null or user_id = auth.uid());
create policy platforms_write on public.investment_platforms
  for insert with check (user_id = auth.uid() and not is_system);
create policy platforms_update on public.investment_platforms
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy platforms_delete on public.investment_platforms
  for delete using (user_id = auth.uid());

create policy assets_owner on public.assets
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy liabilities_owner on public.liabilities
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy snapshots_owner on public.net_worth_snapshots
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------- triggers

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger assets_touch before update on public.assets
  for each row execute function public.set_updated_at();
create trigger liabilities_touch before update on public.liabilities
  for each row execute function public.set_updated_at();

-- Carry the signup country/currency choice through to public.users.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email, full_name, base_currency, country_code)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    coalesce(upper(new.raw_user_meta_data ->> 'base_currency'), 'CAD'),
    coalesce(upper(new.raw_user_meta_data ->> 'country_code'), 'CA')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
