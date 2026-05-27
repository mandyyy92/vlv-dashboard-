-- =====================================================
-- VLVD 트렌드 분석 모듈 스키마
-- 생성일: 2026-05-27
-- =====================================================

-- 1) 크롤링 소스 상품 원본 (raw)
-- 무신사 / 29CM 에서 매일 수집한 스냅샷 저장
create table if not exists trend_products (
  id              bigserial primary key,
  source          text not null check (source in ('musinsa', '29cm')),
  external_id     text not null,                     -- 무신사 goods_no 등
  product_url     text not null,
  brand           text,
  product_name    text not null,
  price           integer,
  discount_price  integer,
  image_url       text,
  raw_category    text,                              -- 사이트가 분류한 카테고리 (그대로 보존)
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  unique (source, external_id)
);

create index if not exists idx_trend_products_brand on trend_products(brand);
create index if not exists idx_trend_products_source on trend_products(source);

-- 2) 일별 메트릭 스냅샷 (시계열)
-- 좋아요(하트), 랭킹, 후기수를 매일 적재 → 시즌별 트렌드 그래프의 원천
create table if not exists trend_metrics_daily (
  id              bigserial primary key,
  product_id      bigint not null references trend_products(id) on delete cascade,
  snapshot_date   date not null,
  like_count      integer default 0,                 -- 하트수
  review_count    integer default 0,
  rank_position   integer,                           -- 랭킹 페이지 순위
  sold_qty        integer,                           -- 판매량 (있으면)
  unique (product_id, snapshot_date)
);

create index if not exists idx_metrics_date on trend_metrics_daily(snapshot_date desc);
create index if not exists idx_metrics_product_date on trend_metrics_daily(product_id, snapshot_date desc);

-- 3) AI 분석 결과 (Claude 가 추출한 속성)
-- 카테고리/핏/컬러/소재/디테일을 정규화해서 저장
create table if not exists trend_analysis (
  id              bigserial primary key,
  product_id      bigint not null unique references trend_products(id) on delete cascade,
  vlvd_category   text,                              -- VLVD 내부 카테고리 체계로 매핑
  sub_category    text,                              -- 후드집업, 와이드데님 등 세부
  fit             text,                              -- 오버핏 / 레귤러 / 슬림 / 크롭 등
  silhouette      text,                              -- A라인, H라인 등
  primary_color   text,
  color_palette   text[],                            -- 멀티컬러 케이스
  material        text,                              -- 피그먼트, 코듀로이, 데님 등
  detail_tags     text[],                            -- 워싱, 자수, 패치워크 등
  season          text,                              -- SS / FW / ALL
  gender          text,                              -- M / W / U
  confidence      numeric(3,2),                      -- 0.00 ~ 1.00
  analyzed_at     timestamptz not null default now(),
  model_used      text default 'claude-sonnet-4-5'
);

create index if not exists idx_analysis_vlvd_cat on trend_analysis(vlvd_category);
create index if not exists idx_analysis_sub_cat on trend_analysis(sub_category);
create index if not exists idx_analysis_fit on trend_analysis(fit);
create index if not exists idx_analysis_color on trend_analysis(primary_color);

-- 4) 기획 후보 보드 (사용자가 "이건 우리도 만들어보자" 라고 저장한 것)
create table if not exists planning_board (
  id              bigserial primary key,
  product_id      bigint references trend_products(id) on delete set null,
  saved_by        text,                              -- 박하늘 등 작업자
  status          text not null default 'candidate'  -- candidate / reviewing / approved / sampling / dropped
                  check (status in ('candidate','reviewing','approved','sampling','dropped')),
  target_season   text,                              -- 26FW, 27SS 등
  vlvd_code       text,                              -- 우리 내부 품번 (샘플 진행 시 부여)
  memo            text,
  saved_at        timestamptz not null default now()
);

create index if not exists idx_board_status on planning_board(status);
create index if not exists idx_board_season on planning_board(target_season);

-- 5) 주간 집계 뷰용 매테리얼라이즈드 뷰
-- 대시보드 KPI / 그래프 빠르게 그리기 위함. 매일 새벽에 refresh.
create materialized view if not exists trend_weekly_summary as
select
  date_trunc('week', m.snapshot_date) as week_start,
  a.sub_category,
  a.fit,
  a.primary_color,
  count(distinct m.product_id) as product_count,
  sum(m.like_count) as total_likes,
  avg(m.like_count) as avg_likes,
  max(m.like_count) as max_likes
from trend_metrics_daily m
join trend_analysis a on a.product_id = m.product_id
where m.snapshot_date >= current_date - interval '12 weeks'
group by 1, 2, 3, 4;

create index if not exists idx_weekly_summary_week on trend_weekly_summary(week_start desc);

-- RLS (Row Level Security) - 일단 인증된 사용자만 읽기/쓰기
alter table trend_products enable row level security;
alter table trend_metrics_daily enable row level security;
alter table trend_analysis enable row level security;
alter table planning_board enable row level security;

create policy "authenticated read" on trend_products for select using (auth.role() = 'authenticated');
create policy "authenticated read" on trend_metrics_daily for select using (auth.role() = 'authenticated');
create policy "authenticated read" on trend_analysis for select using (auth.role() = 'authenticated');
create policy "authenticated all" on planning_board for all using (auth.role() = 'authenticated');

-- 서비스 롤은 모두 가능 (크롤러가 사용)
create policy "service write" on trend_products for all using (auth.jwt()->>'role' = 'service_role');
create policy "service write" on trend_metrics_daily for all using (auth.jwt()->>'role' = 'service_role');
create policy "service write" on trend_analysis for all using (auth.jwt()->>'role' = 'service_role');
