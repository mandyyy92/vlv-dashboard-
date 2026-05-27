-- =====================================================
-- VLVD Trend v2 — 7축 태깅 컬럼 추가
-- =====================================================

-- trend_analysis 에 새 컬럼들
alter table trend_analysis add column if not exists mood          text[];   -- 무드 (다중)
alter table trend_analysis add column if not exists graphic       text[];   -- 그래픽 유형
alter table trend_analysis add column if not exists save_count    integer;  -- 무신사 저장 수 (있으면)
alter table trend_analysis add column if not exists view_count    integer;  -- 조회수 (있으면)
alter table trend_analysis add column if not exists ai_notes      text;     -- Claude 가 남기는 한줄평
alter table trend_analysis add column if not exists reviewed_at   timestamptz;  -- 사람이 검수한 시각
alter table trend_analysis add column if not exists reviewed_by   text;

-- silhouette / material / detail_tags 는 이미 v1 에 있음

-- 검수 히스토리 (어떤 값을 누가 어떻게 고쳤는지)
create table if not exists trend_analysis_revisions (
  id           bigserial primary key,
  product_id   bigint not null references trend_products(id) on delete cascade,
  field        text not null,        -- 'fit', 'mood', 'primary_color' 등
  old_value    jsonb,
  new_value    jsonb,
  changed_by   text,
  changed_at   timestamptz not null default now()
);

create index if not exists idx_revisions_product on trend_analysis_revisions(product_id);

-- 메트릭 테이블에 저장수/조회수 추가
alter table trend_metrics_daily add column if not exists save_count integer;
alter table trend_metrics_daily add column if not exists view_count integer;

-- mood / graphic 별 집계용 인덱스 (GIN)
create index if not exists idx_analysis_mood    on trend_analysis using gin(mood);
create index if not exists idx_analysis_graphic on trend_analysis using gin(graphic);
create index if not exists idx_analysis_detail  on trend_analysis using gin(detail_tags);
