-- Let churches define their own giving arms.
--
-- `giving_arm` was a Postgres enum naming Rhapsody of Realities, Healing School,
-- InnerCity Mission, Loveworld Networks and Foundation School. That is exactly
-- right for a Christ Embassy member and unusable for anyone else: a Baptist or
-- Anglican user got a picker full of another ministry's vocabulary and no way to
-- add "Missions Offering". Expense categories and investment platforms already
-- allow user-defined rows; giving arms did not, and an enum cannot be extended
-- per user.
--
-- So the enum becomes a slug, and giving_arm_rules becomes the catalogue that
-- holds both the seeded system arms and each user's own. The realm stays a fixed
-- four — covenant, partnership, seeds, alms is a structure most traditions can
-- map onto — but is stored as text so a future migration can open it up.
--
-- kingdom_giving_records keeps every column it had; only the two enum columns
-- become text, and every existing value survives as its own slug.

-- ------------------------------------------------- views that block the change

-- v_ledger_rows selects g.giving_arm and g.realm, so the column type cannot be
-- altered while it exists. Recreated at the end, unchanged.
drop view if exists public.v_ledger_rows;

-- --------------------------------------------------------- catalogue table

alter table public.giving_arm_rules
  add column if not exists user_id uuid references public.users (id) on delete cascade,
  add column if not exists is_system boolean not null default true,
  add column if not exists sort_order int not null default 0;

-- Drop the enum primary key so the same slug can exist once as a system arm and
-- again as one user's customised version of it.
alter table public.giving_arm_rules drop constraint if exists giving_arm_rules_pkey;

alter table public.giving_arm_rules
  alter column giving_arm type text using giving_arm::text,
  alter column realm type text using realm::text;

alter table public.giving_arm_rules
  add column if not exists id uuid not null default gen_random_uuid();

alter table public.giving_arm_rules add primary key (id);

-- One system row per slug; one custom row per slug per user.
create unique index if not exists giving_arm_rules_system_slug_idx
  on public.giving_arm_rules (giving_arm) where user_id is null;
create unique index if not exists giving_arm_rules_user_slug_idx
  on public.giving_arm_rules (user_id, giving_arm) where user_id is not null;

-- Keep the seeded arms in their original order under the picker's realms.
update public.giving_arm_rules set sort_order = 10 where realm = 'core_covenant';
update public.giving_arm_rules set sort_order = 20 where realm = 'ministry_partnership';
update public.giving_arm_rules set sort_order = 30 where realm = 'seeds_special';
update public.giving_arm_rules set sort_order = 40 where realm = 'alms_compassion';

-- ------------------------------------------------------------ giving records

alter table public.kingdom_giving_records
  alter column giving_arm type text using giving_arm::text,
  alter column realm type text using realm::text;

-- ------------------------------------------------------------------ trigger

-- Resolves against the caller's own arm first, then the system one. Unknown
-- slugs are rejected rather than silently stored: an arm with no rule has no
-- defensible tax treatment.
create or replace function public.apply_giving_arm_defaults()
returns trigger language plpgsql as $$
declare rule public.giving_arm_rules%rowtype;
begin
  select * into rule
  from public.giving_arm_rules
  where giving_arm = new.giving_arm
    and (user_id is null or user_id = new.user_id)
  order by user_id nulls last   -- a user's own definition wins over the seeded one
  limit 1;

  if not found then
    raise exception 'Unknown giving arm: %', new.giving_arm
      using hint = 'Create it first, or use one of the seeded arms.';
  end if;

  new.realm := rule.realm;
  if rule.requires_registered_charity and coalesce(new.charity_registration_number, '') = '' then
    new.tax_deductible_flag := false;
  else
    new.tax_deductible_flag := rule.default_tax_deductible;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------- RLS

-- Was: readable by any authenticated user. Now the same shape as
-- expense_categories — system rows plus your own.
drop policy if exists arm_rules_read on public.giving_arm_rules;

create policy arm_rules_read on public.giving_arm_rules
  for select using (user_id is null or user_id = auth.uid());
create policy arm_rules_insert on public.giving_arm_rules
  for insert with check (user_id = auth.uid() and not is_system);
create policy arm_rules_update on public.giving_arm_rules
  for update using (user_id = auth.uid() and not is_system)
  with check (user_id = auth.uid() and not is_system);
create policy arm_rules_delete on public.giving_arm_rules
  for delete using (user_id = auth.uid() and not is_system);

-- ------------------------------------------------------------- rebuild view

create view public.v_ledger_rows
with (security_invoker = true) as
select
  t.id,
  t.user_id,
  t.date,
  t.entry_type,
  t.amount,
  t.currency,
  round(public.fx_convert(t.amount, t.currency, u.base_currency, t.date), 2) as base_amount,
  u.base_currency,
  case
    when t.currency = u.base_currency then 1
    else round(public.fx_convert(1, t.currency, u.base_currency, t.date), 8)
  end as fx_rate,
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
