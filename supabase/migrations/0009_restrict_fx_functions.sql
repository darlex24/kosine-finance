-- Finish locking the FX helpers down to signed-in callers.
--
-- 0008 revoked fx_rate_of from PUBLIC but not from anon, which is not enough:
-- Supabase's default privileges on the public schema grant EXECUTE to anon
-- directly, so removing the PUBLIC grant leaves that direct one in place. 0007
-- got this right for reprice_transactions; this carries the same fix to both FX
-- helpers. fx_convert has been anon-callable since 0002.
--
-- Neither leaks anything today. Both are `security invoker` and read fx_rates,
-- which is RLS-restricted to authenticated, so an anonymous caller gets null
-- back. This closes the door rather than relying on a policy one level down.

revoke execute on function public.fx_rate_of(char, char, date) from public, anon;
revoke execute on function public.fx_convert(numeric, char, char, date) from public, anon;

grant execute on function public.fx_rate_of(char, char, date)
  to authenticated, service_role;
grant execute on function public.fx_convert(numeric, char, char, date)
  to authenticated, service_role;
