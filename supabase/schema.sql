create table if not exists public.mood_records (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  timestamp bigint not null,
  emoji text not null,
  tag text not null default '',
  weather jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.mood_records enable row level security;

drop policy if exists "Users can read own mood records" on public.mood_records;
create policy "Users can read own mood records"
on public.mood_records
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own mood records" on public.mood_records;
create policy "Users can insert own mood records"
on public.mood_records
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own mood records" on public.mood_records;
create policy "Users can update own mood records"
on public.mood_records
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own mood records" on public.mood_records;
create policy "Users can delete own mood records"
on public.mood_records
for delete
to authenticated
using (auth.uid() = user_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists mood_records_touch_updated_at on public.mood_records;
create trigger mood_records_touch_updated_at
before update on public.mood_records
for each row
execute function public.touch_updated_at();
