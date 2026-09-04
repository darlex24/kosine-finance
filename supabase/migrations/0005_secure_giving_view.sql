-- Close an RLS bypass in the 0001 giving view.
--
-- A Postgres view runs with the privileges of its owner unless told otherwise,
-- so `v_giving_tax_summary` returned every user's giving totals to any caller
-- holding the anon key — which ships in the browser bundle and is therefore
-- public. The underlying kingdom_giving_records table was never exposed; only
-- the view over it was.
--
-- security_invoker makes the view run as the caller, so the giving_owner and
-- transactions_owner policies apply. The V2 views in 0004 already declare this.

alter view public.v_giving_tax_summary set (security_invoker = true);
