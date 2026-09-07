-- Pre-launch hardening: an audit trail, and closing the catalogue to anonymous
-- readers.

-- ------------------------------------------------------------- audit trail

-- Account deletion and bulk delete left no record at all, so after the fact
-- there was no way to answer "what happened here". This is deliberately narrow:
-- who, what, when, and enough context to recognise the event — never the
-- contents of what was removed, which would defeat the point of deleting it.

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users (id) on delete set null,
  -- set null, not cascade: the record of an account being deleted must outlive
  -- the account, or the one event most worth auditing erases itself.
  actor_email text,
  action text not null,
  entity text,
  entity_count int,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_user_idx on public.audit_log (user_id, created_at desc);
create index if not exists audit_log_action_idx on public.audit_log (action, created_at desc);

alter table public.audit_log enable row level security;

-- Readable by the user it concerns; never writable or deletable by them. Entries
-- are written by the service role only, so a user cannot erase their own trail.
create policy audit_log_read_own on public.audit_log
  for select using (user_id = auth.uid());

-- ------------------------------------------------- catalogue lockdown

-- The seeded catalogue was readable with nothing but the anon key, which ships
-- in the browser bundle and is therefore public. No user data was exposed —
-- rows carrying a user_id were correctly hidden — but the taxonomy, the platform
-- list and the giving-arm vocabulary had no reason to be world-readable.
-- Requiring a session costs nothing: every screen that reads these is behind
-- authentication already.

drop policy if exists categories_read on public.expense_categories;
create policy categories_read on public.expense_categories
  for select using (
    auth.role() = 'authenticated' and (user_id is null or user_id = auth.uid())
  );

drop policy if exists platforms_read on public.investment_platforms;
create policy platforms_read on public.investment_platforms
  for select using (
    auth.role() = 'authenticated' and (user_id is null or user_id = auth.uid())
  );

drop policy if exists arm_rules_read on public.giving_arm_rules;
create policy arm_rules_read on public.giving_arm_rules
  for select using (
    auth.role() = 'authenticated' and (user_id is null or user_id = auth.uid())
  );
