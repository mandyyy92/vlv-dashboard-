// src/components/BaseExtraShipTab.jsx
// 프린팅 외주 › 베이스 추가 출고 — 나염 차수 엑셀로 이지어드민 '베이스출고(추가)' 파일 생성
//  1) 02_나염 폴더(또는 업체 입고 폴더)를 한 번 불러오기 — 브라우저 안에서만 읽음, 폴더 연결 권한 불필요(오랩 화면 안에서도 동작)
//  2) 차수 검색 → 하나 고르기: 그 차수 폴더의 {N}차_베이스출고_*.xlsx('(추가' 제외) + {N}차_정상입고_*.xlsx(_1·_2 합산)만 읽음
//  3) 추가 출고 = 베이스출고 − 정상입고 − 업체 보고 불량 (음수도 그대로 · 5차 코스타 파일과 같은 규칙) → 모두 0 이면 파일 안 만듦
//  4) 엑셀 다운로드: {N}차_베이스출고(추가)_{업체}.xlsx — 상품코드 | 수량 | 메모 | 상품명 | 옵션 (메모: 오늘_센터출고_업체_N차(추가))
// 입고 상품 → 베이스: 이 차수 베이스출고 행과 상품명 규칙(엘리멘트=일반, 시그니처=기모, 후디=후드 · 같은 옵션) 우선, 없으면 재고 뷰 group_key.
// 재고는 v_option_current_stock 뷰 읽기만 한다(보호 테이블 직접 접근 없음).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { sbAll, loadExcelJS, downloadBlob, XLSX_MIME, readTable, S } from './PrintPoTab';

const num = (v) => Number(v) || 0;
const trim = (v) => String(v ?? '').trim();
const isCode = (v) => /^[A-Z]\d{3,}$/i.test(trim(v));
const fmt = (n) => (Number(n) || 0).toLocaleString();
const today6 = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(2, 10).replace(/-/g, '');
// 상품명 비교용: 엘리멘트=일반, 시그니처=기모, 후디=후드, 기호·공백 제거
const normName = (s) => trim(s).replace(/엘리멘트/g, '일반').replace(/시그니처/g, '기모').replace(/후디/g, '후드')
  .replace(/[♥☆()\s]/g, '').toLowerCase();
// 업체 약칭: '01_국제프린팅_입고' / '코스타컴퍼니' / '국제나염(0825)' → '국제프린팅' / '코스타' / '국제나염'
const shortVendor = (s) => trim(s).replace(/^\d+_/, '').replace(/_입고$/, '').replace(/\(.*?\)/g, '').replace(/컴퍼니$/, '').trim();
const lsKey = (vendor, round) => `baseextra:${vendor}/${round}`;
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가 환경 무시 */ } };
const EMPTY_EDIT = { ship: {}, recv: {}, bad: {}, extra: [] };

// 고른 폴더의 파일들 → 업체·차수별 묶음. 경로(…/01_국제프린팅_입고/13차/파일) 우선, 없으면 파일명('13차_정상입고_국제프린팅')
function groupRounds(fileList) {
  const map = new Map();
  [...(fileList || [])].forEach((f) => {
    if (f.name.startsWith('~$')) return;
    const xl = /\.xlsx$/i.test(f.name), img = /\.(png|jpe?g)$/i.test(f.name);
    const kind = xl && f.name.includes('베이스출고(추가') ? 'done'
      : xl && f.name.includes('베이스출고') ? 'base'
      : xl && f.name.includes('정상입고') ? 'recv'
      : xl && f.name.includes('업체전달') ? 'report'   // 업체 보고(상품별 수량 · 비고에 불량)
      : img && f.name.includes('업체전달') ? 'img'      // 업체 보고 이미지(자동 인식 불가 → 화면에 표시)
      : null;
    if (!kind) return;
    const parts = String(f.webkitRelativePath || '').split('/');
    const roundDir = parts.find((p) => /^\d+차$/.test(p));
    const vendorDir = parts.find((p) => /_입고$/.test(p));
    const toks = f.name.replace(/\.[^.]+$/, '').split('_');
    const round = Number((roundDir || toks[0]).match(/^(\d+)\s*차/)?.[1]) || 0;
    const vendor = shortVendor(vendorDir || toks.slice(1).find((t) => t && !/베이스출고|정상입고|^\d+$/.test(t)) || '');
    if (!round || !vendor) return;
    const key = `${vendor}|${round}`;
    if (!map.has(key)) map.set(key, { key, vendor, round, base: [], recv: [], report: [], img: [], done: false });
    const g = map.get(key);
    if (kind === 'done') g.done = true; else g[kind].push(f);
  });
  return [...map.values()].filter((g) => g.base.length || g.recv.length)
    .sort((a, b) => a.vendor.localeCompare(b.vendor) || b.round - a.round);
}

// 비고 글에서 불량 수량: '3불량원단'=3, '3불량/나염1불량'=4, '인쇄불량 1(번짐)'=1, '1벌 오염'=1, '2벌 부족'=0
const parseBad = (text) => {
  const t = trim(text);
  if (!t) return 0;
  let n = 0;
  for (const m of t.matchAll(/(\d+)\s*(?:장|개|벌|pcs)?\s*(?:불량|오염)/gi)) n += num(m[1]);
  if (!n) for (const m of t.matchAll(/(?:불량|오염)[가-힣]*\s*(\d+)/g)) n += num(m[1]);
  return n;
};
// 업체전달 엑셀: 상품코드 · 옵션 + (불량 숫자 칸 또는 비고) → [{code,name,option,bad,text}]
async function readReport(file) {
  const rows = await readTable(file, ['상품코드', '옵션'], ['불량', '비고', '입고수량']);
  return (rows || []).filter((r) => isCode(r['상품코드'])).map((r) => {
    const text = trim(r['비고']);
    const bad = num(r['불량']) || parseBad(text);
    return { code: trim(r['상품코드']).toUpperCase(), name: trim(r['상품명']), option: trim(r['옵션']), bad, text };
  }).filter((r) => r.bad > 0);
}

async function readRows(file) {
  const rows = await readTable(file, ['상품코드', '수량'], ['옵션', '상품명', '메모']);
  return (rows || []).filter((r) => isCode(r['상품코드'])).map((r) => ({
    code: trim(r['상품코드']).toUpperCase(), qty: num(r['수량']), name: trim(r['상품명']), option: trim(r['옵션']), memo: trim(r['메모']),
  }));
}

const card = { ...S.card, padding: 20 };
const stepTitle = (n, text, right) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 14 }}>
    <h3 style={S.title}><span style={S.step}>{n}</span>{text}</h3>
    {right}
  </div>
);

// 업체 보고 이미지(PNG) — 글자 자동 인식은 못 하므로 화면에 띄워 보면서 불량 입력. 클릭하면 크게
function ReportImages({ files }) {
  const urls = useMemo(() => files.map((f) => ({ name: f.name, url: URL.createObjectURL(f) })), [files]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u.url)), [urls]);
  const [open, setOpen] = useState(null);
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {urls.map((u) => (
          <button key={u.name} type="button" onClick={() => setOpen(open === u.name ? null : u.name)} title={u.name}
            style={{ padding: 4, borderRadius: 8, border: `1.5px solid ${open === u.name ? '#4f46e5' : '#e2e8f0'}`, background: '#fff', cursor: 'pointer', textAlign: 'center' }}>
            <img src={u.url} alt={u.name} style={{ height: 70, maxWidth: 160, objectFit: 'contain', display: 'block' }} />
            <span style={{ fontSize: 10.5, color: '#64748b' }}>{open === u.name ? '접기' : '크게 보기'}</span>
          </button>
        ))}
      </div>
      {urls.filter((u) => u.name === open).map((u) => (
        <div key={u.name} style={{ marginTop: 8, border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, maxHeight: 520, overflow: 'auto', background: '#f8fafc' }}>
          <div style={{ fontSize: 11.5, color: '#64748b', marginBottom: 6 }}>{u.name}</div>
          <img src={u.url} alt={u.name} style={{ maxWidth: '100%', display: 'block' }} />
        </div>
      ))}
    </div>
  );
}

export default function BaseExtraShipTab() {
  const [rounds, setRounds] = useState(null);   // groupRounds 결과
  const [folderName, setFolderName] = useState('');
  const [q, setQ] = useState('');
  const [vendorF, setVendorF] = useState('');   // 업체 필터('' = 전체)
  const [sel, setSel] = useState(null);         // 고른 차수 묶음
  const [data, setData] = useState(null);       // {bases, recvs}
  const [loading, setLoading] = useState(false);
  const [stock, setStock] = useState(null);
  const [edit, setEdit] = useState(EMPTY_EDIT); // 수동 입력(차수별 브라우저 기억)
  const [memo, setMemo] = useState('');
  const [fileName, setFileName] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [addRow, setAddRow] = useState({ code: '', ship: '', recv: '' });
  const [msg, setMsg] = useState(null);
  const msgTimer = useRef(null);
  useEffect(() => () => clearTimeout(msgTimer.current), []);
  const flash = (kind, text) => { clearTimeout(msgTimer.current); setMsg({ kind, text }); msgTimer.current = setTimeout(() => setMsg(null), 3000); };

  useEffect(() => {
    sbAll('v_option_current_stock?select=group_key,ba_flag,상품코드,상품명,옵션&order=상품코드.asc,옵션.asc')
      .then(setStock).catch(() => setStock([]));
  }, []);

  const idx = useMemo(() => {
    const byCode = new Map(), baseOf = new Map();
    (stock || []).forEach((r) => {
      const c = trim(r['상품코드']);
      if (c && !byCode.has(c)) byCode.set(c, r);
      if (r.ba_flag === 'B') baseOf.set(`${r.group_key}|${trim(r['옵션'])}`, r);
    });
    return { byCode, baseOf };
  }, [stock]);

  const loadFolder = (fileList) => {
    const g = groupRounds(fileList);
    const first = String(fileList?.[0]?.webkitRelativePath || '').split('/')[0];
    setFolderName(first);
    setRounds(g);
    setSel(null); setData(null); setQ(''); setVendorF('');
    if (!g.length) flash('err', '베이스출고 · 정상입고 엑셀이 있는 차수 폴더를 찾지 못했습니다 — 02_나염 폴더를 골라주세요');
  };

  const vendors = useMemo(() => [...new Set((rounds || []).map((r) => r.vendor))], [rounds]);
  const shown = useMemo(() => {
    const d = q.replace(/\D/g, '');
    return (rounds || []).filter((r) => (!vendorF || r.vendor === vendorF) && (!d || String(r.round) === d));
  }, [rounds, q, vendorF]);

  const pickRound = async (g) => {
    setSel(g); setData(null); setShowAdd(false);
    setEdit({ ...EMPTY_EDIT, ...(lsGet(lsKey(g.vendor, g.round)) || {}) });
    setFileName(`${g.round}차_베이스출고(추가)_${g.vendor}.xlsx`);
    setLoading(true);
    try {
      const bases = [], recvs = [];
      for (const f of g.base) bases.push(...(await readRows(f)));
      for (const f of g.recv) recvs.push(...(await readRows(f)));
      const reports = [];
      for (const f of g.report) { try { reports.push(...(await readReport(f))); } catch (e) { /* 서식이 다른 업체전달 파일은 건너뜀 */ } }
      setData({ bases, recvs, reports });
      // 메모: 업체명은 정상입고 메모 표기(예: 코스타컴퍼니), 없으면 약칭
      const m = recvs.map((x) => x.memo.match(/^\d{6}_[^_]*입고_(.+?)[\s_]*\d+\s*차/)).find(Boolean);
      setMemo(`${today6()}_센터출고_${m ? m[1] : g.vendor}_${g.round}차(추가)`);
    } catch (e) {
      flash('err', `엑셀 읽기 실패 — ${String(e.message || e).slice(0, 60)}`);
      setData({ bases: [], recvs: [], reports: [] });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (sel) lsSet(lsKey(sel.vendor, sel.round), edit); }, [edit, sel]);

  const calc = useMemo(() => {
    if (!data) return null;
    const rows = new Map();
    const ensure = (code, name, option) => {
      if (!rows.has(code)) rows.set(code, { code, name, option, ship: 0, recv: 0 });
      return rows.get(code);
    };
    data.bases.forEach((b) => { ensure(b.code, b.name, b.option).ship += b.qty; });
    const baseList = [...rows.values()];
    const unmatched = [];
    const findBase = (x) => {
      const nx = normName(x.name);
      let t = baseList.filter((r) => r.option === x.option && nx.startsWith(normName(r.name)))
        .sort((a, c) => normName(c.name).length - normName(a.name).length)[0] || null;
      if (!t) {
        const st = idx.byCode.get(x.code);
        const b = st ? idx.baseOf.get(`${st.group_key}|${trim(st['옵션'])}`) : null;
        if (b) t = ensure(trim(b['상품코드']), trim(b['상품명']), trim(b['옵션']));
      }
      return t;
    };
    data.recvs.forEach((x) => {
      const t = findBase(x);
      if (!t) { unmatched.push(x); return; }
      t.recv += x.qty;
    });
    // 업체전달 파일의 불량 → 베이스별 자동 불량
    const autoBad = {}, autoText = {};
    (data.reports || []).forEach((x) => {
      const t = findBase(x);
      if (!t) return;
      autoBad[t.code] = (autoBad[t.code] || 0) + x.bad;
      autoText[t.code] = [autoText[t.code], x.text || `불량 ${x.bad}`].filter(Boolean).join(' / ');
    });
    (edit.extra || []).forEach((e) => { if (!rows.has(e.code)) ensure(e.code, e.name, e.option).manual = true; });
    const list = [...rows.values()].map((r) => {
      const ship = r.code in edit.ship ? num(edit.ship[r.code]) : r.ship;
      const recv = r.code in edit.recv ? num(edit.recv[r.code]) : r.recv;
      const auto = autoBad[r.code] || 0;
      const bad = r.code in edit.bad ? num(edit.bad[r.code]) : auto;
      return { ...r, fileShip: r.ship, fileRecv: r.recv, ship, recv, bad, autoBad: auto, autoText: autoText[r.code] || '', add: ship - recv - bad };
    });
    const tot = list.reduce((a, r) => ({ ship: a.ship + r.ship, recv: a.recv + r.recv, bad: a.bad + r.bad, add: a.add + r.add }), { ship: 0, recv: 0, bad: 0, add: 0 });
    return { list, unmatched, tot, allZero: list.every((r) => r.add === 0), autoCount: Object.keys(autoBad).length, autoSum: Object.values(autoBad).reduce((a, b) => a + b, 0) };
  }, [data, idx, edit]);

  const setField = (field, code, v) => setEdit((p) => ({ ...p, [field]: { ...p[field], [code]: v } }));
  const clearField = (field, code) => setEdit((p) => { const m = { ...p[field] }; delete m[code]; return { ...p, [field]: m }; });
  const editNum = (field, r, fileVal) => (v) => (!r.manual && (v === '' || num(v) === fileVal) ? clearField(field, r.code) : setField(field, r.code, v));

  const addExtra = () => {
    const code = trim(addRow.code).toUpperCase();
    if (!isCode(code)) { flash('err', '베이스 상품코드를 입력해주세요 (예: S13160)'); return; }
    if (calc?.list.some((r) => r.code === code)) { flash('neutral', `${code} 은 이미 표에 있습니다`); return; }
    const st = idx.byCode.get(code);
    setEdit((p) => ({
      ...p,
      extra: [...(p.extra || []), { code, name: trim(st?.['상품명']) || '(재고에 없는 코드)', option: trim(st?.['옵션']) }],
      ship: { ...p.ship, [code]: num(addRow.ship) },
      recv: { ...p.recv, [code]: num(addRow.recv) },
    }));
    setAddRow({ code: '', ship: '', recv: '' });
  };
  const removeExtra = (code) => setEdit((p) => {
    const strip = (m) => { const o = { ...m }; delete o[code]; return o; };
    return { ...p, extra: (p.extra || []).filter((e) => e.code !== code), ship: strip(p.ship), recv: strip(p.recv), bad: strip(p.bad) };
  });
  const resetEdit = () => { setEdit(EMPTY_EDIT); flash('neutral', '입력값을 지우고 파일 값으로 되돌렸습니다'); };

  const download = async () => {
    if (!calc) return;
    if (calc.allZero) { flash('neutral', '추가 출고 수량이 모두 0 — 파일을 만들지 않습니다'); return; }
    const fn = trim(fileName);
    if (!/\.xlsx$/i.test(fn)) { flash('err', '파일명은 .xlsx 로 끝나야 합니다'); return; }
    try {
      const ExcelJS = await loadExcelJS();
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Sheet1');
      const thin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
      const border = { top: thin, left: thin, bottom: thin, right: thin };
      ws.addRow(['상품코드', '수량', '메모', '상품명', '옵션']);
      calc.list.forEach((r) => ws.addRow([r.code, r.add, memo, r.name, r.option]));
      ws.eachRow((row, i) => {
        row.height = 18;
        for (let c = 1; c <= 5; c++) {
          const cell = row.getCell(c);
          cell.border = border;
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          if (i === 1) { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } }; cell.font = { bold: true }; }
        }
      });
      [10, 8, 36, 26, 18].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
      downloadBlob(new Blob([await wb.xlsx.writeBuffer()], { type: XLSX_MIME }), fn);
      flash('ok', `${fn} 다운로드 완료 · 합계 ${fmt(calc.tot.add)}장`);
    } catch (e) {
      flash('err', '엑셀 생성 실패 — 다시 시도해주세요');
    }
  };

  // ── 화면 ──
  const pill = (on) => ({
    padding: '6px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
    border: `1px solid ${on ? '#4f46e5' : '#e2e8f0'}`, background: on ? '#4f46e5' : '#fff', color: on ? '#fff' : '#334155',
  });
  const cellNum = { ...S.td, textAlign: 'right', width: 90 };
  const numBox = (value, onChange, changed) => (
    <input type="number" value={value} onChange={(e) => onChange(e.target.value)}
      style={{ ...S.qty, width: 64, color: changed ? '#b45309' : '#0f172a', borderColor: changed ? '#f59e0b' : '#e2e8f0', background: changed ? '#fffbeb' : '#fff' }} />
  );
  const msgLine = msg && <span style={S.msg(msg.kind)}>{msg.text}</span>;

  return (
    <div style={{ maxWidth: 1100 }}>
      {/* 1. 폴더 불러오기 + 차수 검색 */}
      <div style={card}>
        {stepTitle(1, '차수 고르기', !sel && msgLine)}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ ...S.btn(!rounds, false), display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            📂 {rounds ? '폴더 다시 불러오기' : '02_나염 폴더 불러오기'}
            <input type="file" webkitdirectory="" directory="" multiple style={{ display: 'none' }} onChange={(e) => { loadFolder(e.target.files); e.target.value = ''; }} />
          </label>
          {rounds && <span style={{ fontSize: 12.5, color: '#64748b' }}>📁 <b style={{ color: '#0f172a' }}>{folderName}</b> · 차수 {rounds.length}개</span>}
        </div>
        {!rounds && (
          <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 10, lineHeight: 1.6 }}>
            공유 폴더 <b>04_생산 › 06_외주업체 의뢰 › 02_나염</b> 을 고르세요. 브라우저가 “업로드” 확인을 물으면 허용 — 파일은 이 화면 안에서만 읽습니다.
          </div>
        )}
        {rounds && rounds.length > 0 && (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '14px 0 10px' }}>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="차수 검색 (예: 13)" inputMode="numeric"
                style={{ ...S.input, width: 170, fontSize: 14, padding: '8px 12px' }} />
              <button type="button" style={pill(!vendorF)} onClick={() => setVendorF('')}>전체</button>
              {vendors.map((v) => <button key={v} type="button" style={pill(vendorF === v)} onClick={() => setVendorF(v)}>{v}</button>)}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', maxHeight: 132, overflowY: 'auto' }}>
              {shown.length === 0 && <span style={{ fontSize: 12.5, color: '#94a3b8' }}>검색 결과가 없습니다</span>}
              {shown.map((g) => {
                const on = sel?.key === g.key;
                const ready = g.base.length && g.recv.length;
                return (
                  <button key={g.key} type="button" onClick={() => pickRound(g)} disabled={!ready}
                    title={!g.base.length ? '베이스출고 파일 없음' : !g.recv.length ? '정상입고 파일 없음(입고 전)' : g.done ? '베이스출고(추가) 파일 이미 있음' : ''}
                    style={{
                      padding: '8px 12px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: ready ? 'pointer' : 'not-allowed', textAlign: 'left',
                      border: `1.5px solid ${on ? '#4f46e5' : '#e2e8f0'}`, background: on ? '#eef2ff' : ready ? '#fff' : '#f8fafc', color: ready ? '#0f172a' : '#cbd5e1',
                    }}>
                    {g.vendor} {g.round}차
                    <span style={{ display: 'block', fontSize: 11, fontWeight: 600, color: !ready ? '#cbd5e1' : g.done ? '#16a34a' : '#94a3b8' }}>
                      {!g.recv.length ? '입고 전' : !g.base.length ? '베이스 파일 없음' : g.done ? '✓ 생성됨' : '생성 전'}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* 2. 계산 확인 + 불량 입력 */}
      {sel && (
        <div style={card}>
          {stepTitle(2, `${sel.vendor} ${sel.round}차 — 불량 입력 후 확인`,
            <span style={{ fontSize: 12, color: '#64748b' }}>추가 출고 = 베이스출고 − 정상입고 − 불량</span>)}
          {loading && <div style={S.empty}>⏳ 엑셀 읽는 중…</div>}
          {!loading && calc && (
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10, fontSize: 12.5 }}>
                {calc.autoCount > 0
                  ? <span style={{ fontWeight: 700, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '5px 10px' }}>불량 자동 반영 · 업체전달 파일에서 {calc.autoCount}개 상품 {fmt(calc.autoSum)}장</span>
                  : sel.report.length > 0
                    ? <span style={{ color: '#64748b' }}>업체전달 파일에 불량 기록 없음</span>
                    : <span style={{ color: '#64748b' }}>업체전달 엑셀 없음{sel.img.length ? ' — 아래 업체 보고 이미지를 보고 불량을 입력하세요' : ''}</span>}
              </div>
              {sel.img.length > 0 && <ReportImages files={sel.img} />}
              <div style={{ ...S.tableWrap, maxHeight: 480, overflowY: 'auto' }}>
                <table style={S.table}>
                  <thead><tr>
                    <th style={S.th}>상품코드</th><th style={S.th}>상품 · 옵션</th>
                    <th style={{ ...S.th, textAlign: 'right' }}>베이스출고</th><th style={{ ...S.th, textAlign: 'right' }}>정상입고</th>
                    <th style={{ ...S.th, textAlign: 'right' }}>불량</th><th style={{ ...S.th, textAlign: 'right' }}>추가 출고</th>
                  </tr></thead>
                  <tbody>
                    {calc.list.map((r) => (
                      <tr key={r.code} style={{ background: r.manual ? '#fffbeb' : undefined }}>
                        <td style={{ ...S.td, ...S.mono, width: 80 }}>{r.code}</td>
                        <td style={S.td}>
                          {r.name} <span style={{ color: '#64748b' }}>{r.option}</span>
                          {r.autoText && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: '#b45309', background: '#fffbeb', borderRadius: 4, padding: '1px 6px' }}>업체: {r.autoText}</span>}
                          {r.manual && <button type="button" onClick={() => removeExtra(r.code)} style={{ marginLeft: 8, fontSize: 11, color: '#b91c1c', background: 'none', border: 'none', cursor: 'pointer' }}>삭제</button>}
                        </td>
                        <td style={cellNum}>{numBox(r.ship, editNum('ship', r, r.fileShip), r.code in edit.ship && !r.manual)}</td>
                        <td style={cellNum}>{numBox(r.recv, editNum('recv', r, r.fileRecv), r.code in edit.recv && !r.manual)}</td>
                        <td style={cellNum}>
                          <input type="number" min={0} value={r.code in edit.bad ? edit.bad[r.code] : (r.autoBad || '')} placeholder="0"
                            title={r.autoText ? `업체전달 파일: ${r.autoText}` : ''}
                            onChange={(e) => { const v = e.target.value; if (num(v) === r.autoBad) clearField('bad', r.code); else setField('bad', r.code, v); }}
                            style={{ ...S.qty, width: 56, color: '#b45309', borderColor: r.bad ? '#f59e0b' : '#e2e8f0', background: r.bad ? '#fffbeb' : '#fff' }} />
                        </td>
                        <td style={{ ...cellNum, fontSize: 14, fontWeight: 800, color: r.add < 0 ? '#dc2626' : r.add > 0 ? '#0f766e' : '#cbd5e1' }}>{r.add}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr style={{ background: '#f8fafc', position: 'sticky', bottom: 0 }}>
                    <td style={{ ...S.td, fontWeight: 700 }} colSpan={2}>합계 · {calc.list.length}개</td>
                    {[calc.tot.ship, calc.tot.recv, calc.tot.bad, calc.tot.add].map((v, i) => (
                      <td key={i} style={{ ...S.td, textAlign: 'right', fontWeight: 800, fontSize: i === 3 ? 14 : 12.5, color: i === 3 ? '#0f766e' : '#0f172a' }}>{fmt(v)}</td>
                    ))}
                  </tr></tfoot>
                </table>
              </div>
              {calc.unmatched.length > 0 && (
                <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 8 }}>
                  ⚠ 베이스를 못 찾은 입고 상품 {calc.unmatched.length}건은 계산에서 빠졌습니다 — {calc.unmatched.slice(0, 3).map((u) => `${u.code} ${u.option}`).join(', ')}{calc.unmatched.length > 3 ? ' 외' : ''}
                </div>
              )}
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 10, fontSize: 12 }}>
                <button type="button" onClick={() => setShowAdd((v) => !v)} style={{ background: 'none', border: 'none', color: '#4f46e5', fontWeight: 700, cursor: 'pointer', padding: 0 }}>
                  {showAdd ? '− 행 추가 닫기' : '+ 파일에 없는 베이스 추가'}
                </button>
                {(Object.keys(edit.ship).length + Object.keys(edit.recv).length + Object.keys(edit.bad).length + (edit.extra || []).length) > 0 && (
                  <button type="button" onClick={resetEdit} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 0 }}>입력값 초기화</button>
                )}
                <span style={{ color: '#94a3b8' }}>주황 = 직접 고친 값 · 입력값은 이 브라우저에 차수별로 기억</span>
              </div>
              {showAdd && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8, padding: 10, borderRadius: 8, background: '#f8fafc', fontSize: 12, color: '#475569' }}>
                  <input value={addRow.code} onChange={(e) => setAddRow((p) => ({ ...p, code: e.target.value }))} placeholder="베이스 상품코드" style={{ ...S.input, width: 130, fontSize: 12 }} />
                  베이스출고 <input type="number" value={addRow.ship} onChange={(e) => setAddRow((p) => ({ ...p, ship: e.target.value }))} style={{ ...S.qty, width: 64 }} />
                  정상입고 <input type="number" value={addRow.recv} onChange={(e) => setAddRow((p) => ({ ...p, recv: e.target.value }))} style={{ ...S.qty, width: 64 }} />
                  <button type="button" style={{ ...S.btn(false, false), fontSize: 12, padding: '5px 10px' }} onClick={addExtra}>추가</button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* 3. 다운로드 */}
      {sel && calc && !loading && (
        <div style={card}>
          {stepTitle(3, '엑셀 만들기')}
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 10px', alignItems: 'center', maxWidth: 560, fontSize: 12.5, color: '#475569', fontWeight: 600 }}>
            메모 <input value={memo} onChange={(e) => setMemo(e.target.value)} style={S.input} />
            파일명 <input value={fileName} onChange={(e) => setFileName(e.target.value)} style={S.input} />
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 14 }}>
            <button type="button" style={{ ...S.btn(true, calc.allZero), padding: '10px 18px', fontSize: 14 }} disabled={calc.allZero} onClick={download}>
              ⬇ 엑셀 다운로드 · {fmt(calc.tot.add)}장
            </button>
            {calc.allZero
              ? <span style={{ fontSize: 12.5, fontWeight: 600, color: '#64748b' }}>추가 출고 수량이 모두 0 — 파일을 만들지 않습니다</span>
              : <span style={{ fontSize: 12, color: '#94a3b8' }}>받은 파일을 {sel.vendor} {sel.round}차 폴더에 넣고 어드민 재고일괄조정에서 <b>정상 · 출고</b>로 올리세요</span>}
            {msgLine}
          </div>
        </div>
      )}
    </div>
  );
}
