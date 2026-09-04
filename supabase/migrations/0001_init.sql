-- Kosine Finance — Kingdom Stewardship schema (PostgreSQL / Supabase)
-- All user-owned tables are protected by Row Level Security.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- enums

create type ministry_role as enum ('minister', 'pastor', 'leader', 'member');

create type account_type as enum (
  'chequing', 'savings', 'tfsa', 'rrsp', 'fhsa', 'resp', 'credit_card', 'cash'
);

-- Every realm and arm of spiritual giving, grouped by realm.
create type giving_realm as enum (
  'core_covenant',        -- tithe, firstfruit, offerings, vows
  'ministry_partnership', -- Rhapsody, Healing School, InnerCity, Loveworld, Campus...
  'seeds_special',        -- special seeds, honorariums, building fund, crusades
  'alms_compassion'       -- alms, benevolence, widows & orphans
);

create type giving_arm as enum (
  -- Core covenant giving
  'tithe',
  'firstfruit',
  'free_will_offering',
  'vow',
  'pledge',
  'thanksgiving_offering',
  -- Ministry partnership arms
  'rhapsody_of_realities',
  'healing_school',
  'innercity_mission',
  'loveworld_networks',
  'campus_ministry',
  'foundation_school',
  'local_church_project',
  -- Seeds & special offerings
  'special_seed',
  'prophet_seed',            -- clergy / minister honorarium
  'building_fund',
  'land_seed',
  'crusade_seed',
  'love_offering',
  -- Alms & compassion
  'alms_to_the_poor',
  'benevolence_fund',
  'widows_and_orphans'
);

create type pledge_status as enum ('not_applicable', 'outstanding', 'partial', 'fulfilled');

-- ---------------------------------------------------------------- users

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text,
  default_province text not null default 'ON',
  ministry_role ministry_role not null default 'member',
  home_church text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- accounts

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null,
  type account_type not null,
  institution text,
  balance numeric(14, 2) not null default 0,
  currency char(3) not null default 'CAD',
  is_archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index accounts_user_idx on public.accounts (user_id);

-- ---------------------------------------------------------------- budgets

create table public.monthly_budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  month smallint not null check (month between 1 and 12),
  year smallint not null check (year between 2000 and 2100),
  total_income numeric(14, 2) not null default 0,
  allocated_giving numeric(14, 2) not null default 0,
  allocated_living numeric(14, 2) not null default 0,
  allocated_savings numeric(14, 2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  unique (user_id, year, month)
);

-- ---------------------------------------------------------------- transactions

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  budget_id uuid references public.monthly_budgets (id) on delete set null,
  account_id uuid references public.accounts (id) on delete set null,
  amount numeric(14, 2) not null,       -- negative = money out
  category text not null,
  date date not null,
  merchant text,
  memo text,
  receipt_image_url text,
  ocr_confidence numeric(4, 3),
  created_at timestamptz not null default now()
);
create index transactions_user_date_idx on public.transactions (user_id, date desc);
create index transactions_budget_idx on public.transactions (budget_id);

-- ---------------------------------------------------------------- kingdom giving

create table public.kingdom_giving_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  giving_arm giving_arm not null,
  realm giving_realm not null,
  recipient text,                        -- e.g. "Christ Embassy Toronto"
  charity_registration_number text,      -- CRA BN, e.g. 123456789RR0001
  pledge_fulfilled_status pledge_status not null default 'not_applicable',
  pledge_total numeric(14, 2),
  tax_deductible_flag boolean not null default false,
  official_receipt_received boolean not null default false,
  tax_year smallint,
  created_at timestamptz not null default now()
);
create index giving_user_year_idx on public.kingdom_giving_records (user_id, tax_year);

-- ---------------------------------------------------------------- Canadian limits

create table public.canadian_limits (
  tax_year smallint primary key,
  tfsa_annual_limit numeric(14, 2) not null,
  rrsp_dollar_limit numeric(14, 2) not null,
  rrsp_income_pct numeric(5, 4) not null default 0.18,
  fhsa_annual_limit numeric(14, 2) not null,
  fhsa_lifetime_limit numeric(14, 2) not null,
  charitable_credit_federal_low numeric(5, 4) not null default 0.15,   -- first $200
  charitable_credit_federal_high numeric(5, 4) not null default 0.29,  -- above $200
  charitable_income_cap_pct numeric(5, 4) not null default 0.75        -- 75% of net income
);

insert into public.canadian_limits (
  tax_year, tfsa_annual_limit, rrsp_dollar_limit, fhsa_annual_limit, fhsa_lifetime_limit
) values
  (2026, 7000, 33810, 8000, 40000)
on conflict (tax_year) do nothing;

-- ------------------------------------------------- CRA deductibility defaults
-- Reference table: which arms may generate an official donation receipt when
-- given to a CRA-registered charity. Honorariums paid personally to a minister
-- and alms handed directly to an individual are NOT receiptable.

create table public.giving_arm_rules (
  giving_arm giving_arm primary key,
  realm giving_realm not null,
  display_name text not null,
  default_tax_deductible boolean not null,
  requires_registered_charity boolean not null default true,
  cra_note text
);

insert into public.giving_arm_rules (giving_arm, realm, display_name, default_tax_deductible, requires_registered_charity, cra_note) values
  ('tithe','core_covenant','Tithe',true,true,'Receiptable when paid to the registered church.'),
  ('firstfruit','core_covenant','Firstfruit',true,true,'Receiptable when paid to the registered church.'),
  ('free_will_offering','core_covenant','Free Will Offering',true,true,'Receiptable if given to the charity, not an individual.'),
  ('vow','core_covenant','Vow',true,true,'Receiptable on payment, not on the promise.'),
  ('pledge','core_covenant','Pledge',true,true,'Only the amount actually paid in the year is receiptable.'),
  ('thanksgiving_offering','core_covenant','Thanksgiving Offering',true,true,null),
  ('rhapsody_of_realities','ministry_partnership','Rhapsody of Realities / Publishing',true,true,'Receiptable only if the receiving entity is CRA-registered.'),
  ('healing_school','ministry_partnership','Healing School',true,true,'Receiptable only if the receiving entity is CRA-registered.'),
  ('innercity_mission','ministry_partnership','InnerCity Mission for Children',true,true,'Receiptable only if the receiving entity is CRA-registered.'),
  ('loveworld_networks','ministry_partnership','Loveworld Networks / Media',true,true,'Receiptable only if the receiving entity is CRA-registered.'),
  ('campus_ministry','ministry_partnership','Campus Ministry',true,true,null),
  ('foundation_school','ministry_partnership','Foundation School',true,true,null),
  ('local_church_project','ministry_partnership','Local Church Project',true,true,null),
  ('special_seed','seeds_special','Special Seed',true,true,'Receiptable if given to the charity with no benefit received in return.'),
  ('prophet_seed','seeds_special','Prophet / Clergy Honorarium',false,false,'A personal gift to an individual minister is a gift, not a donation. Not receiptable; may be taxable income to the recipient.'),
  ('building_fund','seeds_special','Building Fund',true,true,null),
  ('land_seed','seeds_special','Land Seed',true,true,null),
  ('crusade_seed','seeds_special','Crusade / Mega-Event Seed',true,true,'Not receiptable where a ticket or admission benefit is received.'),
  ('love_offering','seeds_special','Love Offering',false,false,'Receiptable only when paid to the general fund of the charity, not designated to a person.'),
  ('alms_to_the_poor','alms_compassion','Alms to the Poor',false,false,'Direct gifts to individuals are never receiptable under CRA rules.'),
  ('benevolence_fund','alms_compassion','Benevolence Fund',true,true,'Receiptable when the charity retains discretion over disbursement.'),
  ('widows_and_orphans','alms_compassion','Widows & Orphans Support',true,true,'Receiptable through the charity program; not when handed to a person.')
on conflict (giving_arm) do nothing;

-- ---------------------------------------------------------------- RLS

alter table public.users                  enable row level security;
alter table public.accounts               enable row level security;
alter table public.monthly_budgets        enable row level security;
alter table public.transactions           enable row level security;
alter table public.kingdom_giving_records enable row level security;
alter table public.canadian_limits        enable row level security;
alter table public.giving_arm_rules       enable row level security;

create policy users_self on public.users
  for all using (id = auth.uid()) with check (id = auth.uid());

create policy accounts_owner on public.accounts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy budgets_owner on public.monthly_budgets
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy transactions_owner on public.transactions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy giving_owner on public.kingdom_giving_records
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Reference data: readable by any signed-in user, writable only by the service role.
create policy limits_read on public.canadian_limits
  for select using (auth.role() = 'authenticated');
create policy arm_rules_read on public.giving_arm_rules
  for select using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------- triggers

-- Mirror auth.users into public.users on signup.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep realm + tax flag consistent with the rules table.
create or replace function public.apply_giving_arm_defaults()
returns trigger language plpgsql as $$
declare rule public.giving_arm_rules%rowtype;
begin
  select * into rule from public.giving_arm_rules where giving_arm = new.giving_arm;
  new.realm := rule.realm;
  if rule.requires_registered_charity and coalesce(new.charity_registration_number, '') = '' then
    new.tax_deductible_flag := false;
  else
    new.tax_deductible_flag := rule.default_tax_deductible;
  end if;
  return new;
end;
$$;

drop trigger if exists giving_defaults on public.kingdom_giving_records;
create trigger giving_defaults
  before insert or update on public.kingdom_giving_records
  for each row execute function public.apply_giving_arm_defaults();

-- ---------------------------------------------------------------- views

create or replace view public.v_giving_tax_summary as
select
  g.user_id,
  g.tax_year,
  sum(abs(t.amount)) filter (where g.tax_deductible_flag)     as receiptable_total,
  sum(abs(t.amount)) filter (where not g.tax_deductible_flag) as non_receiptable_total,
  sum(abs(t.amount))                                          as total_given
from public.kingdom_giving_records g
join public.transactions t on t.id = g.transaction_id
group by g.user_id, g.tax_year;
