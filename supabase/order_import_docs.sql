-- 오더 입고현황 서랍 '수입 통관' — 차수(order_key)별 선적 회차 목록.
-- 한 차수가 여러 번 나눠 선적되므로 차수당 여러 행. order_key = `${상품명}|${차수}|${업체}` (hiworks_docs.linked_order_key 와 같은 형식).
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 RUN. 여러 번 실행해도 안전.

create table if not exists public.order_import_docs (
  id              bigint generated always as identity primary key,
  order_key       text not null,
  shipment_no     integer not null default 1,  -- 선적 회차 (1차, 2차 ...)
  bl_no           text,                        -- BL 번호
  import_decl_no  text,                        -- 수입신고번호
  shipped_on      date,                        -- 선적일
  arrived_on      date,                        -- 입항일
  cleared_on      date,                        -- 통관일
  qty             integer,                     -- 수량
  note            text,                        -- 비고
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_order_import_docs_order_key on public.order_import_docs(order_key, shipment_no);

alter table public.order_import_docs enable row level security;

drop policy if exists "Allow all read"   on public.order_import_docs;
drop policy if exists "Allow all insert" on public.order_import_docs;
drop policy if exists "Allow all update" on public.order_import_docs;
drop policy if exists "Allow all delete" on public.order_import_docs;

create policy "Allow all read"   on public.order_import_docs for select using (true);
create policy "Allow all insert" on public.order_import_docs for insert with check (true);
create policy "Allow all update" on public.order_import_docs for update using (true);
create policy "Allow all delete" on public.order_import_docs for delete using (true);

grant select, insert, update, delete on public.order_import_docs to anon, authenticated;
