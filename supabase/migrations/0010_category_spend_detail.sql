-- Give the category rollup enough detail to drive a real expenses page.
--
-- 0006's v_category_spend returned group + name + total only, which is enough
-- for a dashboard sliver but not for tracking: there was no category_id to
-- drill through to the ledger on, no month to narrow by, and no count to say
-- whether a total is one large payment or forty small ones.

create or replace view public.v_category_spend
with (security_invoker = true) as
select
  t.user_id,
  extract(year from t.date)::int  as year,
  extract(month from t.date)::int as month,
  t.entry_type,
  t.category_id,
  coalesce(c."group", 'Other')      as category_group,
  coalesce(c.name, 'Uncategorised') as category_name,
  c.icon                            as category_icon,
  u.base_currency,
  round(sum(abs(public.fx_convert(t.amount, t.currency, u.base_currency, t.date))), 2) as total,
  count(*)::int as entry_count
from public.transactions t
join public.users u on u.id = t.user_id
left join public.expense_categories c on c.id = t.category_id
-- Money out only. Savings and investment are excluded: they are transfers into
-- your own pocket, not spending, and folding them in would overstate outflow.
where t.entry_type in ('expense', 'giving')
group by t.user_id, 2, 3, t.entry_type, t.category_id, 6, 7, c.icon, u.base_currency;
