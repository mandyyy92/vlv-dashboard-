-- VLV 생산 오더: 입고 라인(옵션별) 테이블
-- 기존 inbound_history(차수 총량)는 그대로 두고, 옵션(색상×사이즈)별 입고수량을 별도로 적재한다.
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 RUN.
--
-- 비고: inbound_history.id 가 bigint(int8) identity 라는 전제로 FK 를 건다.
--       만약 타입이 다르면 inbound_id 타입을 맞춰서 조정할 것.

create table if not exists public.inbound_lines (
  id            bigint generated always as identity primary key,
  inbound_id    bigint references public.inbound_history(id) on delete cascade, -- 차수(inbound_history) 연결키
  order_id      bigint not null,
  item_id       bigint,        -- 매칭된 production_order_items.id (추적용)
  inbound_round integer,
  inbound_date  date,
  color         text,          -- 매칭된 오더 아이템의 색상 (매트릭스 행 키와 동일)
  size          text,          -- 매칭된 오더 아이템의 사이즈 (매트릭스 열 키와 동일)
  option        text,          -- 패킹리스트 원본 옵션 문자열 [색상-사이즈] (참고용)
  sku_code      text,
  qty           integer not null default 0,
  created_at    timestamptz default now()
);

create index if not exists idx_inbound_lines_order   on public.inbound_lines(order_id);
create index if not exists idx_inbound_lines_inbound on public.inbound_lines(inbound_id);

alter table public.inbound_lines enable row level security;

drop policy if exists "Allow all read"   on public.inbound_lines;
drop policy if exists "Allow all insert" on public.inbound_lines;
drop policy if exists "Allow all update" on public.inbound_lines;
drop policy if exists "Allow all delete" on public.inbound_lines;

create policy "Allow all read"   on public.inbound_lines for select using (true);
create policy "Allow all insert" on public.inbound_lines for insert with check (true);
create policy "Allow all update" on public.inbound_lines for update using (true);
create policy "Allow all delete" on public.inbound_lines for delete using (true);
