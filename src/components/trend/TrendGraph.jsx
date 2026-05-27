import React from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts'
import { ArrowUpRight, ArrowDownRight } from 'lucide-react'

const LINE_COLORS = ['#bef264', '#fb923c', '#60a5fa', '#f472b6', '#a78bfa', '#facc15']

export default function TrendGraph({ series, loading }) {
  // recharts 가 받는 평탄화된 데이터로 변환
  // [{ week: '...', '후드집업': 1200, '와이드데님': 800, ... }, ...]
  const allWeeks = Array.from(
    new Set(series.flatMap(s => s.points.map(p => p.week)))
  ).sort()

  const flat = allWeeks.map(week => {
    const row = { week: formatWeek(week) }
    for (const s of series) {
      const point = s.points.find(p => p.week === week)
      row[s.category] = point?.likes ?? null
    }
    return row
  })

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-5 backdrop-blur">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-neutral-500">시즌 흐름</div>
          <div className="mt-1 text-lg font-medium text-neutral-100">카테고리별 좋아요 추이 · 최근 8주</div>
        </div>
        <div className="flex gap-1.5 text-xs">
          {series.slice(0, 4).map((s, i) => (
            <DeltaPill key={s.category} category={s.category} delta={s.delta} color={LINE_COLORS[i]} />
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-64 rounded-lg bg-neutral-900 animate-pulse" />
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={flat} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#1f1f1f" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="week"
                stroke="#525252"
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="#525252"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v}
              />
              <Tooltip
                contentStyle={{
                  background: '#0a0a0a',
                  border: '1px solid #262626',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelStyle={{ color: '#a3a3a3' }}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, paddingTop: 12 }}
                iconType="circle"
                iconSize={8}
              />
              {series.map((s, i) => (
                <Line
                  key={s.category}
                  type="monotone"
                  dataKey={s.category}
                  stroke={LINE_COLORS[i % LINE_COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

function DeltaPill({ category, delta, color }) {
  const up = delta >= 0
  return (
    <div
      className="inline-flex items-center gap-1 rounded-full border border-neutral-800 px-2 py-1"
      style={{ borderColor: color + '40' }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      <span className="text-neutral-300">{category}</span>
      <span className={up ? 'text-lime-400' : 'text-rose-400'}>
        {up ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
        {Math.abs(delta).toFixed(0)}%
      </span>
    </div>
  )
}

function formatWeek(iso) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
