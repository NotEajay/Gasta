-- Reusable trip templates (distinct from trip_records history log)

create table public.saved_trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  origin_label text,
  destination_label text,
  vehicle_id uuid references public.vehicles (id) on delete set null,
  distance_km numeric(8, 2) not null check (distance_km > 0),
  mcda_weights jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index saved_trips_user_id_idx on public.saved_trips (user_id);

alter table public.saved_trips enable row level security;

create policy "saved_trips_select_own" on public.saved_trips for select using (auth.uid() = user_id);
create policy "saved_trips_insert_own" on public.saved_trips for insert with check (auth.uid() = user_id);
create policy "saved_trips_update_own" on public.saved_trips for update using (auth.uid() = user_id);
create policy "saved_trips_delete_own" on public.saved_trips for delete using (auth.uid() = user_id);

create trigger saved_trips_set_updated_at
  before update on public.saved_trips
  for each row execute function public.set_updated_at();
