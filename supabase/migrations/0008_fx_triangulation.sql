-- Convert between two non-USD currencies.
--
-- Rates are stored against a single pivot (USD), so the table holds USD->NGN
-- and USD->CAD but never NGN->CAD. fx_convert only looked for a direct pair or
-- its inverse, so every cross-pair silently fell back to 1:1 — meaning a
-- Nigerian minister with a CAD base saw ₦100,000 of expenses as CAD 100,000.
-- That is the app's most likely conversion, not an edge case.
--
-- fx_rate_of() isolates "find one hop"; fx_convert() now tries the direct hop
-- and then triangulates through USD.

create or replace function public.fx_rate_of(
  from_ccy char(3),
  to_ccy char(3),
  on_date date default current_date
) returns numeric
language sql stable as $$
  select case
    when from_ccy is null or to_ccy is null then null
    when from_ccy = to_ccy then 1
    else coalesce(
      -- Newest quote on or before the date, then the newest we hold at all,
      -- then the same two against the inverse pair.
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
        order by r.rate_date desc limit 1)
    )
  end;
$$;

-- Signature is unchanged, so the views built on it need no rebuild.
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
      public.fx_rate_of(from_ccy, to_ccy, on_date),
      -- Cross-pair: hop through the pivot. Null if either leg is unknown,
      -- so coalesce falls through to par.
      public.fx_rate_of(from_ccy, 'USD', on_date)
        * public.fx_rate_of('USD', to_ccy, on_date),
      1
    )
  end;
$$;

revoke execute on function public.fx_rate_of(char, char, date) from public;
grant execute on function public.fx_rate_of(char, char, date) to authenticated, service_role;
