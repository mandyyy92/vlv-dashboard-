-- 재고 점검 탭: inventory · inventory_artwork · inventory_backup 세 테이블을 합쳐 마이너스 재고 조회
-- 세 테이블은 읽기만 한다(뷰만 교체). Supabase SQL Editor 에서 실행.
-- 세 테이블 모두 inventory 와 같은 한글 컬럼(상품코드·옵션·정상재고·스냅샷일자 …)을 가진다고 가정.
--
-- 규칙
--  1) 테이블마다 자기 최신 스냅샷일자의 행만 사용
--  2) 같은 상품코드+옵션이 여러 테이블에 있으면 스냅샷일자가 최신인 행,
--     같으면 inventory > inventory_artwork > inventory_backup 순으로 하나만 남김 (중복 집계 방지)
--  3) 그 결과에서 정상재고 < 0 인 행만

drop view if exists public.v_negative_stock;

create view public.v_negative_stock as
with src as (
  select 'inventory' as source, 1 as prio,
         "상품코드", "대표상품코드", "상품명", "옵션", "바코드", "로케이션", "카테고리", "정상재고", "스냅샷일자"
  from public.inventory
  where "스냅샷일자" = (select max("스냅샷일자") from public.inventory)
  union all
  select 'inventory_artwork', 2,
         "상품코드", "대표상품코드", "상품명", "옵션", "바코드", "로케이션", "카테고리", "정상재고", "스냅샷일자"
  from public.inventory_artwork
  where "스냅샷일자" = (select max("스냅샷일자") from public.inventory_artwork)
  union all
  select 'inventory_backup', 3,
         "상품코드", "대표상품코드", "상품명", "옵션", "바코드", "로케이션", "카테고리", "정상재고", "스냅샷일자"
  from public.inventory_backup
  where "스냅샷일자" = (select max("스냅샷일자") from public.inventory_backup)
),
latest as (
  select distinct on ("상품코드", "옵션") *
  from src
  order by "상품코드", "옵션", "스냅샷일자" desc, prio
)
select
  "상품코드"            as product_code,
  "대표상품코드"        as rep_code,
  "상품명"              as product_name,
  "옵션"                as option_name,
  "바코드"              as barcode,
  "로케이션"            as location,
  "카테고리"            as category,
  "정상재고"::numeric   as stock_qty,
  "스냅샷일자"          as snapshot_date,
  source
from latest
where "정상재고"::numeric < 0;

grant select on public.v_negative_stock to anon, authenticated;

-- 수집 시각도 세 테이블 기준 (각 테이블의 최신 스냅샷 중 가장 늦은 것)
create or replace view public.v_inventory_snapshot_info as
with s as (
  select "스냅샷일자", created_at from public.inventory
  where "스냅샷일자" = (select max("스냅샷일자") from public.inventory)
  union all
  select "스냅샷일자", created_at from public.inventory_artwork
  where "스냅샷일자" = (select max("스냅샷일자") from public.inventory_artwork)
  union all
  select "스냅샷일자", created_at from public.inventory_backup
  where "스냅샷일자" = (select max("스냅샷일자") from public.inventory_backup)
)
select
  max("스냅샷일자")  as snapshot_date,
  max(created_at)    as collected_at,
  count(*)           as row_count
from s;

grant select on public.v_inventory_snapshot_info to anon, authenticated;

notify pgrst, 'reload schema';
