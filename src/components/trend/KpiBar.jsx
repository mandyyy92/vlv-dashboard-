import React from 'react'
import { TrendingUp, Sparkles, Palette, Ruler, Crown } from 'lucide-react'

export default function KpiBar({ data, loading }) {
  const cards = [
    {
      icon: <Sparkles size={16} />,
      label: '이번주 저장 레퍼런스',
      value: data?.weeklyCount ?? '—',
      suffix: '건',
      accent: false,
    },
    {
      icon: <TrendingUp size={16} />,
      label: '급상승 카테고리',
      value: data?.risingCategory?.name ?? '—',
      sub: data?.risingCategory ? `❤ ${formatNum(data.risingCategory.score)}` : null,
      accent: true,
    },
    {
      icon: <Palette size={16} />,
      label: '가장 많이 등장한 컬러',
      value: data?.topColor?.name ?? '—',
      sub: data?.topColor ? `❤ ${formatNum(data.topColor.score)}` : null,
      accent: false,
    },
    {
      icon: <Ruler size={16} />,
      label: '가장 많이 등장한 핏',
      value: data?.topFit?.name ?? '—',
      sub: data?.topFit ? `❤ ${formatNum(data.topFit.score)}` : null,
      accent: false,
    },
    {
      icon: <Crown size={16} />,
      label: '경쟁 브랜드 TOP',
      value: data?.topBrand?.brand ?? '—',
      sub: data?.topBrand ? `❤ ${formatNum(data.topBrand.total_likes)}` : null,
      accent: false,
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
      {cards.map((c, i) => (
        <div
          key={i}
          className={[
            'relative rounded-xl border p-4 transition-all',
            'border-neutral-800 bg-neutral-950/60 backdrop-blur',
            c.accent ? 'ring-1 ring-lime-400/40' : '',
          ].join(' ')}
        >
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-neutral-500">
            <span className={c.accent ? 'text-lime-400' : 'text-neutral-400'}>{c.icon}</span>
            {c.label}
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <div className={[
              'text-2xl font-semibold tracking-tight',
              c.accent ? 'text-lime-300' : 'text-neutral-50',
            ].join(' ')}>
              {loading ? <span className="inline-block h-7 w-16 rounded bg-neutral-800 animate-pulse" /> : c.value}
            </div>
            {c.suffix && <div className="text-sm text-neutral-500">{c.suffix}</div>}
          </div>
          {c.sub && (
            <div className="mt-1 text-xs text-neutral-500">{c.sub}</div>
          )}
        </div>
      ))}
    </div>
  )
}

function formatNum(n) {
  if (n == null) return '—'
  if (n >= 10000) return (n / 10000).toFixed(1) + '만'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return n.toLocaleString()
}
