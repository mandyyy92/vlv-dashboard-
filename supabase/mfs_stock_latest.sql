-- 발주서 작성 탭 — MFS(무신사 풀필먼트) 최신 재고, 바코드별
-- mfs_inventory_snapshot 는 읽기만 한다(뷰만 생성). 매일 스냅샷이 쌓이면 뷰는 자동으로 최신 날짜 기준.
-- Supabase SQL Editor 에서 실행.

create or replace view public.v_mfs_stock_latest as
select barcode,
       sum(avail)    as avail,      -- MFS 가용재고
       sum(incoming) as incoming,   -- MFS 입고예정
       sum(defect)   as defect,     -- 불량재고
       max(snapshot_date) as snapshot_date
from public.mfs_inventory_snapshot
where snapshot_date = (select max(snapshot_date) from public.mfs_inventory_snapshot)
  and barcode is not null
group by barcode;

grant select on public.v_mfs_stock_latest to anon, authenticated;

notify pgrst, 'reload schema';
