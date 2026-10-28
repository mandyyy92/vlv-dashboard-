// src/components/StockCheckTab.jsx
// 재고 점검 — 이지어드민 마이너스 재고 옵션 확인 · 업로드용 CSV · 처리 이력(stock_fix_log)
// inventory(보호 테이블)는 직접 읽지 않고 v_negative_stock 뷰로만 읽는다.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SUPABASE_URL, sbHeaders } from '../lib/supabaseClient';

const REST = `${SUPABASE_URL}/rest/v1`;

async function sbFetch(path, init = {}) {
  const r = await fetch(`${REST}/${path}`, {
    ...init,
    headers: { ...sbHeaders, ...(init.headers || {}) },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text || r.statusText}`);
  return text ? JSON.parse(text) : null;
}

// KST 기준 날짜 문자열(YYYY-MM-DD). 처리 이력의 '오늘'·날짜별 집계는 모두 KST 로 맞춘다.
const kstDate = (d = new Date()) => new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
// KST 날짜의 00:00 을 UTC ISO 로 (fixed_at 범위 조회용)
const kstStartIso = (ymd) => new Date(`${ymd}T00:00:00+09:00`).toISOString();
const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
// 처리됨 판정 키: 바코드 우선, 없으면 상품코드+옵션
const rowKey = (r) => r.barcode || `${r.product_code}|${r.option_name}`;

// SheetJS(XLSX) CDN 동적 로드 — App.jsx loadWorkorderXLSX 와 같은 방식(의존성 추가 없음)
async function loadXLSX() {
  if (typeof window.XLSX === 'undefined') {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = res;
      s.onerror = () => rej(new Error('XLSX 로드 실패'));
      document.head.appendChild(s);
    });
  }
  return window.XLSX;
}

const S = {
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 16 },
  title: { fontSize: 15, fontWeight: 700, color: '#0f172a', margin: 0 },
  sub: { fontSize: 12, color: '#64748b', marginTop: 2 },
  stats: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12, marginBottom: 16 },
  stat: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '14px 16px' },
  statLabel: { fontSize: 12, color: '#64748b', fontWeight: 600 },
  statValue: (c) => ({ fontSize: 26, fontWeight: 800, color: c || '#0f172a', marginTop: 4, letterSpacing: -0.5 }),
  bar: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 },
  input: { fontSize: 13, padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 8, minWidth: 0 },
  btn: (primary, disabled) => ({
    fontSize: 13, padding: '7px 12px', borderRadius: 8, cursor: disabled ? 'not-allowed' : 'pointer',
    border: `1px solid ${primary ? '#4f46e5' : '#d1d5db'}`,
    background: primary ? '#4f46e5' : '#fff', color: primary ? '#fff' : '#111827',
    fontWeight: primary ? 600 : 500, opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap',
  }),
  tableWrap: { overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '9px 10px', background: '#f9fafb', color: '#475569', fontWeight: 600, borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' },
  td: { padding: '8px 10px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle' },
  mono: { fontFamily: 'ui-monospace,Menlo,Consolas,monospace', fontSize: 12 },
  badge: { display: 'inline-block', fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 99, background: '#dcfce7', color: '#15803d', marginLeft: 6 },
  msg: (kind) => ({
    fontSize: 13, fontWeight: 500,
    color: kind === 'ok' ? '#15803d' : kind === 'err' ? '#b91c1c' : '#64748b',
  }),
  toast: (kind) => ({
    position: 'fixed', right: 20, bottom: 20, zIndex: 50, padding: '10px 16px', borderRadius: 10,
    fontSize: 14, fontWeight: 600, boxShadow: '0 6px 20px rgba(15,23,42,.15)',
    background: kind === 'ok' ? '#15803d' : kind === 'err' ? '#b91c1c' : '#475569', color: '#fff',
  }),
  empty: { textAlign: 'center', padding: 40, color: '#94a3b8' },
};

// 바코드 17자리 규칙 — 자리(0-based) 별 허용 패턴. supabase/barcode_check.sql 과 같은 규칙
const BARCODE_RULES = [
  [0, 1, /^V$/, '브랜드'], [1, 3, /^[0-9]{2}$/, '년도'], [3, 4, /^[PSFWA]$/, '시즌'], [4, 5, /^[A-Z]$/, '복종'],
  [5, 7, /^[0-9]{2}$/, '품번'], [7, 8, /^[UWM]$/, '성별'], [8, 9, /^[BCAP]$/, '타입'], [9, 17, /^[0-9A-Z]+$/, '아트웍·옵션'],
];
// 규칙에 어긋난 자리(0-based) 집합 — 17자리일 때만 자리별로 표시
const badBarcodePositions = (b) => {
  const bad = new Set();
  if (!b || b.length !== 17) return bad;
  BARCODE_RULES.forEach(([s, e, re]) => { if (!re.test(b.slice(s, e))) for (let i = s; i < e; i++) bad.add(i); });
  return bad;
};

function BarcodeCheckSection() {
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null); // {snapshot_date, checked_count}
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [level, setLevel] = useState('error'); // error | legacy | all
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [list, sum] = await Promise.all([
        sbFetch('v_barcode_check?select=*&order=level.asc,product_code.asc&limit=5000'),
        sbFetch('v_barcode_check_summary?select=*&limit=1').catch(() => null),
      ]);
      setItems(list || []);
      setSummary(sum?.[0] || null);
    } catch (e) {
      setError(String(e.message || e).includes('v_barcode_check')
        ? '검수 뷰가 아직 없습니다 — supabase/barcode_check.sql 을 실행해주세요'
        : e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const errCount = items.filter((r) => r.level === 'error').length;
  const legacyCount = items.length - errCount;
  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return items.filter((r) => (level === 'all' || r.level === level)
      && (!kw || [r.product_code, r.product_name, r.option_name, r.barcode].some((v) => String(v || '').toLowerCase().includes(kw))));
  }, [items, level, q]);

  const chip = (key, label, n, color) => (
    <button key={key} onClick={() => setLevel(key)}
      style={{ ...S.btn(false, false), borderColor: level === key ? color : '#d1d5db', color: level === key ? color : '#475569', fontWeight: level === key ? 700 : 500 }}>
      {label} {n.toLocaleString()}
    </button>
  );

  return (
    <div style={S.card}>
      <div style={{ ...S.bar, justifyContent: 'space-between' }}>
        <h3 style={S.title}>🔍 바코드 검수</h3>
        <span style={{ fontSize: 12, color: '#64748b' }}>
          {summary ? <>{summary.snapshot_date} 스냅샷 · {Number(summary.checked_count || 0).toLocaleString()}개 옵션 검사</> : ''}
        </span>
      </div>

      {!loading && !error && (
        <div style={{ ...S.msg(errCount ? 'err' : 'ok'), marginBottom: 12, fontWeight: 600 }}>
          {errCount ? `규칙에 맞지 않는 바코드 ${errCount.toLocaleString()}건` : '모든 바코드가 17자리 규칙에 맞습니다 ✅'}
        </div>
      )}

      <div style={S.bar}>
        {chip('error', '오류', errCount, '#b91c1c')}
        {chip('legacy', '구형 단축', legacyCount, '#64748b')}
        {chip('all', '전체', items.length, '#4f46e5')}
        <input style={{ ...S.input, flex: '1 1 220px' }} placeholder="상품명 · 상품코드 · 바코드 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <button style={S.btn(false, loading)} disabled={loading} onClick={load}>새로고침</button>
      </div>

      {error ? (
        <div style={{ ...S.empty, color: '#b91c1c' }}>{error}</div>
      ) : loading ? (
        <div style={S.empty}>⏳ 불러오는 중...</div>
      ) : !shown.length ? (
        <div style={S.empty}>{level === 'error' ? '오류 바코드가 없습니다 🎉' : '표시할 항목이 없습니다'}</div>
      ) : (
        <div style={{ ...S.tableWrap, maxHeight: 480, overflowY: 'auto' }}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>상품코드</th><th style={S.th}>상품명</th><th style={S.th}>옵션</th>
                <th style={S.th}>바코드</th><th style={S.th}>자릿수</th><th style={S.th}>사유</th><th style={S.th}>출처</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const bc = String(r.barcode || '');
                const bad = badBarcodePositions(bc);
                return (
                  <tr key={`${r.product_code}|${r.option_name}|${i}`}>
                    <td style={{ ...S.td, ...S.mono }}>{r.product_code}</td>
                    <td style={S.td}>{r.product_name}</td>
                    <td style={S.td}>{r.option_name}</td>
                    <td style={{ ...S.td, ...S.mono, whiteSpace: 'pre' }}>
                      {bc ? [...bc].map((c, k) => (
                        <span key={k} style={bad.has(k) ? { color: '#dc2626', fontWeight: 800, background: '#fee2e2' } : undefined}>{c}</span>
                      )) : <span style={{ color: '#94a3b8' }}>(없음)</span>}
                    </td>
                    <td style={{ ...S.td, textAlign: 'right', color: bc.length === 17 ? '#64748b' : '#dc2626', fontWeight: 600 }}>{bc.length}</td>
                    <td style={{ ...S.td, color: r.level === 'error' ? '#b91c1c' : '#64748b' }}>{r.issue}</td>
                    <td style={{ ...S.td, color: '#64748b', whiteSpace: 'nowrap' }}>{r.source === 'inventory_artwork' ? '아트웍' : '기본'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ ...S.msg('neutral'), marginTop: 8, fontSize: 12 }}>
        규칙: 1 V · 2-3 년도 · 4 시즌(P/S/F/W/A) · 5 복종 · 6-7 품번 · 8 성별(U/W/M) · 9 타입(B/C/A/P) · 10-17 영문 대문자·숫자
      </div>
    </div>
  );
}

export default function StockCheckTab() {
  const [rows, setRows] = useState([]);
  const [logs, setLogs] = useState([]); // 최근 7일 stock_fix_log
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null); // {kind, text}
  const [snapInfo, setSnapInfo] = useState(null); // v_inventory_snapshot_info {snapshot_date, collected_at}
  const [openDate, setOpenDate] = useState(null); // 처리 이력에서 펼친 날짜
  const toastTimer = useRef(null);

  const today = kstDate();

  const showToast = useCallback((kind, text) => {
    clearTimeout(toastTimer.current);
    setToast({ kind, text });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const since = kstStartIso(addDays(kstDate(), -6));
      const [neg, log, info] = await Promise.all([
        sbFetch('v_negative_stock?select=*&order=stock_qty.asc&limit=5000'),
        sbFetch(`stock_fix_log?select=*&fixed_at=gte.${encodeURIComponent(since)}&order=fixed_at.desc&limit=5000`),
        // 수집 시각 뷰는 선택 사항 — 없거나 실패해도 나머지 화면은 그대로 보여준다
        sbFetch('v_inventory_snapshot_info?select=*&limit=1').catch(() => null),
      ]);
      setRows((neg || []).map((r) => ({ ...r, stock_qty: Number(r.stock_qty) || 0 })));
      setLogs(log || []);
      setSnapInfo(info?.[0] || null);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const todayLogs = useMemo(
    () => logs.filter((l) => l.fixed_at && kstDate(new Date(l.fixed_at)) === today),
    [logs, today],
  );
  const fixedToday = useMemo(() => new Set(todayLogs.map(rowKey)), [todayLogs]);

  // 여러 재고 테이블을 합쳐 보므로 기준일은 수집 시각 뷰(가장 최신 스냅샷) 우선
  const snapshotDate = snapInfo?.snapshot_date || rows[0]?.snapshot_date || '';
  const negSum = rows.reduce((s, r) => s + Math.abs(r.stock_qty), 0);
  // 수집 시각(KST). 스냅샷 일자와 날짜가 같으면 시:분만, 다르면 MM/DD 시:분
  const collectedLabel = useMemo(() => {
    if (!snapInfo?.collected_at) return '';
    const t = new Date(snapInfo.collected_at);
    if (Number.isNaN(t.getTime())) return '';
    const k = new Date(t.getTime() + 9 * 3600 * 1000).toISOString();
    const hm = k.slice(11, 16);
    const day = k.slice(0, 10);
    return day === (snapshotDate || snapInfo.snapshot_date) ? hm : `${day.slice(5).replace('-', '/')} ${hm}`;
  }, [snapInfo, snapshotDate]);

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return rows;
    return rows.filter((r) =>
      [r.product_name, r.product_code, r.barcode].some((v) => String(v || '').toLowerCase().includes(k)),
    );
  }, [rows, q]);

  // 이지어드민 재고일괄조정 업로드용: 상품코드 / 작업수량 / 메모(YYMMDD_마이너스재고조정)
  // 이지어드민은 재고를 0으로 맞출 때 작업수량에 숫자 0 대신 'zero' 를 넣어야 한다(0은 무시됨)
  const downloadAdjustXlsx = async () => {
    try {
      const X = await loadXLSX();
      // 화면을 밤새 켜둬도 누른 시점의 날짜(KST)가 들어가도록 클릭 때 다시 계산
      const day = kstDate();
      const memo = `${day.slice(2).replace(/-/g, '')}_마이너스재고조정`;
      const aoa = [['상품코드', '작업수량', '메모']]
        .concat(filtered.map((r) => [r.product_code, 'zero', memo]));
      const ws = X.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 24 }];
      const wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, ws, '재고일괄조정');
      X.writeFile(wb, `stock_adjust_${day.replace(/-/g, '')}.xlsx`);
    } catch (e) {
      showToast('err', `엑셀 저장 실패: ${e.message || e}`);
      return;
    }
    // 내려받은 목록은 자동으로 처리 완료 기록 (오늘 이미 기록된 행은 제외)
    const targets = filtered.filter((r) => !fixedToday.has(rowKey(r)));
    if (!targets.length) { showToast('ok', `엑셀 ${filtered.length}건 저장 · 모두 이미 처리됨`); return; }
    try {
      await insertLogs(targets);
      showToast('ok', `엑셀 ${filtered.length}건 저장 · ${targets.length}건 기록됨`);
    } catch (e) {
      showToast('err', `엑셀은 저장됐지만 기록 실패: ${e.message || e}`);
    }
  };

  // stock_fix_log insert (before_qty = 현재재고, after_qty = 0)
  const insertLogs = async (targets) => {
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const payload = targets.map((r) => ({
        snapshot_date: r.snapshot_date,
        product_code: r.product_code,
        option_name: r.option_name,
        barcode: r.barcode,
        before_qty: r.stock_qty,
        after_qty: 0,
        fixed_at: now,
      }));
      const inserted = await sbFetch('stock_fix_log', { method: 'POST', body: JSON.stringify(payload) });
      setLogs((prev) => [...(inserted || payload), ...prev]);
    } finally {
      setSaving(false);
    }
  };

  // 최근 7일(오늘 포함) 날짜별 처리 건수
  const history = useMemo(() => {
    const byDate = {};
    logs.forEach((l) => { if (l.fixed_at) { const d = kstDate(new Date(l.fixed_at)); (byDate[d] = byDate[d] || []).push(l); } });
    return Array.from({ length: 7 }, (_, i) => { const d = addDays(today, -i); const items = byDate[d] || []; return { date: d, count: items.length, items }; });
  }, [logs, today]);
  const histMax = Math.max(1, ...history.map((h) => h.count));

  return (
    <div>
      {/* 1) 상단 요약 */}
      <div style={S.stats}>
        <div style={S.stat}>
          <div style={S.statLabel}>기준 스냅샷 일자</div>
          <div style={S.statValue()}>{loading ? '…' : snapshotDate || snapInfo?.snapshot_date || '-'}</div>
          {!loading && collectedLabel && (
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
              <b style={{ color: '#334155' }}>{collectedLabel} 수집</b> · 이후 변동은 다음 스냅샷에 반영
            </div>
          )}
        </div>
        <div style={S.stat}>
          <div style={S.statLabel}>마이너스 옵션 수</div>
          <div style={S.statValue('#b91c1c')}>{loading ? '…' : rows.length.toLocaleString()}<span style={{ fontSize: 14, fontWeight: 500, marginLeft: 3 }}>개</span></div>
        </div>
        <div style={S.stat}>
          <div style={S.statLabel}>마이너스 수량 합계</div>
          <div style={S.statValue('#b91c1c')}>{loading ? '…' : negSum.toLocaleString()}<span style={{ fontSize: 14, fontWeight: 500, marginLeft: 3 }}>개</span></div>
        </div>
        <div style={S.stat}>
          <div style={S.statLabel}>오늘 처리한 건수</div>
          <div style={S.statValue('#15803d')}>{loading ? '…' : todayLogs.length.toLocaleString()}<span style={{ fontSize: 14, fontWeight: 500, marginLeft: 3 }}>건</span></div>
        </div>
      </div>

      {/* 2단 — 왼쪽: 마이너스 목록 / 오른쪽: 처리 이력 (좁은 화면에서는 위아래로) */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start', marginBottom: 16 }}>
      {/* 2) 목록 · 3) 재고일괄조정 엑셀(다운로드 시 자동 처리 기록) */}
      <div style={{ ...S.card, flex: '3 1 560px', minWidth: 0, marginBottom: 0 }}>
        <div style={S.bar}>
          <h3 style={S.title}>🔻 마이너스 재고 옵션</h3>
        </div>
        <div style={S.bar}>
          <input
            style={{ ...S.input, flex: '1 1 240px' }}
            placeholder="상품명 · 상품코드 · 바코드 검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button style={S.btn(true, !filtered.length || saving)} disabled={!filtered.length || saving} onClick={downloadAdjustXlsx}>
            {saving ? '기록 중…' : '재고일괄조정 엑셀'}
          </button>
          <button style={S.btn(false, loading)} disabled={loading} onClick={load}>새로고침</button>
        </div>

        {error ? (
          <div style={{ ...S.empty, color: '#b91c1c' }}>불러오지 못했습니다: {error}</div>
        ) : loading ? (
          <div style={S.empty}>⏳ 불러오는 중...</div>
        ) : !rows.length ? (
          <div style={S.empty}>마이너스 재고 옵션이 없습니다 🎉</div>
        ) : !filtered.length ? (
          <div style={S.empty}>검색 조건에 맞는 옵션이 없습니다</div>
        ) : (
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>상품코드</th>
                  <th style={S.th}>상품명</th>
                  <th style={S.th}>옵션</th>
                  <th style={S.th}>바코드</th>
                  <th style={S.th}>로케이션</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>현재재고</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const key = rowKey(r);
                  const done = fixedToday.has(key);
                  return (
                    <tr key={key} style={{ opacity: done ? 0.45 : 1 }}>
                      <td style={{ ...S.td, ...S.mono }}>{r.product_code}</td>
                      <td style={S.td}>
                        {r.product_name}
                        {done && <span style={S.badge}>처리됨</span>}
                      </td>
                      <td style={S.td}>{r.option_name}</td>
                      <td style={{ ...S.td, ...S.mono }}>{r.barcode}</td>
                      <td style={S.td}>{r.location}</td>
                      <td style={{ ...S.td, textAlign: 'right', color: '#dc2626', fontWeight: 700 }}>{r.stock_qty.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && !error && rows.length > 0 && (
          <div style={{ ...S.msg('neutral'), marginTop: 8, fontSize: 12 }}>
            {filtered.length.toLocaleString()}개 표시 · 오늘 처리됨 {filtered.filter((r) => fixedToday.has(rowKey(r))).length}개
          </div>
        )}
      </div>

      {/* 5) 최근 7일 처리 이력 */}
      <div style={{ ...S.card, flex: '2 1 380px', minWidth: 0, marginBottom: 0 }}>
        <h3 style={{ ...S.title, marginBottom: 12 }}>🗓 최근 7일 처리 이력</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {history.map((h) => {
            const open = openDate === h.date;
            return (
            <div key={h.date}>
              <div onClick={() => h.count && setOpenDate(open ? null : h.date)}
                style={{ display: 'grid', gridTemplateColumns: '14px 84px minmax(0,1fr) 44px', gap: 10, alignItems: 'center', fontSize: 13, cursor: h.count ? 'pointer' : 'default' }}>
                <span style={{ fontSize: 10, color: '#94a3b8' }}>{h.count ? (open ? '▾' : '▸') : ''}</span>
                <span style={{ color: h.date === today ? '#0f172a' : '#64748b', fontWeight: h.date === today ? 700 : 500 }}>
                  {h.date.slice(5).replace('-', '/')}{h.date === today ? ' (오늘)' : ''}
                </span>
                <div style={{ height: 10, background: '#f1f5f9', borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{ width: `${(h.count / histMax) * 100}%`, height: '100%', background: '#4f46e5', borderRadius: 99 }} />
                </div>
                <span style={{ textAlign: 'right', fontWeight: 600, color: h.count ? '#0f172a' : '#94a3b8' }}>{h.count}건</span>
              </div>
              {open && (
                <div style={{ ...S.tableWrap, margin: '8px 0 6px 24px', maxHeight: 320, overflowY: 'auto', maxWidth: 'calc(100% - 24px)' }}>
                  <table style={S.table}>
                    <thead>
                      <tr>
                        <th style={S.th}>상품코드</th><th style={S.th}>옵션</th><th style={S.th}>바코드</th>
                        <th style={{ ...S.th, textAlign: 'right' }}>조정 전</th><th style={{ ...S.th, textAlign: 'right' }}>조정 후</th><th style={S.th}>시각</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...h.items].sort((a, b) => String(a.product_code).localeCompare(String(b.product_code))).map((l) => (
                        <tr key={l.id}>
                          <td style={{ ...S.td, ...S.mono }}>{l.product_code}</td>
                          <td style={S.td}>{l.option_name || '-'}</td>
                          <td style={{ ...S.td, ...S.mono, color: '#64748b' }}>{l.barcode || '-'}</td>
                          <td style={{ ...S.td, textAlign: 'right', color: '#dc2626', fontWeight: 600 }}>{l.before_qty}</td>
                          <td style={{ ...S.td, textAlign: 'right' }}>{l.after_qty}</td>
                          <td style={{ ...S.td, color: '#64748b', whiteSpace: 'nowrap' }}>
                            {new Date(l.fixed_at).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            );
          })}
        </div>
      </div>

      </div>

      {/* 6) 바코드 검수 — 최신 스냅샷 기준, 매일 갱신 */}
      <BarcodeCheckSection />

      {toast && <div role="status" style={S.toast(toast.kind)}>{toast.text}</div>}
    </div>
  );
}
