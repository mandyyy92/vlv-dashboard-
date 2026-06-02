-- VLV 생산 오더: 입고 라인(옵션별) 테이블
-- 기존 inbound_history(차수 총량)는 그대로 두고, 옵션(색상×사이즈)별 입고수량을 별도로 적재한다.
-- 전부 영문 컬럼이라 PostgREST eq/in 필터가 정상 동작한다.
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 RUN.

create table if not exists public.inbound_lines (
  id            bigint generated always as identity primary key,
  order_id      bigint not null,   -- 앱에서 오더 구분에 쓰는 production_orders.id
  round         integer,           -- 입고 차수 (inbound_history.inbound_round 와 동일 값)
  inbound_date  date,
  color         text,              -- 정규화된 한글 색상명 (매트릭스 발주 행 키와 동일)
  size          text,              -- 정규화된 사이즈 (M/L/FREE 등, 매트릭스 발주 열 키와 동일)
  qty           integer not null default 0,
  created_at    timestamptz default now()
);

create index if not exists idx_inbound_lines_order       on public.inbound_lines(order_id);
create index if not exists idx_inbound_lines_order_round on public.inbound_lines(order_id, round);

alter table public.inbound_lines enable row level security;

drop policy if exists "Allow all read"   on public.inbound_lines;
drop policy if exists "Allow all insert" on public.inbound_lines;
drop policy if exists "Allow all update" on public.inbound_lines;
drop policy if exists "Allow all delete" on public.inbound_lines;

create policy "Allow all read"   on public.inbound_lines for select using (true);
create policy "Allow all insert" on public.inbound_lines for insert with check (true);
create policy "Allow all update" on public.inbound_lines for update using (true);
create policy "Allow all delete" on public.inbound_lines for delete using (true);
