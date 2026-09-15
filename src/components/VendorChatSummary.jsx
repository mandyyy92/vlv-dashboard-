// src/components/VendorChatSummary.jsx
// 업체 소통 요약 — 메뉴 컴포넌트 (v1: 업체 리스트 / 대화 불러오기 / 원문 타임라인)
import React, { useEffect, useMemo, useState } from 'react';
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
    background: '#fff', overflowY: 'auto',
  },
  sideHead: {
    padding: '12px 14px', fontSize: 12, fontWeight: 700, color: '#6b7280',
    borderBottom: '1px solid #f3f4f6',
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
};

const fmtKst = (iso) => {
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 16).replace('T', ' ');
};

export default function VendorChatSummary() {
  const [vendors, setVendors] = useState([]);
  const [vendorId, setVendorId] = useState(null);
  const [tab, setTab] = useState('import');

  // 기간 필터 — 기본값 2026년 전체
  const [from, setFrom] = useState('2026-01-01');
  const [to, setTo] = useState('2026-12-31');

  const [raw, setRaw] = useState('');
  const [parsed, setParsed] = useState(null);
  const [saving, setSaving] = useState(false);
  const [log, setLog] = useState('');

  const [timeline, setTimeline] = useState([]);
  const [loadingTl, setLoadingTl] = useState(false);

  const vendor = useMemo(
    () => vendors.find((v) => v.id === vendorId) || null,
    [vendors, vendorId]
  );

  /* ---------------- 업체 목록 ---------------- */
  useEffect(() => {
    (async () => {
      try {
        const data = await sbFetch('chat_vendors?select=*&is_active=eq.true&order=name.asc');
        setVendors(data || []);
        if (data?.length) setVendorId(data[0].id);
      } catch (e) {
        setLog(`업체 목록 오류: ${e.message}`);
      }
    })();
  }, []);

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

  /* ---------------- 렌더 ---------------- */
  return (
    <div style={S.wrap}>
      {/* 좌측 업체 리스트 */}
      <div style={S.side}>
        <div style={S.sideHead}>생산 업체</div>
        {vendors.map((v) => (
          <button
            key={v.id}
            style={S.vendorBtn(v.id === vendorId)}
            onClick={() => { setVendorId(v.id); setParsed(null); setRaw(''); }}
          >
            {v.name}
            <span style={S.tag}>
              {v.category}{v.lang !== 'ko' ? ` · ${v.lang.toUpperCase()}` : ''}
            </span>
          </button>
        ))}
        {!vendors.length && <div style={{ ...S.empty, padding: 20 }}>업체 없음</div>}
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
          <button style={S.tab(tab === 'import')} onClick={() => setTab('import')}>대화 불러오기</button>
          <button style={S.tab(tab === 'timeline')} onClick={() => setTab('timeline')}>원문 타임라인</button>
          <button style={S.tab(tab === 'summary')} onClick={() => setTab('summary')}>요약</button>
        </div>

        <div style={S.body}>
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

          {/* --- 요약 --- */}
          {tab === 'summary' && (
            <div style={S.empty}>
              요약 기능은 다음 단계에서 붙입니다.<br />
              먼저 "대화 불러오기"로 2026년 대화를 저장해 주세요.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}