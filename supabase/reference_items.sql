-- VLV 레퍼런스 아이템 (PlanningTab) 테이블 정의
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 RUN.
-- gen_random_uuid() 가 필요하므로 pgcrypto extension 이 활성화되어 있어야 합니다.

create table if not exists public.reference_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (category in ('상의','하의','아우터','모자','가방','기타')),
  reference_url text,
  image_url text,
  expected_price integer,
  expected_cost integer,
  material text,
  color text,
  memo text,
  source text default 'manual',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_reference_items_category on public.reference_items(category);
create index if not exists idx_reference_items_created_at on public.reference_items(created_at desc);

alter table public.reference_items enable row level security;

drop policy if exists "Allow all read" on public.reference_items;
drop policy if exists "Allow all insert" on public.reference_items;
drop policy if exists "Allow all update" on public.reference_items;
drop policy if exists "Allow all delete" on public.reference_items;

create policy "Allow all read"   on public.reference_items for select using (true);
create policy "Allow all insert" on public.reference_items for insert with check (true);
create policy "Allow all update" on public.reference_items for update using (true);
create policy "Allow all delete" on public.reference_items for delete using (true);

create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_reference_items_updated_at on public.reference_items;
create trigger update_reference_items_updated_at
  before update on public.reference_items
  for each row execute function update_updated_at_column();
