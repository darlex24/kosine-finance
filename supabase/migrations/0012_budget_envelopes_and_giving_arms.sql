-- Envelope budgeting, and the data behind the new charts.
--
-- Three things the app could not previously express:
--
-- 1. A budget per category. monthly_budgets holds allocated_giving /
--    allocated_living / allocated_savings and nothing else, so "£300 for
--    groceries" had nowhere to live and "did I stay under?" had no answer.
-- 2. Actuals for savings and investment. v_category_spend deliberately excludes
--    them — they are money moving into your own pocket, not spending — but a
--    budget has to cover them, so this adds a separate view rather than
--    widening that one and changing what /expenses means.
-- 3. Giving broken down by arm over time. /api/giving/summary gives a year
--    total per arm with no monthly trend, and v_category_spend only knows the
--    generic "Giving & Charity" group.

-- ------------------------------------------------------------- envelopes

create table if not exists public.budget_allocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  year smallint not null check (year between 2000 and 2100),
  month smallint not null check (month between 1 and 12),
  category_id uuid not null references public.expense_categories (id) on delete cascade,
  allocated numeric(18, 2) not null default 0 check (allocated >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, year, month, category_id)
);

-- Deliberately not a child of monthly_budgets: a user can budget a category
-- without first creating a parent row, and monthly_budgets keeps working
-- unchanged for income and the top-level split.
create index if not exists budget_allocations_period_idx
  on public.budget_allocations (user_id, year, month);

alter table public.budget_allocations enable row level security;

create policy budget_allocations_owner on public.budget_allocations
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists budget_allocations_touch on public.budget_allocations;
create trigger budget_allocations_touch before update on public.budget_allocations
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------- budget actuals

-- Every outflow type, unlike v_category_spend which covers expense + giving
-- only. Same fx_convert-at-the-row's-own-date rule as all reporting since 0006.
create or replace view public.v_budget_actuals
with (security_invoker = true) as
select
  t.user_id,
  extract(year from t.date)::int  as year,
  extract(month from t.date)::int as month,
  t.entry_type,
  t.category_id,
  coalesce(c."group", 'Other')      as category_group,
  coalesce(c.name, 'Uncategorised') as category_name,
  u.base_currency,
  round(sum(abs(public.fx_convert(t.amount, t.currency, u.base_currency, t.date))), 2) as total,
  count(*)::int as entry_count
from public.transactions t
join public.users u on u.id = t.user_id
left join public.expense_categories c on c.id = t.category_id
where t.entry_type in ('expense', 'giving', 'savings', 'investment')
group by t.user_id, 2, 3, t.entry_type, t.category_id, 6, 7, u.base_currency;

-- ----------------------------------------------------------- giving by arm

-- Joins giving_arm_rules so custom arms defined in 0011 appear by their own
-- display name rather than a raw slug.
create or replace view public.v_giving_by_arm
with (security_invoker = true) as
select
  g.user_id,
  extract(year from t.date)::int  as year,
  extract(month from t.date)::int as month,
  g.giving_arm,
  coalesce(r.display_name, g.giving_arm) as display_name,
  g.realm,
  coalesce(r.is_system, true) as is_system,
  u.base_currency,
  round(sum(abs(public.fx_convert(t.amount, t.currency, u.base_currency, t.date))), 2) as total,
  count(*)::int as entry_count,
  bool_or(g.tax_deductible_flag) as any_receiptable
from public.kingdom_giving_records g
join public.transactions t on t.id = g.transaction_id
join public.users u on u.id = g.user_id
left join lateral (
  select rr.* from public.giving_arm_rules rr
  where rr.giving_arm = g.giving_arm
    and (rr.user_id is null or rr.user_id = g.user_id)
  order by rr.user_id nulls last   -- the user's own definition wins
  limit 1
) r on true
group by g.user_id, 2, 3, g.giving_arm, r.display_name, g.realm, r.is_system, u.base_currency;
