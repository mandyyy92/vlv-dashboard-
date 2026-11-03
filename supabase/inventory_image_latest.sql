-- 발주서 작성 탭 — 상품 이미지 링크 (inventory 최신 스냅샷, 상품코드별)
-- inventory 는 보호 테이블: 읽기만 하는 뷰만 만든다. Supabase SQL Editor 에서 실행.

create or replace view public.v_inventory_image_latest as
select distinct on ("상품코드")
       "상품코드"  as product_code,
       "이미지URL" as image_url
from public.inventory
where "스냅샷일자" = (select max("스냅샷일자") from public.inventory)
  and coalesce("이미지URL", '') <> ''
order by "상품코드";

grant select on public.v_inventory_image_latest to anon, authenticated;

notify pgrst, 'reload schema';
