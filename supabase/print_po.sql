-- 발주서 작성 탭 — 프린팅 외주 발주(업체·차수) 저장
-- 발주 시: 발송요청 · 베이스출고 · 입고대기 파일 생성 후 저장
-- 입고 후: 실입고수량 입력 → 정상입고 · MFS출고 · 베이스출고(추가출고) 파일 생성
-- Supabase SQL Editor 에서 실행. 새 테이블만 만든다(기존 테이블 변경 없음).

create table if not exists public.print_po (
  id            bigint generated always as identity primary key,
  supplier_id   bigint,
  supplier_name text not null,
  round_no      int  not null,
  order_date    date not null default current_date,
  received_date date,
  status        text not null default 'requested',   -- requested(발송요청) | received(입고완료)
  note          text,
  created_at    timestamptz not null default now()
);

create table if not exists public.print_po_lines (
  id              bigint generated always as identity primary key,
  po_id           bigint not null references public.print_po(id) on delete cascade,
  artwork_code    text not null,     -- 아트웍(A) 상품코드
  artwork_name    text,
  option_name     text,
  artwork_barcode text,
  base_code       text,              -- 베이스(B) 상품코드 — 같은 group_key + 같은 옵션
  base_name       text,
  base_barcode    text,
  request_qty     int  not null default 0,
  received_qty    int,
  unit_cost       numeric,
  created_at      timestamptz not null default now()
);
create index if not exists print_po_lines_po_id_idx on public.print_po_lines(po_id);

alter table public.print_po enable row level security;
alter table public.print_po_lines enable row level security;
drop policy if exists dashboard_all on public.print_po;
drop policy if exists dashboard_all on public.print_po_lines;
create policy dashboard_all on public.print_po       for all to anon, authenticated using (true) with check (true);
create policy dashboard_all on public.print_po_lines for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on public.print_po, public.print_po_lines to anon, authenticated;

notify pgrst, 'reload schema';
