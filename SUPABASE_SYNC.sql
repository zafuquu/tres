create table if not exists public.swertres_ledgers (
  id text primary key,
  data jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.swertres_ledgers enable row level security;

drop policy if exists "swertres read" on public.swertres_ledgers;
drop policy if exists "swertres insert" on public.swertres_ledgers;
drop policy if exists "swertres update" on public.swertres_ledgers;

create policy "swertres read"
on public.swertres_ledgers for select
using (true);

create policy "swertres insert"
on public.swertres_ledgers for insert
with check (true);

create policy "swertres update"
on public.swertres_ledgers for update
using (true)
with check (true);
