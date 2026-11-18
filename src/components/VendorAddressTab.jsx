// src/components/VendorAddressTab.jsx
// 입고 캘린더 › 업체 주소 — 거래처 발송 주소·연락처·담당자 (Supabase vendor_addresses, supabase/vendor_addresses.sql)
// 검색(업체명·구분·주소·연락처·담당자·메모) + 주소/연락처 복사 + 추가·수정·삭제(삭제는 2단계 확인)
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SUPABASE_URL, sbHeaders } from '../lib/supabaseClient';

const REST = `${SUPABASE_URL}/rest/v1/vendor_addresses`;
const EMPTY = { category: '', name: '', address: '', phone: '', contact: '', memo: '' };
const FIELDS = [
  ['category', '구분', 'input'],
  ['name', '업체명', 'input'],
  ['address', '주소', 'textarea'],
  ['phone', '연락처', 'textarea'],
  ['contact', '담당자', 'input'],
  ['memo', '메모', 'textarea'],
];
// 구분별 색 — 같은 계열은 같은 색
const catColor = (c) => {
  const s = String(c || '');
  if (/전사/.test(s)) return ['#EEF2FF', '#4338CA'];
  if (/나염/.test(s)) return ['#FDF2F8', '#BE185D'];
  if (/생산|공장|다이마루|데님|니트|프로모션|패턴|워싱/.test(s)) return ['#ECFDF5', '#047857'];
  if (/모자|가방|머플러|비니/.test(s)) return ['#FFF7ED', '#C2410C'];
  if (/부자재|라벨/.test(s)) return ['#FEFCE8', '#A16207'];
  if (/센터|포워딩|검품|촬영/.test(s)) return ['#F0F9FF', '#0369A1'];
  return ['#F1F5F9', '#475569'];
};
const lines = (v) => String(v || '').split('\n').map((x) => x.trim()).filter(Boolean);

export default function VendorAddressTab() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);     // {id|null, ...fields}
  const [saving, setSaving] = useState(false);
  const [delArm, setDelArm] = useState(null);
  const [msg, setMsg] = useState(null);
  const msgTimer = useRef(null);
  const delTimer = useRef(null);
  useEffect(() => () => { clearTimeout(msgTimer.current); clearTimeout(delTimer.current); }, []);
  const flash = (kind, text) => { clearTimeout(msgTimer.current); setMsg({ kind, text }); msgTimer.current = setTimeout(() => setMsg(null), 3000); };

  // 업체 추가 팝업: Esc 로 닫기
  useEffect(() => {
    if (!edit || edit.id) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setEdit(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [edit]);

  const load = async () => {
    try {
      const r = await fetch(`${REST}?select=*&order=sort_order.asc,id.asc`, { headers: sbHeaders });
      if (!r.ok) throw new Error(r.status === 404 ? 'vendor_addresses 테이블이 없습니다 — supabase/vendor_addresses.sql 을 실행해주세요' : `불러오기 실패 (${r.status})`);
      setRows(await r.json());
      setErr('');
    } catch (e) {
      setErr(e.message || String(e));
      setRows([]);
    }
  };
  useEffect(() => { load(); }, []);


  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const digits = q.replace(/\D/g, '');
    return (rows || []).filter((r) => {
      if (!words.length) return true;
      const hay = [r.category, r.name, r.address, r.phone, r.contact, r.memo].join(' ').toLowerCase();
      const phoneDigits = String(r.phone || '').replace(/\D/g, '');
      return words.every((w) => hay.includes(w)) || (digits.length >= 3 && phoneDigits.includes(digits));
    });
  }, [rows, q]);

  const copy = async (text, label) => {
    try { await navigator.clipboard.writeText(text); flash('ok', `${label} 복사됨`); }
    catch (e) { flash('err', '복사하지 못했습니다'); }
  };

  const save = async () => {
    if (!edit) return;
    const body = Object.fromEntries(FIELDS.map(([k]) => [k, String(edit[k] || '').trim()]));
    if (!body.name) { flash('err', '업체명을 입력해주세요'); return; }
    setSaving(true);
    try {
      const isNew = !edit.id;
      const r = await fetch(isNew ? REST : `${REST}?id=eq.${edit.id}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { ...sbHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(isNew ? { ...body, sort_order: (rows || []).reduce((a, x) => Math.max(a, x.sort_order || 0), 0) + 1 } : { ...body, updated_at: new Date().toISOString() }),
      });
      if (!r.ok) throw new Error(String(r.status));
      flash('ok', `${body.name} ${isNew ? '추가' : '수정'}됨`);
      setEdit(null);
      await load();
    } catch (e) {
      flash('err', '저장 실패 — 다시 시도해주세요');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r) => {
    if (delArm !== r.id) {
      setDelArm(r.id);
      clearTimeout(delTimer.current);
      delTimer.current = setTimeout(() => setDelArm(null), 3000);
      return;
    }
    setDelArm(null);
    try {
      const res = await fetch(`${REST}?id=eq.${r.id}`, { method: 'DELETE', headers: sbHeaders });
      if (!res.ok) throw new Error(String(res.status));
      flash('neutral', `${r.name} 삭제됨`);
      await load();
    } catch (e) {
      flash('err', '삭제 실패 — 다시 시도해주세요');
    }
  };

  const pill = (on) => ({
    padding: '6px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
    border: `1px solid ${on ? '#4F46E5' : '#E2E8F0'}`, background: on ? '#4F46E5' : '#FFF', color: on ? '#FFF' : '#334155',
  });
  const smallBtn = { fontSize: 11.5, padding: '3px 8px', borderRadius: 6, border: '1px solid #E2E8F0', background: '#FFF', color: '#475569', cursor: 'pointer', whiteSpace: 'nowrap' };
  const msgColor = msg ? (msg.kind === 'ok' ? '#15803D' : msg.kind === 'err' ? '#B91C1C' : '#64748B') : '';

  // 입력 칸 — compact: 카드 안 수정(한 줄에 하나), 아니면 위쪽 '업체 추가' 박스(여러 칸)
  const editor = (compact) => edit && (
    <div style={compact ? { display: 'flex', flexDirection: 'column', gap: 8 } : { padding: 20 }}>
      {!compact && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#1E293B' }}>업체 추가</div>
          <button type="button" onClick={() => setEdit(null)} aria-label="닫기" style={{ border: 'none', background: 'none', fontSize: 20, color: '#94A3B8', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
      )}
      <div style={compact ? { display: 'flex', flexDirection: 'column', gap: 8 } : { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
        {FIELDS.map(([k, label, kind]) => (
          <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, color: '#475569' }}>
            <span>{label}{k === 'name' && <span style={{ color: '#DC2626' }}> *</span>}</span>
            {kind === 'textarea'
              ? <textarea rows={k === 'memo' ? 2 : 3} value={edit[k] || ''} onChange={(e) => setEdit((p) => ({ ...p, [k]: e.target.value }))} placeholder={k === 'address' || k === 'phone' ? '여러 개면 줄바꿈' : ''}
                  style={{ fontSize: 13, padding: '7px 9px', border: '1px solid #CBD5E1', borderRadius: 8, resize: 'vertical', fontFamily: 'inherit' }} />
              : <input value={edit[k] || ''} onChange={(e) => setEdit((p) => ({ ...p, [k]: e.target.value }))}
                  style={{ fontSize: 13, padding: '7px 9px', border: '1px solid #CBD5E1', borderRadius: 8 }} />}
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: compact ? 2 : 12 }}>
        <button type="button" onClick={() => setEdit(null)} style={{ ...smallBtn, fontSize: 13, padding: '7px 14px' }}>취소</button>
        <button type="button" onClick={save} disabled={saving}
          style={{ fontSize: 13, padding: '7px 16px', borderRadius: 8, border: 'none', background: '#4F46E5', color: '#FFF', fontWeight: 700, cursor: saving ? 'wait' : 'pointer' }}>
          {saving ? '저장 중…' : '저장'}
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ background: '#FFF', border: '1px solid #E5E7EB', borderRadius: 14, padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#0F172A' }}>📍 업체 주소</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {msg && <span style={{ fontSize: 13, fontWeight: 600, color: msgColor }}>{msg.text}</span>}
          <button type="button" onClick={() => setEdit({ ...EMPTY })}
            style={{ fontSize: 13, padding: '7px 14px', borderRadius: 8, border: 'none', background: '#4F46E5', color: '#FFF', fontWeight: 700, cursor: 'pointer' }}>+ 업체 추가</button>
        </div>
      </div>

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="검색"
        style={{ width: '100%', boxSizing: 'border-box', fontSize: 15, padding: '11px 14px', border: '1.5px solid #CBD5E1', borderRadius: 10, marginBottom: 10 }} />

      {edit && !edit.id && (
        // 업체 추가 팝업 — 바깥(어두운 영역) 클릭 또는 Esc 로 닫기
        <div onClick={() => setEdit(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(720px, 100%)', maxHeight: '90vh', overflowY: 'auto', background: '#FFF', borderRadius: 14, boxShadow: '0 20px 50px rgba(15,23,42,0.25)' }}>
            {editor(false)}
          </div>
        </div>
      )}
      {err && <div style={{ color: '#B91C1C', fontSize: 13, fontWeight: 600, padding: '10px 0' }}>{err}</div>}
      {!rows && <div style={{ textAlign: 'center', padding: 40, color: '#94A3B8' }}>⏳ 불러오는 중…</div>}
      {rows && !err && shown.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: '#94A3B8' }}>{rows.length ? '검색 결과가 없습니다' : '등록된 업체가 없습니다 · “+ 업체 추가”'}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
        {shown.map((r) => {
          const [bg, fg] = catColor(r.category);
          return (
            edit?.id === r.id ? (
              <div key={r.id} style={{ border: '1.5px solid #818CF8', borderRadius: 12, padding: 14, background: '#F8FAFF', boxShadow: '0 0 0 3px #EEF2FF' }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#4338CA', marginBottom: 8 }}>✏️ {r.name} 수정</div>
                {editor(true)}
              </div>
            ) : (
            <div key={r.id} style={{ border: '1px solid #E2E8F0', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 9, background: '#FFF' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  {r.category && <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, color: fg, background: bg, borderRadius: 6, padding: '2px 8px', marginBottom: 5 }}>{r.category}</span>}
                  <div style={{ fontSize: 15.5, fontWeight: 800, color: '#0F172A', wordBreak: 'keep-all' }}>{r.name}</div>
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button type="button" style={smallBtn} onClick={() => setEdit({ ...r })}>수정</button>
                  <button type="button" onClick={() => remove(r)}
                    style={{ ...smallBtn, ...(delArm === r.id ? { background: '#DC2626', borderColor: '#DC2626', color: '#FFF', fontWeight: 700 } : { color: '#B91C1C' }) }}>
                    {delArm === r.id ? '한 번 더' : '삭제'}
                  </button>
                </div>
              </div>
              {lines(r.address).length > 0 && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 13, flexShrink: 0 }}>📦</span>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {lines(r.address).map((a, i) => (
                      <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                        <span style={{ flex: 1, fontSize: 13, color: '#1E293B', lineHeight: 1.5, wordBreak: 'keep-all' }}>{a.replace(/^-\s*/, '')}</span>
                        <button type="button" style={smallBtn} onClick={() => copy(a.replace(/^-\s*/, ''), '주소')}>복사</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {lines(r.phone).length > 0 && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 13, flexShrink: 0 }}>📞</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {lines(r.phone).map((p, i) => (
                      <button key={i} type="button" onClick={() => copy(p.replace(/^[^:]*:\s*/, ''), '연락처')} title="눌러서 복사"
                        style={{ fontSize: 13, fontWeight: 600, color: '#1D4ED8', background: '#EFF6FF', border: '1px solid #DBEAFE', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontFamily: 'ui-monospace,Menlo,Consolas,monospace' }}>
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {lines(r.contact).length > 0 && (
                <div style={{ display: 'flex', gap: 8, fontSize: 13, color: '#334155' }}>
                  <span style={{ flexShrink: 0 }}>👤</span><span>{lines(r.contact).join(' · ')}</span>
                </div>
              )}
              {r.memo && (
                <div style={{ fontSize: 12, color: '#92400E', background: '#FFFBEB', borderRadius: 6, padding: '5px 8px', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{r.memo}</div>
              )}
            </div>
            )
          );
        })}
      </div>
    </div>
  );
}
