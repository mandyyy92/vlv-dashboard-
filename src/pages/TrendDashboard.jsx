import React, { useState, useMemo } from 'react'
import KpiBar from '../components/trend/KpiBar'
import TrendGraph from '../components/trend/TrendGraph'
import MasonryGrid from '../components/trend/MasonryGrid'
import { useKpiSummary, useTrendSeries, useHotItems } from '../lib/useTrendData'
import { MOCK_KPI, MOCK_SERIES, MOCK_HOT_ITEMS } from '../lib/mockData'
import { FILTER_ORDER } from '../lib/taxonomy'
import { supabase } from '../lib/supabaseClient'

export default function TrendDashboard() {
  const [useMock, setUseMock] = useState(true)
  const [filters, setFilters] = useState({})  // { fit: '오버핏', mood: '스트릿', ... }

  const real = {
    kpi: useKpiSummary(),
    series: useTrendSeries(),
    hot: useHotItems(48),
  }

  const kpiData = useMock ? MOCK_KPI : real.kpi.data
  const series = useMock ? MOCK_SERIES : real.series.series
  const hotItems = useMock ? MOCK_HOT_ITEMS : real.hot.items

  // 클라이언트 사이드 필터링 (데이터 적을 때는 충분)
  const filtered = useMemo(() => {
    return hotItems.filter(it => {
      for (const [key, val] of Object.entries(filters)) {
        if (!val) continue
        const v = it[key === 'category' ? 'vlvd_category' : key]
        if (Array.isArray(v)) {
          if (!v.includes(val)) return false
        } else {
          if (v !== val) return false
        }
      }
      return true
    })
  }, [hotItems, filters])

  async function handleCardAction(action, item) {
    switch (action) {
      case 'save_to_board':
        if (useMock) { alert(`(mock) 기획 후보 저장: ${item.product_name}`); return }
        await supabase.from('planning_board').insert({
          product_id: item.product_id, status: 'candidate', target_season: detectNextSeason(),
        })
        alert('기획 후보로 저장됨')
        break
      case 'find_similar':
        alert(`(준비중) 유사 상품 찾기: ${item.product_name}`)
        break
      case 'detail_analysis':
        alert(`(준비중) 디테일 분석: ${item.product_name}`)
        break
      case 'extract_material':
        alert(`(준비중) 소재 추출: ${item.material || '미분석'}`)
        break
      case 'extract_color':
        alert(`(준비중) 컬러 추출: ${(item.color_palette || []).join(', ')}`)
        break
    }
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      {/* 배경 글로우 */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_-10%,rgba(190,242,100,0.06),transparent_50%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_110%,rgba(251,146,60,0.04),transparent_50%)]" />
      </div>

      {/* 헤더 */}
      <header className="sticky top-0 z-30 border-b border-neutral-900 bg-neutral-950/80 backdrop-blur-md px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <h1 className="text-xl font-semibold tracking-tight">VLVD Trend</h1>
            <span className="text-xs text-neutral-500">다음 시즌, 뭐 만들지 결정하는 보드</span>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-neutral-500">
              <input type="checkbox" checked={useMock} onChange={e => setUseMock(e.target.checked)} className="accent-lime-400" />
              더미 데이터
            </label>
            <span className="text-xs text-neutral-600">{new Date().toLocaleDateString('ko-KR')}</span>
          </div>
        </div>
      </header>

      <main className="px-6 py-6 space-y-6">
        {/* KPI */}
        <section><KpiBar data={kpiData} loading={false} /></section>

        {/* 트렌드 그래프 */}
        <section><TrendGraph series={series} loading={false} /></section>

        {/* 필터 바 + masonry */}
        <section>
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-5 backdrop-blur">
            <div className="flex items-baseline justify-between mb-4">
              <div>
                <div className="text-xs uppercase tracking-wider text-neutral-500">References</div>
                <div className="mt-1 text-lg font-medium text-neutral-100">
                  이번주 좋아요가 가장 많이 늘어난 아이템 · {filtered.length}건
                </div>
              </div>
              {Object.values(filters).some(Boolean) && (
                <button
                  onClick={() => setFilters({})}
                  className="text-xs text-neutral-500 hover:text-lime-300"
                >
                  필터 초기화 ✕
                </button>
              )}
            </div>

            <FilterBar filters={filters} onChange={setFilters} />

            <div className="mt-5">
              <MasonryGrid items={filtered} loading={false} onAction={handleCardAction} />
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

// ─── 필터 바 ─────────────────────────────────

function FilterBar({ filters, onChange }) {
  return (
    <div className="space-y-2.5">
      {FILTER_ORDER.map(({ key, label, options }) => (
        <div key={key} className="flex items-start gap-3">
          <div className="w-14 shrink-0 pt-1 text-[10px] uppercase tracking-wider text-neutral-500 font-medium">
            {label}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {options.slice(0, 12).map(opt => {
              const active = filters[key] === opt
              return (
                <button
                  key={opt}
                  onClick={() => onChange({ ...filters, [key]: active ? null : opt })}
                  className={[
                    'rounded-full border px-2.5 py-0.5 text-[11px] transition-colors',
                    active
                      ? 'border-lime-400 bg-lime-400 text-black'
                      : 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200',
                  ].join(' ')}
                >
                  {opt}
                </button>
              )
            })}
            {options.length > 12 && (
              <span className="text-[10px] text-neutral-600 self-center">+{options.length - 12}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function detectNextSeason() {
  const now = new Date()
  const month = now.getMonth() + 1
  const yearShort = String(now.getFullYear()).slice(2)
  if (month <= 6) return `${yearShort}FW`
  return `${(Number(yearShort) + 1).toString().padStart(2, '0')}SS`
}
