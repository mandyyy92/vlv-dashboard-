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

const FIXED_BY_KEY = 'stockcheck.fixedBy';

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

export default function StockCheckTab() {
  const [rows, setRows] = useState([]);
  const [logs, setLogs] = useState([]); // 최근 7일 stock_fix_log
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [checked, setChecked] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [fixedBy, setFixedBy] = useState(() => {
    try { return localStorage.getItem(FIXED_BY_KEY) || ''; } catch { return ''; }
  });
  const [toast, setToast] = useState(null); // {kind, text}
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
      const [neg, log] = await Promise.all([
        sbFetch('v_negative_stock?select=*&order=stock_qty.asc&limit=5000'),
        sbFetch(`stock_fix_log?select=*&fixed_at=gte.${encodeURIComponent(since)}&order=fixed_at.desc&limit=5000`),
      ]);
      setRows((neg || []).map((r) => ({ ...r, stock_qty: Number(r.stock_qty) || 0 })));
      setLogs(log || []);
      setChecked(new Set());
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

  const snapshotDate = rows[0]?.snapshot_date || '';
  const negSum = rows.reduce((s, r) => s + Math.abs(r.stock_qty), 0);

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return rows;
    return rows.filter((r) =>
      [r.product_name, r.product_code, r.barcode].some((v) => String(v || '').toLowerCase().includes(k)),
    );
  }, [rows, q]);

  // 전체 선택은 '보이는 행 중 아직 처리 안 된 행' 기준
  const selectable = filtered.filter((r) => !fixedToday.has(rowKey(r)));
  const allChecked = selectable.length > 0 && selectable.every((r) => checked.has(rowKey(r)));
  const toggleAll = () => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (allChecked) selectable.forEach((r) => next.delete(rowKey(r)));
      else selectable.forEach((r) => next.add(rowKey(r)));
      return next;
    });
  };
  const toggle = (key) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const downloadCsv = () => {
    const cell = (v) => {
      const s = String(v ?? '');
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [['바코드', '상품코드', '옵션', '현재재고', '변경재고']]
      .concat(filtered.map((r) => [r.barcode, r.product_code, r.option_name, r.stock_qty, 0]))
      .map((a) => a.map(cell).join(','));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `negative_stock_${(snapshotDate || today).replace(/-/g, '')}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('ok', `CSV ${filtered.length}건 저장`);
  };

  // 이지어드민 재고일괄조정 업로드용: 상품코드 / 작업수량(항상 0) / 메모(YYMMDD_마이너스재고조정)
  const downloadAdjustXlsx = async () => {
    try {
      const X = await loadXLSX();
      const memo = `${today.slice(2).replace(/-/g, '')}_마이너스재고조정`;
      const aoa = [['상품코드', '작업수량', '메모']]
        .concat(filtered.map((r) => [r.product_code, 0, memo]));
      const ws = X.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 24 }];
      const wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, ws, '재고일괄조정');
      X.writeFile(wb, `stock_adjust_${today.replace(/-/g, '')}.xlsx`);
      showToast('ok', `엑셀 ${filtered.length}건 저장`);
    } catch (e) {
      showToast('err', `엑셀 저장 실패: ${e.message || e}`);
    }
  };

  const recordFixed = async () => {
    const targets = rows.filter((r) => checked.has(rowKey(r)) && !fixedToday.has(rowKey(r)));
    if (!targets.length) return;
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
        fixed_by: fixedBy.trim() || null,
      }));
      const inserted = await sbFetch('stock_fix_log', { method: 'POST', body: JSON.stringify(payload) });
      setLogs((prev) => [...(inserted || payload), ...prev]);
      setChecked(new Set());
      showToast('ok', `${targets.length}건 기록됨`);
    } catch (e) {
      showToast('err', `기록 실패: ${e.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  const onFixedBy = (v) => {
    setFixedBy(v);
    try { localStorage.setItem(FIXED_BY_KEY, v); } catch { /* 저장 불가 환경은 무시 */ }
  };

  // 최근 7일(오늘 포함) 날짜별 처리 건수
  const history = useMemo(() => {
    const cnt = {};
    logs.forEach((l) => { if (l.fixed_at) { const d = kstDate(new Date(l.fixed_at)); cnt[d] = (cnt[d] || 0) + 1; } });
    return Array.from({ length: 7 }, (_, i) => { const d = addDays(today, -i); return { date: d, count: cnt[d] || 0 }; });
  }, [logs, today]);
  const histMax = Math.max(1, ...history.map((h) => h.count));

  const checkedCount = rows.filter((r) => checked.has(rowKey(r)) && !fixedToday.has(rowKey(r))).length;

  return (
    <div>
      {/* 1) 상단 요약 */}
      <div style={S.stats}>
        <div style={S.stat}>
          <div style={S.statLabel}>기준 스냅샷 일자</div>
          <div style={S.statValue()}>{loading ? '…' : snapshotDate || '-'}</div>
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

      {/* 2) 목록 · 3) CSV · 4) 처리 완료 기록 */}
      <div style={S.card}>
        <div style={{ ...S.bar, justifyContent: 'space-between' }}>
          <div>
            <h3 style={S.title}>🔻 마이너스 재고 옵션</h3>
            <div style={S.sub}>이지어드민 최신 스냅샷 기준 · 실제 보정은 이지어드민에서 진행하고, 끝나면 처리 완료로 기록하세요</div>
          </div>
          <button style={S.btn(false, loading)} disabled={loading} onClick={load}>새로고침</button>
        </div>
        <div style={S.bar}>
          <input
            style={{ ...S.input, flex: '1 1 240px' }}
            placeholder="상품명 · 상품코드 · 바코드 검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button style={S.btn(false, !filtered.length)} disabled={!filtered.length} onClick={downloadCsv}>CSV 다운로드</button>
          <button style={S.btn(false, !filtered.length)} disabled={!filtered.length} onClick={downloadAdjustXlsx}>재고일괄조정 엑셀</button>
          <input
            style={{ ...S.input, width: 110 }}
            placeholder="처리자 (선택)"
            value={fixedBy}
            onChange={(e) => onFixedBy(e.target.value)}
            aria-label="처리자"
          />
          <button style={S.btn(true, !checkedCount || saving)} disabled={!checkedCount || saving} onClick={recordFixed}>
            {saving ? '기록 중…' : `처리 완료로 기록${checkedCount ? ` (${checkedCount})` : ''}`}
          </button>
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
                  <th style={{ ...S.th, width: 36 }}>
                    <input type="checkbox" checked={allChecked} disabled={!selectable.length} onChange={toggleAll} aria-label="전체 선택" />
                  </th>
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
                    <tr key={key} style={{ opacity: done ? 0.45 : 1, background: checked.has(key) && !done ? '#eef2ff' : undefined }}>
                      <td style={S.td}>
                        <input type="checkbox" checked={!done && checked.has(key)} disabled={done} onChange={() => toggle(key)} aria-label="선택" />
                      </td>
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
      <div style={S.card}>
        <h3 style={S.title}>🗓 최근 7일 처리 이력</h3>
        <div style={{ ...S.sub, marginBottom: 12 }}>stock_fix_log 기준 · 날짜별 기록 건수</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {history.map((h) => (
            <div key={h.date} style={{ display: 'grid', gridTemplateColumns: '96px minmax(0,1fr) 48px', gap: 10, alignItems: 'center', fontSize: 13 }}>
              <span style={{ color: h.date === today ? '#0f172a' : '#64748b', fontWeight: h.date === today ? 700 : 500 }}>
                {h.date.slice(5).replace('-', '/')}{h.date === today ? ' (오늘)' : ''}
              </span>
              <div style={{ height: 10, background: '#f1f5f9', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ width: `${(h.count / histMax) * 100}%`, height: '100%', background: '#4f46e5', borderRadius: 99 }} />
              </div>
              <span style={{ textAlign: 'right', fontWeight: 600, color: h.count ? '#0f172a' : '#94a3b8' }}>{h.count}건</span>
            </div>
          ))}
        </div>
      </div>

      {toast && <div role="status" style={S.toast(toast.kind)}>{toast.text}</div>}
    </div>
  );
}
