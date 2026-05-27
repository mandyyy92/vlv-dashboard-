import React from 'react'
import { Heart, ExternalLink, BookmarkPlus } from 'lucide-react'

export default function HotItems({ items, loading, onSaveToBoard }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-5 backdrop-blur">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-neutral-500">Hot Items</div>
          <div className="mt-1 text-lg font-medium text-neutral-100">
            이번주 좋아요가 가장 많이 늘어난 아이템
          </div>
        </div>
        <button className="text-xs text-neutral-500 hover:text-neutral-300">전체 보기 →</button>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-[3/4] rounded-lg bg-neutral-900 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {items.map((it, idx) => (
            <article
              key={it.product_id}
              className="group relative overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 hover:border-lime-400/40 transition-colors"
            >
              {/* 순위 뱃지 */}
              <div className="absolute top-2 left-2 z-10 flex h-6 min-w-6 items-center justify-center rounded-md bg-black/70 px-1.5 text-[11px] font-mono font-medium text-lime-300 backdrop-blur">
                #{idx + 1}
              </div>

              {/* 좋아요 증가량 뱃지 */}
              <div className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-rose-300 backdrop-blur">
                <Heart size={10} fill="currentColor" />
                +{formatNum(it.likes_delta)}
              </div>

              {/* 이미지 */}
              <div className="aspect-[3/4] overflow-hidden bg-neutral-950">
                {it.image_url ? (
                  <img
                    src={it.image_url}
                    alt={it.product_name}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  <div className="h-full w-full grid place-items-center text-neutral-700 text-xs">no image</div>
                )}
              </div>

              {/* 메타 정보 */}
              <div className="p-3">
                <div className="text-[10px] uppercase tracking-wider text-neutral-500">{it.brand}</div>
                <div className="mt-0.5 line-clamp-2 text-xs text-neutral-200 leading-snug">
                  {it.product_name}
                </div>
                {(it.sub_category || it.fit || it.primary_color) && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {it.sub_category && <Tag>{it.sub_category}</Tag>}
                    {it.fit && <Tag>{it.fit}</Tag>}
                    {it.primary_color && <Tag>{it.primary_color}</Tag>}
                  </div>
                )}
              </div>

              {/* hover overlay 액션 */}
              <div className="absolute inset-0 flex items-end justify-between p-3 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => onSaveToBoard?.(it)}
                  className="flex items-center gap-1 rounded-md bg-lime-400 px-2 py-1 text-[11px] font-medium text-black hover:bg-lime-300"
                >
                  <BookmarkPlus size={12} />
                  기획 후보
                </button>
                <a
                  href={it.product_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-[11px] text-white hover:bg-white/20 backdrop-blur"
                >
                  <ExternalLink size={11} /> 원본
                </a>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function Tag({ children }) {
  return (
    <span className="inline-block rounded border border-neutral-800 bg-neutral-950 px-1.5 py-0.5 text-[10px] text-neutral-400">
      {children}
    </span>
  )
}

function formatNum(n) {
  if (n == null) return '0'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(n)
}
