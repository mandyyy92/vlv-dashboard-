import React, { useState } from 'react'
import { Heart, Bookmark, Search, Layers, Palette, Droplet, ExternalLink, Eye } from 'lucide-react'

/**
 * TrendItemCard v2
 * - 이미지 70% / 정보 30%
 * - hover 시 5개 액션 노출 (기획추가 / 유사검색 / 디테일분석 / 소재추출 / 컬러추출)
 * - 태그 칩 (핏 / 무드 / 컬러)
 * - 가격 + 좋아요 + 저장 + 조회수
 */
export default function TrendItemCard({ item, rank, onAction }) {
  const [imgLoaded, setImgLoaded] = useState(false)

  return (
    <article className="group relative break-inside-avoid mb-4 overflow-hidden rounded-xl bg-neutral-900 border border-neutral-800 hover:border-lime-400/50 transition-all duration-300">

      {/* 랭크 뱃지 */}
      {rank != null && (
        <div className="absolute top-3 left-3 z-20 flex h-7 min-w-7 items-center justify-center rounded-md bg-black/80 px-2 text-xs font-mono font-medium text-lime-300 backdrop-blur-md">
          #{rank}
        </div>
      )}

      {/* 좋아요 증가 뱃지 */}
      {item.likes_delta > 0 && (
        <div className="absolute top-3 right-3 z-20 flex items-center gap-1 rounded-md bg-rose-500/90 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-md">
          <Heart size={11} fill="currentColor" />
          +{formatNum(item.likes_delta)}
        </div>
      )}

      {/* 이미지 (70%) */}
      <div className="relative w-full overflow-hidden bg-neutral-950">
        {!imgLoaded && <div className="aspect-[3/4] bg-neutral-900 animate-pulse" />}
        <img
          src={item.image_url}
          alt={item.product_name}
          loading="lazy"
          onLoad={() => setImgLoaded(true)}
          className={[
            'w-full transition-all duration-700',
            'group-hover:scale-[1.04]',
            imgLoaded ? 'opacity-100' : 'opacity-0 absolute',
          ].join(' ')}
        />

        {/* hover 시 액션 오버레이 */}
        <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          {/* 상단 영역: 좋아요/저장/조회수 노출 */}
          <div className="absolute top-0 left-0 right-0 p-3 flex gap-3 text-[11px] text-white/90 opacity-0 group-hover:opacity-100 transition-opacity delay-100">
            <Stat icon={<Heart size={11} />} value={item.like_count} />
            <Stat icon={<Bookmark size={11} />} value={item.save_count} />
            <Stat icon={<Eye size={11} />} value={item.view_count} />
          </div>

          {/* 하단 영역: 5개 액션 */}
          <div className="p-3 space-y-2">
            {/* 메인 액션 */}
            <button
              onClick={() => onAction?.('save_to_board', item)}
              className="w-full flex items-center justify-center gap-1.5 rounded-md bg-lime-400 px-3 py-2 text-xs font-medium text-black hover:bg-lime-300 transition-colors"
            >
              <Bookmark size={13} />
              기획 추가
            </button>

            {/* 보조 액션 4개 */}
            <div className="grid grid-cols-4 gap-1.5">
              <ActionBtn icon={<Search size={12} />} label="유사" onClick={() => onAction?.('find_similar', item)} />
              <ActionBtn icon={<Layers size={12} />} label="디테일" onClick={() => onAction?.('detail_analysis', item)} />
              <ActionBtn icon={<Droplet size={12} />} label="소재" onClick={() => onAction?.('extract_material', item)} />
              <ActionBtn icon={<Palette size={12} />} label="컬러" onClick={() => onAction?.('extract_color', item)} />
            </div>

            {/* 원본 링크 */}
            <a
              href={item.product_url}
              target="_blank"
              rel="noreferrer"
              onClick={e => e.stopPropagation()}
              className="flex items-center justify-center gap-1 text-[10px] text-white/60 hover:text-white"
            >
              <ExternalLink size={9} /> 무신사에서 보기
            </a>
          </div>
        </div>
      </div>

      {/* 정보 영역 (30%) */}
      <div className="p-3.5">
        {/* 브랜드 */}
        <div className="text-[10px] uppercase tracking-[0.12em] text-neutral-500 font-medium">
          {item.brand}
        </div>

        {/* 상품명 */}
        <div className="mt-1 text-sm text-neutral-100 leading-snug line-clamp-2">
          {item.product_name}
        </div>

        {/* 가격 + 좋아요 한 줄 */}
        <div className="mt-2 flex items-baseline justify-between">
          <div className="text-sm font-semibold text-neutral-50 tracking-tight">
            {item.price ? `${item.price.toLocaleString()}원` : '—'}
          </div>
          <div className="flex items-center gap-0.5 text-[11px] text-neutral-500">
            <Heart size={10} />
            {formatNum(item.like_count)}
          </div>
        </div>

        {/* 태그 칩 */}
        <div className="mt-2.5 flex flex-wrap gap-1">
          {item.fit && <Chip variant="fit">{item.fit}</Chip>}
          {(item.mood || []).slice(0, 2).map(m => <Chip key={m} variant="mood">{m}</Chip>)}
          {item.primary_color && <ColorChip color={item.primary_color} />}
          {(item.detail_tags || []).slice(0, 2).map(d => <Chip key={d} variant="detail">{d}</Chip>)}
        </div>

        {/* AI 한줄평 */}
        {item.ai_notes && (
          <div className="mt-2.5 pt-2.5 border-t border-neutral-800 text-[11px] text-neutral-400 italic leading-snug">
            “{item.ai_notes}”
          </div>
        )}
      </div>
    </article>
  )
}

// ─── 서브 컴포넌트 ─────────────────────────────

function ActionBtn({ icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-0.5 rounded-md bg-white/10 backdrop-blur-md py-1.5 text-[10px] text-white hover:bg-white/20 transition-colors"
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function Stat({ icon, value }) {
  if (value == null) return null
  return (
    <div className="flex items-center gap-1 rounded bg-black/40 backdrop-blur-md px-1.5 py-0.5">
      {icon}
      <span>{formatNum(value)}</span>
    </div>
  )
}

function Chip({ children, variant }) {
  const styles = {
    fit:    'border-lime-400/30 text-lime-300 bg-lime-400/5',
    mood:   'border-orange-400/30 text-orange-300 bg-orange-400/5',
    detail: 'border-neutral-700 text-neutral-400 bg-neutral-900',
  }
  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] ${styles[variant] || styles.detail}`}>
      {children}
    </span>
  )
}

function ColorChip({ color }) {
  const cssColor = colorToCss(color)
  return (
    <span className="inline-flex items-center gap-1 rounded border border-neutral-700 bg-neutral-900 pl-0.5 pr-1.5 py-0.5 text-[10px] text-neutral-300">
      <span
        className="inline-block h-2.5 w-2.5 rounded-full border border-white/20"
        style={{ background: cssColor }}
      />
      {color}
    </span>
  )
}

// VLVD 컬러 사전 → CSS 컬러 매핑 (시각화용)
function colorToCss(c) {
  const map = {
    '블랙': '#0a0a0a', '차콜': '#3a3a3a', '그레이': '#9a9a9a', '멜란지그레이': '#8b8b8b',
    '아이보리': '#f5efe2', '화이트': '#ffffff', '크림': '#f3ead5',
    '워시드블랙': '#2a2a2a', '피그먼트블랙': '#222', '빈티지블랙': '#1f1f1f',
    '브라운': '#6b4423', '카멜': '#b88654', '베이지': '#d4b896', '카키': '#7a6e3c',
    '올리브': '#5c632a', '머드': '#5b4a35',
    '인디고': '#3a4a7a', '미디엄블루': '#5a78a8', '라이트블루': '#a8c4dc',
    '워시드데님': '#7b8eae', '블랙데님': '#1a1a2a',
    '네이비': '#1a2a4a', '블루': '#3a6ad4', '레드': '#c4302b', '버건디': '#5e1a23',
    '핑크': '#ec9eb8', '옐로우': '#ead24a', '머스타드': '#c4a02a',
    '그린': '#4a8a3a', '퍼플': '#7a4aa2', '오렌지': '#e88030',
  }
  return map[c] || '#888'
}

function formatNum(n) {
  if (n == null) return '0'
  if (n >= 10000) return (n / 10000).toFixed(1) + '만'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(n)
}
