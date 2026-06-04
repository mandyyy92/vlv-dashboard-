-- VLVD 대시보드: 업로드 내역(uploads) + 업로드 단위 삭제용 upload_id 태깅
-- 작업지시서/패킹리스트 "업로드 단위"로 데이터를 추적·삭제하기 위한 마이그레이션.
-- ★보호 테이블(inventory, MUSINSA Detailed Order, 반품내역, mfs_sales,
--   purchase_orders, purchase_order_lines, v_option_* 등)은 절대 건드리지 않음.★
-- 대시보드 전용 테이블만 변경: uploads(신설) + production_orders / inbound_history / inbound_lines 에 upload_id 컬럼 추가.
-- 실행: Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 RUN. (CLI push 아님 / 직접 실행)
-- 모두 IF [NOT] EXISTS 라 여러 번 실행해도 안전.

-- 1) 업로드 내역 테이블
create table if not exists public.uploads (
  id          bigint generated always as identity primary key,
  kind        text not null,          -- 'workorder'(작업지시서) | 'packing'(패킹리스트)
  file_name   text,                   -- 업로드한 파일명
  season      text,                   -- 작업지시서 업로드 시 시즌(26SS 등), 패킹리스트는 null
  memo        text,                   -- 패킹리스트 메모 등
  created_at  timestamptz default now()
);

create index if not exists idx_uploads_kind       on public.uploads(kind);
create index if not exists idx_uploads_created_at on public.uploads(created_at);

alter table public.uploads enable row level security;
drop policy if exists "Allow all read"   on public.uploads;
drop policy if exists "Allow all insert" on public.uploads;
drop policy if exists "Allow all update" on public.uploads;
drop policy if exists "Allow all delete" on public.uploads;
create policy "Allow all read"   on public.uploads for select using (true);
create policy "Allow all insert" on public.uploads for insert with check (true);
create policy "Allow all update" on public.uploads for update using (true);
create policy "Allow all delete" on public.uploads for delete using (true);

-- 2) 업로드 태깅용 upload_id 컬럼 추가 (FK 없이 bigint — 삭제는 앱이 자식→부모 순서로 직접 처리,
--    기존 inbound_lines 컨벤션과 동일하게 cascade에 의존하지 않음).
--    작업지시서 업로드 → production_orders.upload_id 태깅
--    패킹리스트 업로드 → inbound_history.upload_id / inbound_lines.upload_id 태깅
alter table public.production_orders add column if not exists upload_id bigint;
alter table public.inbound_history   add column if not exists upload_id bigint;
alter table public.inbound_lines      add column if not exists upload_id bigint;

create index if not exists idx_production_orders_upload_id on public.production_orders(upload_id);
create index if not exists idx_inbound_history_upload_id   on public.inbound_history(upload_id);
create index if not exists idx_inbound_lines_upload_id     on public.inbound_lines(upload_id);

-- (참고) production_order_items 에는 upload_id 를 두지 않음.
-- 작업지시서 삭제 시 production_orders.upload_id 로 오더를 찾고, 그 오더의 자식 아이템은
-- order_id 기준으로 함께 삭제하므로 별도 태깅이 불필요.
