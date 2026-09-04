-- Make reporting convert from each row's NATIVE currency, live.
--
-- 0004 summed the stored `base_amount`, which is frozen at whatever the user's
-- base currency was when the row was written. Switching base currency therefore
-- left old rows carrying figures in the OLD currency while being labelled with
-- the new one — and v_cash_flow_monthly split into two incompatible groups that
-- the dashboard then added together.
--
-- The fix: report from `amount` + `currency` — the values the user actually
-- entered, which never change — converted with fx_convert at that row's own
-- date into the user's CURRENT base currency. Switching base currency now
-- re-denominates the whole history correctly and instantly.
--
-- The stored base_amount / base_currency / fx_rate columns are kept as the
-- audit record of what a row was worth when it was entered, and are exposed as
-- entered_* on v_ledger_rows.

-- --------------------------------------------------------- cash flow

create or replace view public.v_cash_flow_monthly
with (security_invoker = true) as
select
  t.user_id,
  u.base_currency,
  extract(year from t.date)::int  as year,
  extract(month from t.date)::int as month,
  t.entry_type,
  round(sum(abs(public.fx_convert(t.amount, t.currency, u.base_currency, t.date))), 2) as total,
  count(*)::int as entry_count
from public.transactions t
join public.users u on u.id = t.user_id
group by t.user_id, u.base_currency, 3, 4, t.entry_type;

-- --------------------------------------------------------- category spend

create or replace view public.v_category_spend
with (security_invoker = true) as
select
  t.user_id,
  extract(year from t.date)::int as year,
  coalesce(c."group", 'Other')      as category_group,
  coalesce(c.name, 'Uncategorised') as category_name,
  u.base_currency,
  round(sum(abs(public.fx_convert(t.amount, t.currency, u.base_currency, t.date))), 2) as total
from public.transactions t
join public.users u on u.id = t.user_id
left join public.expense_categories c on c.id = t.category_id
where t.entry_type in ('expense', 'giving')
group by t.user_id, 2, 3, 4, u.base_currency;

-- --------------------------------------------------------- ledger rows

drop view if exists public.v_ledger_rows;

create view public.v_ledger_rows
with (security_invoker = true) as
select
  t.id,
  t.user_id,
  t.date,
  t.entry_type,
  t.amount,
  t.currency,
  -- Live: what this row is worth in the user's base currency today, using the
  -- rate that applied on the row's own date.
  round(public.fx_convert(t.amount, t.currency, u.base_currency, t.date), 2) as base_amount,
  u.base_currency,
  case
    when t.currency = u.base_currency then 1
    else round(public.fx_convert(1, t.currency, u.base_currency, t.date), 8)
  end as fx_rate,
  -- Frozen: what it was worth when it was entered. Audit only.
  t.base_amount   as entered_base_amount,
  t.base_currency as entered_base_currency,
  t.fx_rate       as entered_fx_rate,
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
join public.users u on u.id = t.user_id
left join public.expense_categories c   on c.id = t.category_id
left join public.investment_platforms p on p.id = t.platform_id
left join public.accounts ac            on ac.id = t.account_id
left join lateral (
  select k.* from public.kingdom_giving_records k
  where k.transaction_id = t.id
  order by k.created_at limit 1
) g on true;

-- ------------------------------------------------- re-stamp stored columns
--
-- Reporting no longer depends on these, but keeping them in step means the
-- audit trail matches the user's current base currency after a switch.

create or replace function public.reprice_transactions(p_user uuid)
returns integer
language plpgsql
security invoker
as $$
declare
  target char(3);
  touched integer;
begin
  select base_currency into target from public.users where id = p_user;
  if target is null then
    return 0;
  end if;

  update public.transactions t
  set base_currency = target,
      base_amount   = round(public.fx_convert(t.amount, t.currency, target, t.date), 2),
      fx_rate       = case
                        when t.currency = target then 1
                        else round(public.fx_convert(1, t.currency, target, t.date), 8)
                      end
  where t.user_id = p_user
    and (t.base_currency is distinct from target
         or t.base_amount is distinct from
            round(public.fx_convert(t.amount, t.currency, target, t.date), 2));

  get diagnostics touched = row_count;
  return touched;
end;
$$;
