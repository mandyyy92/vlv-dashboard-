-- 입고 캘린더 › 업체 주소 — 거래처 발송 주소·연락처 (src/components/VendorAddressTab.jsx)
-- 데이터는 저장소에 넣지 않는다(공개 저장소). 화면에서 추가·수정하거나 API 로 적재.
-- Supabase SQL Editor 에서 실행.

create table if not exists public.vendor_addresses (
  id          bigserial primary key,
  category    text not null default '',   -- 구분 (전사프린팅, 나염, 생산 …)
  name        text not null,              -- 업체명
  address     text not null default '',   -- 주소 (여러 곳이면 줄바꿈)
  phone       text not null default '',   -- 연락처 (여러 개면 줄바꿈)
  contact     text not null default '',   -- 담당자
  memo        text not null default '',   -- 메모
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.vendor_addresses enable row level security;
drop policy if exists vendor_addresses_all on public.vendor_addresses;
create policy vendor_addresses_all on public.vendor_addresses for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on public.vendor_addresses to anon, authenticated;
grant usage, select on sequence public.vendor_addresses_id_seq to anon, authenticated;
