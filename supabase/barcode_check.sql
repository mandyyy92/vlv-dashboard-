-- 재고 점검 탭 · 바코드 검수
-- inventory · inventory_artwork 최신 스냅샷의 바코드를 17자리 규칙으로 검사한다. (두 테이블은 읽기만, 뷰만 생성)
-- 스냅샷이 매일 갱신되면 뷰 결과도 자동으로 그날 기준이 된다. Supabase SQL Editor 에서 실행.
--
-- 17자리 규칙 (변경 후)
--   1 브랜드 V · 2-3 년도(숫자) · 4 시즌(P/S/F/W/A) · 5 복종(영문) · 6-7 품번(숫자) · 8 성별(U/W/M)
--   9 타입(B 베이스 / C 완제품 / A 아트웍 / P 아트웍 임시) · 10 연도 · 11-12 아트웍 · 13-14 색상 · 15-17 사이즈 (0~9, A~Z)
--
-- 판정
--   error  : 바코드 없음 · 영문 대문자/숫자 외 문자(공백·소문자 포함) · 17자리 아님 · 자리별 규칙 위반 · 여러 상품코드가 같은 바코드
--   legacy : 17자리 이전 단축 바코드(11~14자리, 앞 8자리는 규칙에 맞음) — 오류는 아니고 참고용

create or replace view public.v_barcode_check as
with src as (
  select 'inventory' as source, 1 as prio,
         "상품코드", "상품명", "옵션", "바코드", "스냅샷일자"
  from public.inventory
  where "스냅샷일자" = (select max("스냅샷일자") from public.inventory)
  union all
  select 'inventory_artwork', 2,
         "상품코드", "상품명", "옵션", "바코드", "스냅샷일자"
  from public.inventory_artwork
  where "스냅샷일자" = (select max("스냅샷일자") from public.inventory_artwork)
),
latest as (
  -- v_negative_stock 과 같은 기준: 같은 상품코드+옵션은 최신 스냅샷(같으면 inventory) 한 행만
  select distinct on ("상품코드", "옵션") *, coalesce("바코드", '') as b
  from src
  order by "상품코드", "옵션", "스냅샷일자" desc, prio
),
dup as (
  select b from latest where b <> '' group by b having count(distinct "상품코드") > 1
),
chk as (
  select l.*,
    case
      when l.b = '' then '바코드 없음'
      when l.b ~ '[^A-Z0-9]' then '허용되지 않는 문자(공백·소문자·기호)'
      when length(l.b) between 11 and 14 and l.b ~ '^V[0-9]{2}[PSFWA][A-Z][0-9]{2}[UWM]' then null
      when length(l.b) <> 17 then '자릿수 ' || length(l.b) || ' (17자리 아님)'
      else nullif(concat_ws(', ',
        case when substr(l.b, 1, 1) <> 'V'             then '1 브랜드' end,
        case when substr(l.b, 2, 2) !~ '^[0-9]{2}$'    then '2-3 년도' end,
        case when substr(l.b, 4, 1) !~ '^[PSFWA]$'     then '4 시즌' end,
        case when substr(l.b, 5, 1) !~ '^[A-Z]$'       then '5 복종' end,
        case when substr(l.b, 6, 2) !~ '^[0-9]{2}$'    then '6-7 품번' end,
        case when substr(l.b, 8, 1) !~ '^[UWM]$'       then '8 성별' end,
        case when substr(l.b, 9, 1) !~ '^[BCAP]$'      then '9 타입' end
      ), '')
    end as format_issue,
    (l.b <> '' and length(l.b) between 11 and 14 and l.b ~ '^V[0-9]{2}[PSFWA][A-Z][0-9]{2}[UWM][A-Z0-9]*$') as is_legacy,
    exists (select 1 from dup d where d.b = l.b) as is_dup
  from latest l
)
select
  "상품코드"   as product_code,
  "상품명"     as product_name,
  "옵션"       as option_name,
  "바코드"     as barcode,
  "스냅샷일자" as snapshot_date,
  source,
  case when format_issue is not null or is_dup then 'error' else 'legacy' end as level,
  concat_ws(', ', format_issue, case when is_dup then '중복 바코드(다른 상품코드와 같음)' end,
            case when format_issue is null and not is_dup and is_legacy then '구형 단축 바코드(17자리 이전)' end) as issue
from chk
where format_issue is not null or is_dup or is_legacy;

grant select on public.v_barcode_check to anon, authenticated;

-- 검수 요약: 검사한 전체 행 수 (오류·구형 건수는 v_barcode_check 에서 센다)
create or replace view public.v_barcode_check_summary as
with src as (
  select "상품코드", "옵션", "스냅샷일자" from public.inventory
  where "스냅샷일자" = (select max("스냅샷일자") from public.inventory)
  union all
  select "상품코드", "옵션", "스냅샷일자" from public.inventory_artwork
  where "스냅샷일자" = (select max("스냅샷일자") from public.inventory_artwork)
)
select max("스냅샷일자") as snapshot_date,
       count(distinct ("상품코드", "옵션")) as checked_count
from src;

grant select on public.v_barcode_check_summary to anon, authenticated;

notify pgrst, 'reload schema';
