import React from 'react'
import TrendItemCard from './TrendItemCard'

/**
 * MasonryGrid
 * - CSS columns 기반 (외부 라이브러리 X, 의존성 최소)
 * - 반응형: sm 2 / md 3 / lg 4 / xl 5 컬럼
 */
export default function MasonryGrid({ items, loading, onAction }) {
  if (loading) {
    return (
      <div className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="mb-4 rounded-xl bg-neutral-900 animate-pulse"
            style={{ height: 240 + (i % 4) * 60 }}
          />
        ))}
      </div>
    )
  }

  if (!items?.length) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-12 text-center text-neutral-500">
        아직 수집된 아이템이 없습니다.
      </div>
    )
  }

  return (
    <div className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-4">
      {items.map((item, idx) => (
        <TrendItemCard
          key={item.product_id || idx}
          item={item}
          rank={idx + 1}
          onAction={onAction}
        />
      ))}
    </div>
  )
}
