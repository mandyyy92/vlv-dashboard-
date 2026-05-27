-- =====================================================
-- VLVD 트렌드 - RPC 함수
-- =====================================================

-- 1) 이번주 좋아요 증가량 상위 N 상품
create or replace function hot_items_this_week(p_limit int default 12)
returns table (
  product_id    bigint,
  brand         text,
  product_name  text,
  image_url     text,
  product_url   text,
  sub_category  text,
  fit           text,
  primary_color text,
  likes_delta   integer
)
language sql stable as $$
  with this_week as (
    select product_id, max(like_count) as likes
    from trend_metrics_daily
    where snapshot_date >= current_date - interval '7 days'
    group by product_id
  ),
  last_week as (
    select product_id, max(like_count) as likes
    from trend_metrics_daily
    where snapshot_date >= current_date - interval '14 days'
      and snapshot_date <  current_date - interval '7 days'
    group by product_id
  )
  select
    p.id,
    p.brand,
    p.product_name,
    p.image_url,
    p.product_url,
    a.sub_category,
    a.fit,
    a.primary_color,
    (tw.likes - coalesce(lw.likes, 0)) as likes_delta
  from this_week tw
  join trend_products  p on p.id = tw.product_id
  left join last_week  lw on lw.product_id = tw.product_id
  left join trend_analysis a on a.product_id = tw.product_id
  order by likes_delta desc nulls last
  limit p_limit;
$$;

-- 2) 이번주 브랜드별 좋아요 합 (경쟁 브랜드 TOP 용)
create or replace function top_brands_this_week()
returns table (brand text, total_likes bigint)
language sql stable as $$
  select p.brand, sum(m.like_count)::bigint as total_likes
  from trend_metrics_daily m
  join trend_products p on p.id = m.product_id
  where m.snapshot_date >= current_date - interval '7 days'
    and p.brand is not null
  group by p.brand
  order by total_likes desc
  limit 10;
$$;

-- 3) 매뷰 refresh 함수 (cron 에서 호출)
create or replace function refresh_trend_summary()
returns void
language sql security definer as $$
  refresh materialized view concurrently trend_weekly_summary;
$$;
