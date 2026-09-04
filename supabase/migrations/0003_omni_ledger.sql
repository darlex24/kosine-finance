-- Kosine Finance V2 — turn `transactions` into the Omni-Ledger row type.
-- The legacy `category text` column is kept and backfilled so existing reads
-- (and kingdom_giving_records, which is untouched) keep working.

create type ledger_entry_type as enum (
  'expense', 'income', 'transfer', 'savings', 'investment', 'giving'
);

create type entry_source as enum ('manual', 'ocr', 'import');

alter table public.transactions
  add column if not exists currency char(3) not null default 'CAD'
    references public.currencies (code),
  add column if not exists base_currency char(3) references public.currencies (code),
  add column if not exists base_amount numeric(18, 2),
  add column if not exists fx_rate numeric(18, 8),
  add column if not exists category_id uuid references public.expense_categories (id),
  add column if not exists platform_id uuid references public.investment_platforms (id)
    on delete set null,
  add column if not exists entry_type ledger_entry_type,
  add column if not exists source entry_source not null default 'manual',
  add column if not exists receipt_storage_path text,
  add column if not exists ocr_raw jsonb,
  add column if not exists tags text[] not null default '{}',
  add column if not exists updated_at timestamptz not null default now();

-- ---------------------------------------------------------------- backfill

update public.transactions
set base_currency = coalesce(base_currency, currency),
    fx_rate       = coalesce(fx_rate, 1),
    base_amount   = coalesce(base_amount, amount)
where base_currency is null or fx_rate is null or base_amount is null;

update public.transactions t
set entry_type = case
  when t.category = 'kingdom_giving' then 'giving'::ledger_entry_type
  when t.amount > 0                  then 'income'::ledger_entry_type
  else 'expense'::ledger_entry_type
end
where t.entry_type is null;

-- Map the old free-text category onto the new taxonomy, by slug then by name.
update public.transactions t
set category_id = c.id
from public.expense_categories c
where t.category_id is null
  and c.user_id is null
  and (c.slug = lower(regexp_replace(t.category, '[^a-zA-Z0-9]+', '_', 'g'))
    or lower(c.name) = lower(t.category));

-- Giving rows land on the giving group; anything still unmatched is uncategorised.
update public.transactions t
set category_id = c.id
from public.expense_categories c
where t.category_id is null
  and c.user_id is null
  and c.slug = case when t.entry_type = 'giving' then 'giving' else 'other_uncategorised' end;

alter table public.transactions
  alter column entry_type set not null,
  alter column entry_type set default 'expense',
  alter column base_currency set not null,
  alter column base_amount set not null,
  alter column fx_rate set not null;

-- ---------------------------------------------------------------- indexes

create index if not exists transactions_keyset_idx
  on public.transactions (user_id, date desc, id desc);
create index if not exists transactions_category_idx
  on public.transactions (user_id, category_id);
create index if not exists transactions_entry_type_idx
  on public.transactions (user_id, entry_type);
create index if not exists transactions_platform_idx
  on public.transactions (user_id, platform_id);
create index if not exists transactions_tags_idx
  on public.transactions using gin (tags);

create trigger transactions_touch before update on public.transactions
  for each row execute function public.set_updated_at();
