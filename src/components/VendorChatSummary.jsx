// src/components/VendorChatSummary.jsx
// 업체 소통 요약 — 메뉴 컴포넌트 (v1: 업체 리스트 / 대화 불러오기 / 원문 타임라인)
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { parseKakaoChat } from '../utils/kakaoParser';
import { SUPABASE_URL, sbHeaders } from '../lib/supabaseClient';

// App.jsx 는 @supabase/supabase-js 를 쓰지 않고 PostgREST 를 fetch 로 직접 호출한다.
// 다른 탭들과 같은 방식(SUPABASE_URL + sbHeaders)을 그대로 따른다.
const REST = `${SUPABASE_URL}/rest/v1`;

async function sbFetch(path, init = {}) {
  const r = await fetch(`${REST}/${path}`, {
    ...init,
    headers: { ...sbHeaders, ...(init.headers || {}) },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text || r.statusText}`);
  return text ? JSON.parse(text) : null; // return=minimal 응답은 본문이 없다
}

const S = {
  wrap: { display: 'flex', gap: 16, height: 'calc(100vh - 200px)', minHeight: 520 },
  side: {
    width: 220, flexShrink: 0, border: '1px solid #e5e7eb', borderRadius: 12,
    background: '#fff', height: '100%', overflow: 'hidden',
    display: 'flex', flexDirection: 'column',
  },
  sideHead: {
    padding: '12px 14px', fontSize: 12, fontWeight: 700, color: '#6b7280',
    borderBottom: '1px solid #f3f4f6', flexShrink: 0,
  },
  // 목록만 스크롤한다. minHeight:0 이 없으면 flex 아이템이 줄지 않아 패널을 넘친다.
  sideList: { flex: 1, minHeight: 0, overflowY: 'auto' },
  // 하단 고정. 등록 폼이 길어지면 이 영역만 스크롤되고 목록은 사라지지 않는다.
  sideFoot: {
    flexShrink: 0, maxHeight: '60%', overflowY: 'auto',
    borderTop: '1px solid #e5e7eb', background: '#fff',
  },
  vendorBtn: (on) => ({
    width: '100%', textAlign: 'left', padding: '11px 14px', border: 'none',
    borderBottom: '1px solid #f9fafb', cursor: 'pointer',
    background: on ? '#eef2ff' : '#fff',
    color: on ? '#3730a3' : '#111827',
    fontWeight: on ? 700 : 500, fontSize: 14,
  }),
  tag: { fontSize: 11, color: '#9ca3af', marginLeft: 6, fontWeight: 400 },
  main: {
    flex: 1, border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  bar: {
    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
    padding: '10px 14px', borderBottom: '1px solid #f3f4f6',
  },
  tabs: { display: 'flex', gap: 4, padding: '8px 14px 0', borderBottom: '1px solid #e5e7eb' },
  tab: (on) => ({
    padding: '8px 14px', border: 'none', cursor: 'pointer', fontSize: 14,
    background: 'transparent', fontWeight: on ? 700 : 500,
    color: on ? '#4f46e5' : '#6b7280',
    borderBottom: on ? '2px solid #4f46e5' : '2px solid transparent',
  }),
  body: { flex: 1, overflowY: 'auto', padding: 16 },
  input: { padding: '6px 9px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 },
  btn: (kind) => ({
    padding: '7px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    border: kind === 'ghost' ? '1px solid #d1d5db' : 'none',
    background: kind === 'primary' ? '#4f46e5' : kind === 'ghost' ? '#fff' : '#f3f4f6',
    color: kind === 'primary' ? '#fff' : '#374151',
  }),
  card: {
    border: '1px solid #e5e7eb', borderRadius: 10, padding: 14,
    marginBottom: 12, background: '#fafafa',
  },
  stat: { display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13, color: '#374151' },
  statNum: { fontSize: 20, fontWeight: 700, color: '#111827', display: 'block' },
  msgRow: { padding: '8px 0', borderBottom: '1px solid #f3f4f6', fontSize: 13, lineHeight: 1.55 },
  meta: { fontSize: 11, color: '#9ca3af', marginBottom: 2 },
  empty: { padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 14 },

  /* --- 요약 탭 --- */
  cardHead: {
    display: 'flex', alignItems: 'baseline', gap: 8,
    paddingBottom: 8, borderBottom: '1px solid #e5e7eb',
  },
  secTitle: { fontSize: 12, fontWeight: 700, color: '#6b7280', margin: '12px 0 5px' },
  li: {
    display: 'flex', gap: 6, alignItems: 'baseline',
    padding: '3px 0', fontSize: 13, lineHeight: 1.55, color: '#374151',
  },
  dot: { color: '#c4c8d0', flexShrink: 0 },
  badge: {
    fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
    background: '#eef2ff', color: '#3730a3', flexShrink: 0,
  },
  dueBadge: {
    fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
    background: '#fef3c7', color: '#92400e', flexShrink: 0, marginLeft: 6,
  },
  sampleBadge: {
    fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
    background: '#cffafe', color: '#155e75', flexShrink: 0, marginLeft: 6,
  },
  riskBox: {
    marginTop: 12, padding: '10px 12px', background: '#fff7ed',
    border: '1px solid #fed7aa', borderRadius: 8,
  },
  riskTitle: { fontSize: 12, fontWeight: 700, color: '#c2410c', marginBottom: 5 },
  fail: {
    fontSize: 12, padding: '5px 9px', borderRadius: 6, marginBottom: 6,
    background: '#fef2f2', color: '#b91c1c',
  },
  note: {
    fontSize: 12, padding: '5px 9px', borderRadius: 6, marginBottom: 6,
    background: '#f3f4f6', color: '#6b7280',
  },
  noteOn: {
    fontSize: 12, padding: '5px 9px', borderRadius: 6, marginBottom: 6,
    background: '#eef2ff', color: '#3730a3',
  },

  /* --- 업체 등록/수정 --- */
  vendorRow: { position: 'relative' },
  dots: {
    position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
    padding: '2px 6px', border: 'none', borderRadius: 4, background: 'transparent',
    color: '#9ca3af', fontSize: 15, lineHeight: 1, cursor: 'pointer',
  },
  menuRow: {
    display: 'flex', gap: 6, padding: '6px 10px',
    background: '#f9fafb', borderBottom: '1px solid #f3f4f6',
  },
  menuItem: {
    flex: 1, padding: '5px 0', border: '1px solid #d1d5db', borderRadius: 5,
    background: '#fff', color: '#374151', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  addBtn: {
    display: 'block', width: 'calc(100% - 20px)', boxSizing: 'border-box',
    margin: 10, padding: '9px 12px', textAlign: 'left',
    border: '1px dashed #d1d5db', borderRadius: 6, background: '#fff', color: '#9ca3af',
    fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  vForm: {
    display: 'flex', flexDirection: 'column', gap: 6, padding: 12,
    background: '#f9fafb', borderTop: '1px solid #f3f4f6', borderBottom: '1px solid #f3f4f6',
  },
  // S.input 과 같은 토큰. 사이드바 폭(220)에 맞춰 폭만 채운다.
  vInput: {
    width: '100%', boxSizing: 'border-box', padding: '6px 9px',
    border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, background: '#fff',
  },
  vErr: { fontSize: 12, color: '#b91c1c', lineHeight: 1.5 },
  vHint: { fontSize: 11, color: '#9ca3af', lineHeight: 1.5 },
};


// 업체 등록 폼 선택지. category 는 chat_vendors 의 check 제약과 같아야 한다
// ('기타' 는 supabase/chat_summary.sql 의 ALTER 문을 실행해야 허용된다).
const VENDOR_CATEGORIES = ['봉제', '원단', '나염', '부자재', '기타'];
const VENDOR_LANGS = [
  { v: 'ko', label: '한국어(ko)' },
  { v: 'en', label: '영어(en)' },
  { v: 'zh', label: '중국어(zh)' },
];
// 기존 데이터가 목록에 없는 구분을 쓰고 있으면 그 값도 선택지로 살려둔다(조용한 변경 방지)
const catOptions = (cur) =>
  cur && !VENDOR_CATEGORIES.includes(cur) ? [...VENDOR_CATEGORIES, cur] : VENDOR_CATEGORIES;

const fmtKst = (iso) => {
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 16).replace('T', ' ');
};

/* ---------------- 요약 유틸 ---------------- */

// 기간을 '월 단위'로 쪼갠다. 첫 달/마지막 달은 from~to 로 잘라낸다.
function monthChunks(fromStr, toStr) {
  const out = [];
  if (!fromStr || !toStr || fromStr > toStr) return out;
  let y = Number(fromStr.slice(0, 4));
  let m = Number(fromStr.slice(5, 7));
  const ty = Number(toStr.slice(0, 4));
  const tm = Number(toStr.slice(5, 7));
  if (!y || !m || !ty || !tm) return out;
  while (y < ty || (y === ty && m <= tm)) {
    const mm = String(m).padStart(2, '0');
    const first = `${y}-${mm}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // 다음 달 0일 = 이 달 마지막 날
    const last = `${y}-${mm}-${String(lastDay).padStart(2, '0')}`;
    out.push({
      key: `${y}-${mm}`,
      label: `${y}년 ${m}월`,
      from: first < fromStr ? fromStr : first,
      to: last > toStr ? toStr : last,
    });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

// 저장된 요약 1행이 '몇 월'인지. period_from/to 의 중간값으로 판단하므로
// Edge Function 이 경계를 하루 어긋나게 저장해도 같은 월로 묶인다.
function monthKeyOf(row) {
  const a = Date.parse(`${String(row?.period_from || '').slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a)) return null;
  const b = Date.parse(`${String(row?.period_to || '').slice(0, 10)}T00:00:00Z`);
  const mid = new Date(Number.isNaN(b) ? a : (a + b) / 2);
  return `${mid.getUTCFullYear()}-${String(mid.getUTCMonth() + 1).padStart(2, '0')}`;
}

const monthLabel = (key) => `${key.slice(0, 4)}년 ${Number(key.slice(5, 7))}월`;

function cardTitle(row) {
  const f = String(row?.period_from || '').slice(0, 10);
  const t = String(row?.period_to || '').slice(0, 10);
  const key = monthKeyOf(row);
  const span = (Date.parse(`${t}T00:00:00Z`) - Date.parse(`${f}T00:00:00Z`)) / 86400000;
  if (!key || !(span >= 0) || span > 45) return `${f} ~ ${t}`; // 월 단위가 아니면 기간 그대로
  return monthLabel(key);
}

// Edge Function 은 영문 키를, supabase/chat_summary.sql 주석은 한글 키를 쓴다. 둘 다 받는다.
const SUM_SECTIONS = [
  { title: '핵심요약', keys: ['summary', '핵심요약'] },
  { title: '납기', keys: ['delivery', '납기'] },
  // 샘플은 납기와 같은 형태([{ style_no, content, date }])지만 날짜 뱃지 색만 다르게 쓴다
  { title: '샘플', keys: ['sample', '샘플'], dateBadge: S.sampleBadge },
  { title: '품질/클레임', keys: ['quality', '품질_클레임', '품질'] },
  { title: '수량/단가', keys: ['price_qty', '수량_단가'] },
  { title: '회신 필요', keys: ['our_todo', '우리_회신필요'] },
];
const RISK_KEYS = ['risks', '리스크'];

// 항목이 문자열로 와도 객체로 와도 { content, styleNo, date } 로 맞춘다. 내용 없으면 버린다.
function normItem(v) {
  if (v == null) return null;
  if (typeof v === 'string' || typeof v === 'number') {
    const c = String(v).trim();
    return c ? { content: c, styleNo: '', date: '' } : null;
  }
  if (typeof v !== 'object') return null;
  const content = String(v.content ?? v['내용'] ?? v.text ?? '').trim();
  if (!content) return null;
  return {
    content,
    styleNo: String(v.style_no ?? v['품번'] ?? '').trim(),
    date: String(v.date ?? v.due ?? v.due_date ?? v['변경일'] ?? v['기한'] ?? '').trim(),
  };
}

function pickSection(json, keys) {
  for (const k of keys) {
    if (Array.isArray(json?.[k])) return json[k].map(normItem).filter(Boolean);
  }
  return [];
}

function SummaryCard({ row }) {
  const json = row?.summary_json || {};
  // 빈 섹션은 아예 렌더하지 않는다
  const secs = SUM_SECTIONS
    .map((s) => ({
      title: s.title,
      dateBadge: s.dateBadge || S.dueBadge,
      items: pickSection(json, s.keys),
    }))
    .filter((s) => s.items.length);
  const risks = pickSection(json, RISK_KEYS);

  return (
    <div style={S.card}>
      <div style={S.cardHead}>
        <strong style={{ fontSize: 14 }}>{cardTitle(row)}</strong>
        <span style={{ fontSize: 12, color: '#6b7280' }}>
          {row?.message_count == null ? '(건수 미기록)' : `(메시지 ${row.message_count}건)`}
        </span>
        <div style={{ flex: 1 }} />
        {row?.model && <span style={S.tag}>{row.model}</span>}
      </div>

      {secs.map((s) => (
        <div key={s.title}>
          <div style={S.secTitle}>{s.title}</div>
          {s.items.map((it, i) => (
            <div key={i} style={S.li}>
              <span style={S.dot}>•</span>
              {it.styleNo && <span style={S.badge}>{it.styleNo}</span>}
              <span style={{ whiteSpace: 'pre-wrap' }}>{it.content}</span>
              {it.date && <span style={s.dateBadge}>{it.date}</span>}
            </div>
          ))}
        </div>
      ))}

      {!!risks.length && (
        <div style={S.riskBox}>
          <div style={S.riskTitle}>⚠ 리스크</div>
          {risks.map((it, i) => (
            <div key={i} style={{ ...S.li, color: '#9a3412' }}>
              <span style={{ ...S.dot, color: '#fdba74' }}>•</span>
              {it.styleNo && <span style={S.badge}>{it.styleNo}</span>}
              <span style={{ whiteSpace: 'pre-wrap' }}>{it.content}</span>
            </div>
          ))}
        </div>
      )}

      {!secs.length && !risks.length && (
        <div style={{ ...S.empty, padding: 16 }}>요약 내용이 비어 있습니다.</div>
      )}
    </div>
  );
}

export default function VendorChatSummary() {
  const [vendors, setVendors] = useState([]);
  const [vendorId, setVendorId] = useState(null);
  const [tab, setTab] = useState('summary');

  // 기간 필터 — 기본값 2026년 전체
  const [from, setFrom] = useState('2026-01-01');
  const [to, setTo] = useState('2026-12-31');

  const [raw, setRaw] = useState('');
  const [parsed, setParsed] = useState(null);
  const [saving, setSaving] = useState(false);
  const [log, setLog] = useState('');

  const [timeline, setTimeline] = useState([]);
  const [loadingTl, setLoadingTl] = useState(false);

  // 요약 탭
  const [summaries, setSummaries] = useState([]);
  const [loadingSum, setLoadingSum] = useState(false);
  const [gen, setGen] = useState(null);   // 진행 중일 때만 { i, total, label }
  const [logs, setLogs] = useState([]);   // 진행 로그 [{ key, kind, text }]
  const [sumErr, setSumErr] = useState('');

  // 업체 등록/수정
  const [vForm, setVForm] = useState(null);   // null | { mode:'new'|'edit', id, name, category, lang, manager }
  const [vSaving, setVSaving] = useState(false);
  const [vErr, setVErr] = useState('');
  const [menuId, setMenuId] = useState(null); // ⋯ 메뉴가 열린 업체 id
  const [hoverId, setHoverId] = useState(null);
  const nameRef = useRef(null);

  const vendor = useMemo(
    () => vendors.find((v) => v.id === vendorId) || null,
    [vendors, vendorId]
  );

  /* ---------------- 업체 목록 ---------------- */
  // selectId 를 주면 그 업체를 선택한다(신규 등록 직후). 없으면 기존 선택을 유지.
  const loadVendors = async (selectId) => {
    try {
      const data = await sbFetch('chat_vendors?select=*&is_active=eq.true&order=name.asc');
      const list = data || [];
      setVendors(list);
      setVendorId((cur) => {
        if (selectId && list.some((v) => v.id === selectId)) return selectId;
        if (cur && list.some((v) => v.id === cur)) return cur;
        return list.length ? list[0].id : null;
      });
      return list;
    } catch (e) {
      setLog(`업체 목록 오류: ${e.message}`);
      return null;
    }
  };

  useEffect(() => { loadVendors(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ⋯ 메뉴는 바깥을 클릭하면 닫는다 (⋯ 버튼 자체는 stopPropagation 으로 제외)
  useEffect(() => {
    if (!menuId) return undefined;
    const close = () => setMenuId(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menuId]);

  /* ---------------- 업체 등록/수정 ---------------- */
  const openNew = () => {
    setVErr('');
    setMenuId(null);
    setVForm({ mode: 'new', id: null, name: '', category: '봉제', lang: 'ko', manager: '' });
  };

  const openEdit = (v) => {
    setVErr('');
    setMenuId(null);
    setVForm({
      mode: 'edit',
      id: v.id,
      name: v.name || '',
      category: v.category || '봉제',
      lang: v.lang || 'ko',
      manager: v.manager || '',
    });
  };

  const closeVForm = () => { setVForm(null); setVErr(''); };

  const saveVendor = async () => {
    if (!vForm || vSaving) return;
    const name = (vForm.name || '').trim();
    if (!name) { setVErr('업체명을 입력하세요.'); nameRef.current?.focus(); return; }

    setVSaving(true);
    setVErr('');
    const payload = {
      name,
      category: vForm.category,
      lang: vForm.lang,
      manager: (vForm.manager || '').trim() || null,
    };
    try {
      let selectId = vForm.id;
      if (vForm.mode === 'new') {
        const [row] = (await sbFetch('chat_vendors', {
          method: 'POST',
          body: JSON.stringify({ ...payload, is_active: true }),
        })) || [];
        selectId = row?.id || null;
      } else {
        await sbFetch(`chat_vendors?id=eq.${encodeURIComponent(vForm.id)}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      }
      setLog(`업체 ${vForm.mode === 'new' ? '등록' : '수정'} 완료 — ${name}`);
      setVForm(null);
      await loadVendors(selectId);
    } catch (e) {
      const msg = String(e.message || '');
      if (msg.startsWith('409') || /duplicate key|already exists/i.test(msg)) {
        setVErr('이미 등록된 업체명입니다');
      } else if (/category_check|check constraint/i.test(msg)) {
        // chat_vendors 의 check 제약에 없는 구분(예: '기타')
        setVErr(`'${vForm.category}' 구분은 DB 제약에 없습니다. supabase/chat_summary.sql 의 ALTER 문을 실행하세요.`);
      } else {
        setVErr('저장 실패');
        setLog(`업체 저장 실패: ${e.message}`);
      }
    } finally {
      setVSaving(false);
    }
  };

  // 삭제가 아니라 is_active=false. 대화 기록은 그대로 남는다.
  const deactivateVendor = async (v) => {
    setMenuId(null);
    try {
      await sbFetch(`chat_vendors?id=eq.${encodeURIComponent(v.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ is_active: false }),
      });
      if (vForm?.mode === 'edit' && vForm.id === v.id) closeVForm();
      setLog(`${v.name} 비활성화 — 목록에서만 숨겨집니다.`);
      await loadVendors();
    } catch (e) {
      setLog(`비활성화 실패: ${e.message}`);
    }
  };

  // 신규 등록(목록 하단)과 수정(해당 항목 자리) 모두 같은 폼을 쓴다
  const renderVForm = () => (
    <div style={S.vForm}>
      <input
        ref={nameRef}
        value={vForm.name}
        onChange={(e) => setVForm({ ...vForm, name: e.target.value })}
        onKeyDown={(e) => { if (e.key === 'Enter') saveVendor(); if (e.key === 'Escape') closeVForm(); }}
        placeholder="업체명 *"
        style={S.vInput}
      />
      <select
        value={vForm.category}
        onChange={(e) => setVForm({ ...vForm, category: e.target.value })}
        style={S.vInput}
      >
        {catOptions(vForm.category).map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <select
        value={vForm.lang}
        onChange={(e) => setVForm({ ...vForm, lang: e.target.value })}
        style={S.vInput}
      >
        {VENDOR_LANGS.map((l) => <option key={l.v} value={l.v}>{l.label}</option>)}
      </select>
      <input
        value={vForm.manager}
        onChange={(e) => setVForm({ ...vForm, manager: e.target.value })}
        onKeyDown={(e) => { if (e.key === 'Enter') saveVendor(); if (e.key === 'Escape') closeVForm(); }}
        placeholder="담당자 (선택)"
        style={S.vInput}
      />
      {vErr && <div style={S.vErr}>{vErr}</div>}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          style={{ ...S.btn('primary'), flex: 1, padding: '6px 0', opacity: vSaving ? 0.5 : 1 }}
          disabled={vSaving}
          onClick={saveVendor}
        >
          {vSaving ? '저장 중...' : '저장'}
        </button>
        <button
          style={{ ...S.btn('ghost'), flex: 1, padding: '6px 0' }}
          disabled={vSaving}
          onClick={closeVForm}
        >
          취소
        </button>
      </div>
      {vForm.mode === 'edit' && (
        <div style={S.vHint}>비활성화해도 대화 기록은 지워지지 않고 목록에서만 숨겨집니다.</div>
      )}
    </div>
  );

  /* ---------------- 파싱 ---------------- */
  const runParse = (text) => {
    if (!vendorId) { setLog('업체를 먼저 선택하세요.'); return; }
    if (!text.trim()) { setParsed(null); return; }
    try {
      const r = parseKakaoChat(text, { vendorId });
      setParsed(r);
      setLog(
        r.messages.length
          ? `파싱 완료 — ${r.format} 포맷, ${r.messages.length}건`
          : '파싱된 메시지가 없습니다. 카톡 "대화 내용 내보내기(텍스트)" 파일인지 확인하세요.'
      );
    } catch (e) {
      setParsed(null);
      setLog(`파싱 실패: ${e.message}`);
    }
  };

  const onFile = async (file) => {
    if (!file) return;
    const text = await file.text();
    setRaw(text);
    runParse(text);
  };

  /* ---------------- 기간 필터 ---------------- */
  const filtered = useMemo(() => {
    if (!parsed) return [];
    const f = from ? new Date(`${from}T00:00:00+09:00`).toISOString() : null;
    const t = to ? new Date(`${to}T23:59:59+09:00`).toISOString() : null;
    return parsed.messages.filter(
      (m) => (!f || m.sent_at >= f) && (!t || m.sent_at <= t)
    );
  }, [parsed, from, to]);

  /* ---------------- 저장 ---------------- */
  const save = async () => {
    if (!filtered.length) return;
    setSaving(true);
    setLog('저장 중...');
    try {
      const [imp] = await sbFetch('chat_imports', {
        method: 'POST',
        body: JSON.stringify({
          vendor_id: vendorId,
          source: 'file',
          filename: `${vendor?.name || ''}_${from}~${to}`,
          period_from: filtered[0].sent_at,
          period_to: filtered[filtered.length - 1].sent_at,
          message_count: filtered.length,
          status: 'parsed',
        }),
      });

      const rows = filtered.map((m) => ({ ...m, import_id: imp.id }));
      let ok = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        // msg_hash 중복은 조용히 건너뛴다 (재업로드 방지)
        await sbFetch('chat_messages?on_conflict=msg_hash', {
          method: 'POST',
          headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
          body: JSON.stringify(chunk),
        });
        ok += chunk.length;
        setLog(`저장 중... ${ok}/${rows.length}`);
      }
      setLog(`저장 완료 — ${rows.length}건 (중복은 자동 제외)`);
      setRaw('');
      setParsed(null);
    } catch (e) {
      setLog(`저장 실패: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  /* ---------------- 타임라인 ---------------- */
  const loadTimeline = async () => {
    if (!vendorId) return;
    setLoadingTl(true);
    const f = new Date(`${from}T00:00:00+09:00`).toISOString();
    const t = new Date(`${to}T23:59:59+09:00`).toISOString();
    try {
      const q = [
        'select=*',
        `vendor_id=eq.${encodeURIComponent(vendorId)}`,
        `sent_at=gte.${encodeURIComponent(f)}`,
        `sent_at=lte.${encodeURIComponent(t)}`,
        'order=sent_at.asc',
        'limit=2000',
      ].join('&');
      const data = await sbFetch(`chat_messages?${q}`);
      setTimeline(data || []);
    } catch (e) {
      setLog(`조회 오류: ${e.message}`);
    } finally {
      setLoadingTl(false);
    }
  };

  useEffect(() => {
    if (tab === 'timeline') loadTimeline();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, vendorId, from, to]);

  /* ---------------- 요약 ---------------- */
  const byPeriod = (a, b) => String(a.period_from).localeCompare(String(b.period_from));

  // 기간과 '겹치는' 요약을 가져온다(경계가 하루 어긋나도 놓치지 않게).
  const fetchSummaries = async () => {
    if (!vendorId) return [];
    setLoadingSum(true);
    setSumErr('');
    try {
      const q = [
        'select=*',
        `vendor_id=eq.${encodeURIComponent(vendorId)}`,
        'status=eq.done',
        `period_to=gte.${from}`,
        `period_from=lte.${to}`,
        'order=period_from.asc',
      ].join('&');
      return (await sbFetch(`chat_summaries?${q}`)) || [];
    } catch (e) {
      setSumErr(`요약 조회 오류: ${e.message}`);
      return null;
    } finally {
      setLoadingSum(false);
    }
  };

  const loadSummaries = async () => {
    const data = await fetchSummaries();
    if (data) setSummaries(data);
  };

  useEffect(() => {
    if (tab === 'summary' && !gen) loadSummaries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, vendorId, from, to]);

  // 월 단위로 쪼개서 한 번에 하나씩(병렬 금지) Edge Function 을 호출한다.
  // 어느 월을 다시 요약할지는 Edge Function 이 판단한다(skipped 플래그로 알려준다).
  const generate = async () => {
    if (!vendorId || gen) return;
    const chunks = monthChunks(from, to);
    if (!chunks.length) { setSumErr('기간을 확인하세요.'); return; }

    setSumErr('');
    setLogs([]);
    const out = [];
    const push = (key, kind, text) => { out.push({ key, kind, text }); setLogs([...out]); };

    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      setGen({ i: i + 1, total: chunks.length, label: c.label });

      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/hyper-api`, {
          method: 'POST',
          headers: sbHeaders,
          body: JSON.stringify({
            vendor_id: vendorId,
            period_from: new Date(`${c.from}T00:00:00+09:00`).toISOString(),
            period_to: new Date(`${c.to}T23:59:59+09:00`).toISOString(),
          }),
        });

        // 404 = 그 달에 메시지가 없다. 조용히 건너뛴다.
        if (r.status === 404) continue;

        const text = await r.text();
        if (!r.ok) throw new Error(`${r.status} ${(text || r.statusText).slice(0, 200)}`);
        const j = text ? JSON.parse(text) : null;
        if (!j?.ok) throw new Error(j?.error || '응답 형식 오류');

        // skipped=true → Claude 호출 없이 기존 요약을 그대로 돌려준 것
        const skipped = j.skipped === true;
        const body = j.summary && typeof j.summary === 'object' ? j.summary : null;
        const hasBody = body && Object.keys(body).length > 0;

        // 본문이 왔으면 한 달 끝날 때마다 바로 화면에 붙인다.
        // skipped 인데 본문을 안 돌려주는 경우엔 화면의 기존 카드를 지우지 않고 둔다
        // (루프가 끝나면 DB 를 정본으로 다시 읽는다).
        if (hasBody) {
          const row = {
            id: j.summary_id || `local-${c.key}`,
            vendor_id: vendorId,
            period_from: c.from,
            period_to: c.to,
            message_count: j.message_count ?? 0,
            summary_json: body,
            status: 'done',
          };
          setSummaries((prev) => [...prev.filter((s) => monthKeyOf(s) !== c.key), row].sort(byPeriod));
        }

        push(
          c.key,
          skipped ? 'same' : 'updated',
          skipped ? `${c.label} — 변경 없음` : `${c.label} — 요약 갱신 (${j.message_count ?? 0}건)`
        );
      } catch (e) {
        // 그 달만 실패로 표시하고 다음 달로 계속
        push(c.key, 'fail', `${c.label} 요약 실패 — ${e.message}`);
      }
    }

    setGen(null);

    // DB 를 정본으로 다시 읽되, 아직 DB 에 없는 월은 화면에 남겨둔다
    const fresh = await fetchSummaries();
    if (fresh) {
      const keys = new Set(fresh.map(monthKeyOf).filter(Boolean));
      setSummaries((prev) => [
        ...fresh,
        ...prev.filter((s) => String(s.id).startsWith('local-') && !keys.has(monthKeyOf(s))),
      ].sort(byPeriod));
    }
  };
  /* ---------------- 렌더 ---------------- */
  return (
    <div style={S.wrap}>
      {/* 좌측 업체 리스트 */}
      <div style={S.side}>
        <div style={S.sideHead}>생산 업체</div>
        <div style={S.sideList}>
          {vendors.map((v) => (
            vForm?.mode === 'edit' && vForm.id === v.id ? (
              <div key={v.id}>{renderVForm()}</div>
            ) : (
              <div
                key={v.id}
                style={S.vendorRow}
                onMouseEnter={() => setHoverId(v.id)}
                onMouseLeave={() => setHoverId(null)}
              >
                <button
                  style={S.vendorBtn(v.id === vendorId)}
                  onClick={() => { setVendorId(v.id); setParsed(null); setRaw(''); }}
                >
                  {v.name}
                  <span style={S.tag}>
                    {v.category}{v.lang !== 'ko' ? ` · ${v.lang.toUpperCase()}` : ''}
                  </span>
                </button>
                {(hoverId === v.id || menuId === v.id) && (
                  <button
                    style={S.dots}
                    title="업체 관리"
                    onClick={(e) => { e.stopPropagation(); setMenuId(menuId === v.id ? null : v.id); }}
                  >
                    ⋯
                  </button>
                )}
                {menuId === v.id && (
                  <div style={S.menuRow} onClick={(e) => e.stopPropagation()}>
                    <button style={S.menuItem} onClick={() => openEdit(v)}>수정</button>
                    <button style={S.menuItem} onClick={() => deactivateVendor(v)}>비활성화</button>
                  </div>
                )}
              </div>
            )
          ))}
          {!vendors.length && <div style={{ ...S.empty, padding: 20 }}>업체 없음</div>}
        </div>

        <div style={S.sideFoot}>
          {vForm?.mode === 'new'
            ? renderVForm()
            : <button style={S.addBtn} onClick={openNew}>+ 업체 등록</button>}
        </div>
      </div>

      {/* 우측 본문 */}
      <div style={S.main}>
        <div style={S.bar}>
          <strong style={{ fontSize: 15 }}>{vendor?.name || '업체 선택'}</strong>
          <span style={{ color: '#d1d5db' }}>|</span>
          <span style={{ fontSize: 12, color: '#6b7280' }}>기간</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={S.input} />
          <span style={{ color: '#9ca3af' }}>~</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={S.input} />
          <button
            style={S.btn('ghost')}
            onClick={() => { setFrom('2026-01-01'); setTo('2026-12-31'); }}
          >
            2026년
          </button>
          <div style={{ flex: 1 }} />
          {log && <span style={{ fontSize: 12, color: '#6b7280' }}>{log}</span>}
        </div>

        <div style={S.tabs}>
          <button style={S.tab(tab === 'summary')} onClick={() => setTab('summary')}>요약</button>
          <button style={S.tab(tab === 'import')} onClick={() => setTab('import')}>대화 불러오기</button>
          <button style={S.tab(tab === 'timeline')} onClick={() => setTab('timeline')}>원문 타임라인</button>
        </div>

        <div style={S.body}>
          {/* --- 요약 --- */}
          {tab === 'summary' && (
            <>
              <div style={{ ...S.bar, padding: '0 0 12px' }}>
                <button
                  style={{ ...S.btn('primary'), opacity: gen || !vendorId ? 0.5 : 1 }}
                  disabled={!!gen || !vendorId}
                  onClick={generate}
                >
                  {gen ? `${gen.i}/${gen.total} 처리 중 (${gen.label})` : '요약 업데이트'}
                </button>
                <span style={{ fontSize: 12, color: '#9ca3af' }}>
                  새로 추가된 대화만 요약합니다
                </span>
              </div>

              {sumErr && <div style={S.fail}>{sumErr}</div>}
              {logs.map((l) => (
                <div key={l.key} style={l.kind === 'fail' ? S.fail : l.kind === 'updated' ? S.noteOn : S.note}>
                  {l.text}
                </div>
              ))}

              {loadingSum && !gen && !summaries.length && <div style={S.empty}>불러오는 중...</div>}

              {summaries.map((row) => <SummaryCard key={row.id} row={row} />)}

              {!loadingSum && !gen && !summaries.length && (
                <div style={S.empty}>
                  저장된 요약이 없습니다.<br />
                  "요약 업데이트"를 누르면 기간을 월 단위로 나눠 한 달씩 차례로 요약합니다.
                </div>
              )}
            </>
          )}

          {/* --- 불러오기 --- */}
          {tab === 'import' && (
            <>
              <div style={S.card}>
                <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 14 }}>1. 카톡 대화 넣기</div>
                <input
                  type="file"
                  accept=".txt"
                  onChange={(e) => onFile(e.target.files?.[0])}
                  style={{ fontSize: 13, marginBottom: 10 }}
                />
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
                  카카오톡 → 대화방 → 메뉴 → 대화 내용 내보내기 → 텍스트만
                </div>
                <textarea
                  value={raw}
                  onChange={(e) => setRaw(e.target.value)}
                  onBlur={() => runParse(raw)}
                  placeholder="또는 대화를 직접 붙여넣고 이 영역 밖을 클릭하세요"
                  style={{
                    width: '100%', height: 110, padding: 10, fontSize: 12,
                    border: '1px solid #d1d5db', borderRadius: 6, fontFamily: 'monospace',
                    resize: 'vertical', boxSizing: 'border-box',
                  }}
                />
              </div>

              {parsed && (
                <>
                  <div style={S.card}>
                    <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>2. 파싱 결과 확인</div>
                    <div style={S.stat}>
                      <div><span style={S.statNum}>{parsed.messages.length}</span>전체 파싱</div>
                      <div><span style={S.statNum}>{filtered.length}</span>기간 내</div>
                      <div><span style={S.statNum}>{parsed.stats.attachment}</span>첨부</div>
                      <div><span style={S.statNum}>{parsed.stats.skipped}</span>제외</div>
                      <div><span style={S.statNum}>{parsed.format}</span>포맷</div>
                    </div>
                    {parsed.periodFrom && (
                      <div style={{ marginTop: 10, fontSize: 12, color: '#6b7280' }}>
                        원본 기간 {fmtKst(parsed.periodFrom.toISOString())} ~ {fmtKst(parsed.periodTo.toISOString())}
                      </div>
                    )}
                  </div>

                  <div style={S.card}>
                    <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 14 }}>
                      3. 미리보기 (기간 내 상위 20건)
                    </div>
                    {filtered.slice(0, 20).map((m, i) => (
                      <div key={i} style={S.msgRow}>
                        <div style={S.meta}>{fmtKst(m.sent_at)} · {m.sender}</div>
                        <div style={{ whiteSpace: 'pre-wrap' }}>
                          {m.has_attachment ? `📎 ${m.body_raw}` : m.body_raw}
                        </div>
                      </div>
                    ))}
                    {!filtered.length && <div style={S.empty}>해당 기간에 메시지가 없습니다.</div>}
                  </div>

                  <button
                    style={{ ...S.btn('primary'), opacity: saving || !filtered.length ? 0.5 : 1 }}
                    disabled={saving || !filtered.length}
                    onClick={save}
                  >
                    {saving ? '저장 중...' : `${filtered.length}건 저장`}
                  </button>
                </>
              )}
            </>
          )}

          {/* --- 타임라인 --- */}
          {tab === 'timeline' && (
            <>
              {loadingTl && <div style={S.empty}>불러오는 중...</div>}
              {!loadingTl && !timeline.length && (
                <div style={S.empty}>저장된 대화가 없습니다. "대화 불러오기"에서 먼저 등록하세요.</div>
              )}
              {timeline.map((m) => (
                <div key={m.id} style={S.msgRow}>
                  <div style={S.meta}>{fmtKst(m.sent_at)} · {m.sender}</div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>
                    {m.has_attachment ? `📎 ${m.body_raw}` : m.body_raw}
                  </div>
                  {m.body_ko && m.body_ko !== m.body_raw && (
                    <div style={{
                      marginTop: 4, padding: 8, background: '#f9fafb',
                      borderRadius: 6, color: '#4b5563',
                    }}>
                      {m.body_ko}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}