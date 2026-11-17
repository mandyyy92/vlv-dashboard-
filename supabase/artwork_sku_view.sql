-- 아트웍(전사지) 상품 목록 — 이지어드민 '아트웍-…' 상품(바코드 = 상품코드, 공급처 자체제작)
-- inventory 는 읽기만 한다(새 뷰만 만듦). v_option_current_stock 은 V 바코드만 다뤄 아트웍이 빠지므로 별도 뷰.
-- 쓰는 곳: 블프 전사지 출력 수량 계산 등 — 판매 상품(예: 아우터-다이아 라이트 자켓 Sticky [블랙-M]) ↔ 아트웍(아트웍-Sticky [블랙-M]) 매칭
-- Supabase SQL Editor 에서 실행.

create or replace view public.v_artwork_sku as
select
  "상품코드"              as product_code,
  "상품명"                as product_name,
  "옵션"                  as option_name,
  "바코드"                as barcode,
  "정상재고"::numeric     as stock_qty,
  "스냅샷일자"            as snapshot_date
from public.inventory
where "스냅샷일자" = (select max("스냅샷일자") from public.inventory)
  and "상품명" like '아트웍-%';

grant select on public.v_artwork_sku to anon, authenticated;
