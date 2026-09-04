-- Stop anonymous callers executing reprice_transactions().
--
-- Postgres grants EXECUTE on new functions to PUBLIC by default, which in
-- Supabase means the anon role too. The function was never actually exploitable
-- — it is `security invoker`, so the users lookup and the UPDATE inside both run
-- under the caller's RLS policies, and an anonymous caller matches no rows and
-- gets 0 back. But an unauthenticated caller has no business reaching it at all,
-- and relying on a policy two levels down is a thin margin.
--
-- Only signed-in users (through PATCH /api/me) and the service role need it.

revoke execute on function public.reprice_transactions(uuid) from public;
revoke execute on function public.reprice_transactions(uuid) from anon;

grant execute on function public.reprice_transactions(uuid) to authenticated;
grant execute on function public.reprice_transactions(uuid) to service_role;
