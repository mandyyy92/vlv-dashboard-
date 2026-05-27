import { createClient } from '@supabase/supabase-js'

// 이 앱은 두 가지 클라이언트를 함께 씁니다.
//  - sb        : 기존 App.jsx / hooks 가 쓰는 경량 REST 래퍼 (get/insert/update/remove)
//  - supabase  : 신규 무신사 트렌드 섹션 / TrendDashboard 가 쓰는 공식 supabase-js 클라이언트
// 둘 다 같은 프로젝트(같은 URL/KEY)를 바라봅니다.

export const SUPABASE_URL = "https://chpshustwroyoueursha.supabase.co"
export const SUPABASE_KEY = "sb_publishable_dKhwUOqNtIWmdwRqrL5jIw_ZX5Ebzoc"

export const sbHeaders = {
  "apikey": SUPABASE_KEY,
  "Authorization": `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
  "Prefer": "return=representation"
}

// 기존 코드 호환용 경량 REST 래퍼
export const sb = {
  async get(table) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&order=created_at.desc`, { headers: sbHeaders })
      if (!r.ok) throw new Error(r.statusText)
      return await r.json()
    } catch (e) { console.error(`[sb.get] ${table}:`, e); return [] }
  },
  async insert(table, data) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, { method: "POST", headers: sbHeaders, body: JSON.stringify(data) })
      if (!r.ok) throw new Error(r.statusText)
      return await r.json()
    } catch (e) { console.error(`[sb.insert] ${table}:`, e); return null }
  },
  async update(table, id, data) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, { method: "PATCH", headers: { ...sbHeaders, "Prefer": "return=representation" }, body: JSON.stringify(data) })
      if (!r.ok) throw new Error(r.statusText)
      return await r.json()
    } catch (e) { console.error(`[sb.update] ${table}:`, e); return null }
  },
  async remove(table, id) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, { method: "DELETE", headers: sbHeaders })
      return true
    } catch (e) { console.error(`[sb.delete] ${table}:`, e); return false }
  }
}

// 신규 코드용 공식 supabase-js 클라이언트 (supabase.from(...).select(...) 형태)
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
