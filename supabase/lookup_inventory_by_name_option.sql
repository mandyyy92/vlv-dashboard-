-- ============================================================
-- lookup_inventory_by_name_option
-- 작업지시서 상품명(한글) + 옵션 패턴으로 상품마스터 inventory 검색
--
-- 대상 테이블: 상품마스터 inventory (바코드 V26SP01UNYL 형식, 옵션 [네이비-L] 형식).
--             재고 스냅샷 테이블이 아님.
--
-- 매칭 규칙:
--  1) inventory 상품명을 첫 '-' 기준으로 잘라 "뒤쪽"만 비교 대상으로 정규화
--       예) '하의-나일론 버뮤다 팬츠' → '나일론 버뮤다 팬츠'   ('-' 없으면 전체 그대로)
--  2) 정규화된 상품명과 입력 상품명을 trim 후 비교: 일치(=) 우선, 없으면 포함관계
--  3) 옵션은 '[한글색상-사이즈]' 형식 그대로 비교 (색상 영문코드 변환 없음)
--
-- 적용 방법: Supabase 대시보드 → SQL Editor 에 붙여넣어 실행
--           (또는 psql 로 직접 실행). 반환/입력 시그니처는 클라이언트와 일치해야 함.
-- ============================================================

drop function if exists public.lookup_inventory_by_name_option(text, text);

create or replace function public.lookup_inventory_by_name_option(
  name_kr        text,
  option_pattern text
)
returns table (
  sku_code     text,
  barcode      text,
  product_name text,
  "option"     text
)
language sql
stable
as $$
  with src as (
    select
      i."상품코드"::text as sku_code,
      i."바코드"::text   as barcode,
      i."상품명"::text   as product_name,
      i."옵션"::text     as opt,
      -- (1) 첫 '-' 기준 뒤쪽만; '-' 없으면 전체
      btrim(
        case
          when position('-' in i."상품명"::text) > 0
            then substr(i."상품명"::text, position('-' in i."상품명"::text) + 1)
          else i."상품명"::text
        end
      ) as norm_name
    from public.inventory i
    -- (3) 옵션은 한글 패턴 그대로 비교 ('[네이비-L]')
    where i."옵션"::text like option_pattern
  )
  select sku_code, barcode, product_name, opt
  from src
  -- (2) trim 후 비교: 일치 또는 포함관계 (양방향)
  where norm_name = btrim(name_kr)
     or norm_name ilike '%' || btrim(name_kr) || '%'
     or btrim(name_kr) ilike '%' || norm_name || '%'
  order by
    (norm_name = btrim(name_kr)) desc,                  -- 1순위: 완전 일치
    (norm_name ilike '%' || btrim(name_kr) || '%') desc -- 2순위: inventory명이 작업지시서명을 포함
  limit 5;
$$;
