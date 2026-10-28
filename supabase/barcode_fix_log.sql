-- 재고 점검 탭 · 바코드 검수 — 수정완료 체크 기록
-- 체크한 상품은 검수 목록에서 숨기고, '수정된 상품' 토글에 수정일과 함께 보여준다.
-- 숨김 판정 키: product_code + option_name + barcode (수정 전 바코드). 같은 상품에 다른 잘못된 바코드가 들어오면 다시 보인다.
-- Supabase SQL Editor 에서 실행.

create table if not exists public.barcode_fix_log (
  id           bigint generated always as identity primary key,
  product_code text not null,
  product_name text,
  option_name  text,
  barcode      text,
  issue        text,
  fixed_at     timestamptz not null default now()
);

alter table public.barcode_fix_log enable row level security;
drop policy if exists dashboard_all on public.barcode_fix_log;
create policy dashboard_all on public.barcode_fix_log for all to anon, authenticated using (true) with check (true);
grant select, insert, delete on public.barcode_fix_log to anon, authenticated;

notify pgrst, 'reload schema';
