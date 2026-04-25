-- Food items catalog (kitchen menu the reception orders from).
-- Sales of these items are recorded in the existing `sales` table with source='kitchen'.

create table if not exists public.food_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price_syp numeric(12,2) not null check (price_syp >= 0),
  category text default 'food',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create index if not exists food_items_active_idx on public.food_items (is_active, name);

alter table public.food_items enable row level security;

drop policy if exists food_items_read on public.food_items;
create policy food_items_read on public.food_items
  for select to authenticated using (true);

drop policy if exists food_items_insert on public.food_items;
create policy food_items_insert on public.food_items
  for insert to authenticated
  with check (public.current_role() = 'manager');

drop policy if exists food_items_update on public.food_items;
create policy food_items_update on public.food_items
  for update to authenticated
  using (public.current_role() = 'manager')
  with check (public.current_role() = 'manager');

drop policy if exists food_items_delete on public.food_items;
create policy food_items_delete on public.food_items
  for delete to authenticated using (public.current_role() = 'manager');

alter publication supabase_realtime add table public.food_items;

-- Seed a small starter menu (idempotent on name).
insert into public.food_items (name, price_syp)
values
  ('قهوة', 5000),
  ('شاي', 3000),
  ('ماء صغير', 2000),
  ('ماء كبير', 4000),
  ('مشروب طاقة', 15000),
  ('سندويش', 12000)
on conflict do nothing;
