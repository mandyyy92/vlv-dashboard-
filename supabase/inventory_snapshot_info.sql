-- 재고 점검 탭: 최신 재고 스냅샷의 수집 시각
-- inventory(보호 테이블)는 읽기만 한다. 새 뷰만 만들며 v_negative_stock 은 건드리지 않는다.
-- Supabase SQL Editor 에서 실행.
create or replace view public.v_inventory_snapshot_info as
select
  "스냅샷일자"     as snapshot_date,
  max(created_at)  as collected_at,
  count(*)         as row_count
from public.inventory
where "스냅샷일자" = (select max("스냅샷일자") from public.inventory)
group by "스냅샷일자";

grant select on public.v_inventory_snapshot_info to anon, authenticated;
