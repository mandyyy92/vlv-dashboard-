import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

/**
 * 상단 KPI 카드용 데이터
 *  - 이번주 신규 레퍼런스 수
 *  - 급상승 카테고리 (전주 대비 좋아요 증가율 1위)
 *  - 가장 많이 등장한 컬러
 *  - 가장 많이 등장한 핏
 *  - 경쟁 브랜드 TOP
 */
export function useKpiSummary() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        // 이번주 신규 레퍼런스
        const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString()
        const { count: weeklyCount } = await supabase
          .from('trend_products')
          .select('*', { count: 'exact', head: true })
          .gte('first_seen_at', weekAgo)

        // 급상승 카테고리 / 컬러 / 핏 / 브랜드 - 주간 집계 뷰 사용
        const { data: weekly } = await supabase
          .from('trend_weekly_summary')
          .select('*')
          .order('week_start', { ascending: false })
          .limit(500)

        const thisWeek = weekly?.[0]?.week_start
        const thisWeekRows = weekly?.filter(r => r.week_start === thisWeek) || []

        const topBy = (key) => {
          const acc = {}
          for (const r of thisWeekRows) {
            const k = r[key]
            if (!k) continue
            acc[k] = (acc[k] || 0) + (r.total_likes || 0)
          }
          const [top] = Object.entries(acc).sort((a, b) => b[1] - a[1])
          return top ? { name: top[0], score: top[1] } : null
        }

        // 경쟁 브랜드 TOP (likes 합산)
        const { data: brandLikes } = await supabase.rpc('top_brands_this_week') // 별도 RPC 가정
        const topBrand = brandLikes?.[0] || null

        setData({
          weeklyCount: weeklyCount ?? 0,
          risingCategory: topBy('sub_category'),
          topColor: topBy('primary_color'),
          topFit: topBy('fit'),
          topBrand,
        })
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  return { data, loading }
}

/**
 * 트렌드 그래프용: 최근 8주간 sub_category 별 좋아요 추이
 */
export function useTrendSeries() {
  const [series, setSeries] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      setLoading(true)
      const { data } = await supabase
        .from('trend_weekly_summary')
        .select('week_start, sub_category, total_likes')
        .order('week_start', { ascending: true })

      // sub_category 별로 시계열 묶기 + 최근 8주 상위 카테고리만 보여주기
      const byCat = {}
      for (const row of data || []) {
        if (!row.sub_category) continue
        byCat[row.sub_category] = byCat[row.sub_category] || []
        byCat[row.sub_category].push({
          week: row.week_start,
          likes: row.total_likes,
        })
      }

      // 최근주 좋아요 합 기준 상위 6개 카테고리
      const top = Object.entries(byCat)
        .map(([cat, points]) => ({
          category: cat,
          points,
          latestLikes: points[points.length - 1]?.likes || 0,
          delta: calcDelta(points),
        }))
        .sort((a, b) => b.latestLikes - a.latestLikes)
        .slice(0, 6)

      setSeries(top)
      setLoading(false)
    })()
  }, [])

  return { series, loading }
}

function calcDelta(points) {
  if (points.length < 2) return 0
  const last = points[points.length - 1].likes
  const prev = points[points.length - 2].likes
  if (!prev) return 0
  return ((last - prev) / prev) * 100
}

/**
 * HOT ITEM 카드: 이번주 좋아요 가장 많이 늘어난 상품
 */
export function useHotItems(limit = 12) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      setLoading(true)
      const { data } = await supabase.rpc('hot_items_this_week', { p_limit: limit })
      setItems(data || [])
      setLoading(false)
    })()
  }, [limit])

  return { items, loading }
}
