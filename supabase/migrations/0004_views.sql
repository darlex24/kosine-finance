-- Kosine Finance V2 — the reporting surface. All views are security_invoker so
-- the caller's RLS policies still apply.

-- ------------------------------------------------------------ net worth

create or replace view public.v_net_worth
with (security_invoker = true) as
with base as (
  select u.id as user_id, u.base_currency
  from public.users u
),
-- `at` is avoided as an alias throughout: it collides with AT TIME ZONE.
asset_totals as (
  select b.user_id,
         coalesce(sum(public.fx_convert(a.current_value, a.currency, b.base_currency, a.as_of)), 0) as total,
         coalesce(sum(public.fx_convert(a.current_value, a.currency, b.base_currency, a.as_of))
                  filter (where a.asset_class = 'cash'), 0) as cash
  from base b
  left join public.assets a on a.user_id = b.user_id and not a.is_archived
  group by b.user_id
),
account_totals as (
  select b.user_id,
         coalesce(sum(public.fx_convert(ac.balance, ac.currency, b.base_currency, current_date))
                  filter (where ac.type <> 'credit_card'), 0) as total,
         coalesce(sum(public.fx_convert(ac.balance, ac.currency, b.base_currency, current_date))
                  filter (where ac.type in ('chequing', 'savings', 'cash')), 0) as liquid,
         coalesce(sum(public.fx_convert(abs(ac.balance), ac.currency, b.base_currency, current_date))
                  filter (where ac.type = 'credit_card'), 0) as card_debt
  from base b
  left join public.accounts ac on ac.user_id = b.user_id and not ac.is_archived
  group by b.user_id
),
liability_totals as (
  select b.user_id,
         coalesce(sum(public.fx_convert(l.current_balance, l.currency, b.base_currency, l.as_of)), 0) as total
  from base b
  left join public.liabilities l on l.user_id = b.user_id and not l.is_archived
  group by b.user_id
)
select
  b.user_id,
  b.base_currency,
  round(ast.total + act.total, 2)                               as total_assets,
  round(lia.total + act.card_debt, 2)                           as total_liabilities,
  round(ast.total + act.total - lia.total - act.card_debt, 2)   as net_worth,
  round(ast.cash + act.liquid, 2)                               as liquid_cash,
  round(ast.total, 2)                                           as investable_assets
from base b
join asset_totals ast     on ast.user_id = b.user_id
join account_totals act   on act.user_id = b.user_id
join liability_totals lia on lia.user_id = b.user_id;

-- ------------------------------------------------------------ cash flow

create or replace view public.v_cash_flow_monthly
with (security_invoker = true) as
select
  t.user_id,
  t.base_currency,
  extract(year from t.date)::int  as year,
  extract(month from t.date)::int as month,
  t.entry_type,
  round(sum(abs(t.base_amount)), 2) as total,
  count(*)::int                     as entry_count
from public.transactions t
group by t.user_id, t.base_currency, 3, 4, t.entry_type;

-- ------------------------------------------------------------ ledger rows

create or replace view public.v_ledger_rows
with (security_invoker = true) as
select
  t.id,
  t.user_id,
  t.date,
  t.entry_type,
  t.amount,
  t.currency,
  t.base_amount,
  t.base_currency,
  t.fx_rate,
  t.merchant,
  t.memo,
  t.tags,
  t.source,
  t.receipt_image_url,
  t.receipt_storage_path,
  t.ocr_confidence,
  t.created_at,
  t.updated_at,
  t.category_id,
  c.slug        as category_slug,
  c.name        as category_name,
  c."group"     as category_group,
  c.icon        as category_icon,
  t.platform_id,
  p.name        as platform_name,
  p.kind        as platform_kind,
  t.account_id,
  ac.name       as account_name,
  t.budget_id,
  g.id          as giving_record_id,
  g.giving_arm,
  g.realm       as giving_realm,
  g.recipient   as giving_recipient,
  g.tax_deductible_flag,
  g.pledge_fulfilled_status,
  g.tax_year
from public.transactions t
left join public.expense_categories c   on c.id = t.category_id
left join public.investment_platforms p on p.id = t.platform_id
left join public.accounts ac            on ac.id = t.account_id
-- LATERAL rather than a plain join: 0001 does not constrain a transaction to a
-- single giving record, and the grid must never show one row twice.
left join lateral (
  select k.* from public.kingdom_giving_records k
  where k.transaction_id = t.id
  order by k.created_at limit 1
) g on true;

-- ------------------------------------------------- category rollup (dashboard)

create or replace view public.v_category_spend
with (security_invoker = true) as
select
  t.user_id,
  extract(year from t.date)::int as year,
  coalesce(c."group", 'Other')   as category_group,
  coalesce(c.name, 'Uncategorised') as category_name,
  t.base_currency,
  round(sum(abs(t.base_amount)), 2) as total
from public.transactions t
left join public.expense_categories c on c.id = t.category_id
where t.entry_type in ('expense', 'giving')
group by t.user_id, 2, 3, 4, t.base_currency;
