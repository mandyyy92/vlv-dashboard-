// src/components/BaseExtraShipTab.jsx
// 프린팅 외주 › 베이스 추가 출고 — 나염 차수 폴더의 엑셀로 이지어드민 '베이스출고(추가)' 파일 생성
//  · 폴더: 공유 폴더 02_나염 (발주서 작성 탭에서 연결한 폴더를 같이 씀) / {NN}_{업체}_입고/{N}차/
//  · 읽는 파일: {N}차_베이스출고_*.xlsx (베이스 실제 출고, '(추가' 파일 제외) + {N}차_정상입고_*.xlsx (센터 정상입고, _1·_2 합산)
//  · 매칭: 이 차수 베이스출고 행과 상품명 규칙(엘리멘트=일반, 시그니처=기모, 후디=후드 · 같은 옵션). 못 찾으면 재고 뷰 group_key + 같은 옵션의 B 상품
//  · 추가 출고 = 베이스출고 − 정상입고 − 업체 보고 불량 (음수도 그대로 · 5차 코스타 파일과 같은 규칙)
//  · 저장: 같은 차수 폴더에 {N}차_베이스출고(추가)_{업체}.xlsx — 상품코드 | 수량 | 메모 | 상품명 | 옵션
// 재고는 v_option_current_stock 뷰 읽기만 한다(보호 테이블 직접 접근 없음).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  sbAll, loadExcelJS, downloadBlob, XLSX_MIME, FS_SUPPORTED,
  idbGet, idbSet, ensurePermission, writeFile, readTable, S,
} from './PrintPoTab';

const num = (v) => Number(v) || 0;
const trim = (v) => String(v ?? '').trim();
const isCode = (v) => /^[A-Z]\d{3,}$/i.test(trim(v));
const roundNo = (name) => Number((String(name).match(/^(\d+)차$/) || [])[1]) || 0;
// '01_국제프린팅_입고' → '국제프린팅'
const vendorOfDir = (name) => String(name).replace(/^\d+_/, '').replace(/_입고$/, '');
// 상품명 비교용: 엘리멘트=일반, 시그니처=기모, 후디=후드, 기호·공백 제거
const normName = (s) => trim(s).replace(/엘리멘트/g, '일반').replace(/시그니처/g, '기모').replace(/후디/g, '후드')
  .replace(/[♥☆()\s]/g, '').toLowerCase();
const fmt = (n) => (Number(n) || 0).toLocaleString();
const lsKey = (vendor, round) => `baseextra:${vendor}/${round}`; // 업체 약칭(국제프린팅·코스타) 기준 — 폴더·파일 선택 모드 공통
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가 환경 무시 */ } };

// 루트(02_나염 또는 그 상위)에서 '_입고' 업체 폴더 → 차수 폴더 목록
async function scanRoot(root) {
  const vendorDirs = [];
  const collect = async (dir) => {
    for await (const [name, h] of dir.entries()) if (h.kind === 'directory' && /_입고$/.test(name)) vendorDirs.push(h);
  };
  await collect(root);
  if (!vendorDirs.length) { // 상위 폴더를 고른 경우 '나염' 폴더 한 단계 아래 확인
    for await (const [name, h] of root.entries()) if (h.kind === 'directory' && name.includes('나염')) await collect(h);
  }
  const out = [];
  for (const vd of vendorDirs) {
    const rounds = [];
    for await (const [name, h] of vd.entries()) {
      if (h.kind !== 'directory' || !roundNo(name)) continue;
      const files = [];
      for await (const [fn, fh] of h.entries()) if (fh.kind === 'file' && /\.xlsx$/i.test(fn) && !fn.startsWith('~$')) files.push(fn);
      rounds.push({
        name, no: roundNo(name), dir: h,
        hasBase: files.some((f) => f.includes('베이스출고') && !f.includes('(추가')),
        hasRecv: files.some((f) => f.includes('정상입고')),
        done: files.some((f) => f.includes('베이스출고(추가')),
      });
    }
    rounds.sort((a, b) => b.no - a.no);
    out.push({ name: vd.name, vendor: vendorOfDir(vd.name), dir: vd, rounds });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// 폴더 모드는 dir 핸들에서, 파일 직접 선택 모드는 File 객체(file)에서 읽는다
async function readRows(dir, fileName, file) {
  const f = file || await (await dir.getFileHandle(fileName)).getFile();
  const rows = await readTable(f, ['상품코드', '수량'], ['옵션', '상품명', '메모']);
  return (rows || []).filter((r) => isCode(r['상품코드'])).map((r) => ({
    code: trim(r['상품코드']), qty: num(r['수량']), name: trim(r['상품명']), option: trim(r['옵션']), memo: trim(r['메모']), file: fileName,
  }));
}

// 파일 직접 선택 모드: '13차_정상입고_국제프린팅.xlsx' → {round:13, vendor:'국제프린팅'} ('코스타컴퍼니' → '코스타', 기존 파일명 표기)
const guessRoundVendor = (names) => {
  let round = 0, vendor = '';
  names.forEach((n) => {
    const toks = String(n).replace(/\.[^.]+$/, '').split('_');
    if (!round) round = Number((toks[0].match(/^(\d+)\s*차/) || [])[1]) || 0;
    const v = toks.slice(1).find((t) => t && !/베이스출고|정상입고|입고대기|MFS|^\d+$|^\(/.test(t));
    if (!vendor && v) vendor = v.replace(/\(.*?\)/g, '').replace(/컴퍼니$/, '').trim();
  });
  return { round, vendor };
};

export default function BaseExtraShipTab() {
  const [rootDir, setRootDir] = useState(null);
  const [folderErr, setFolderErr] = useState('');
  const [tree, setTree] = useState(null);       // scanRoot 결과
  const [scanning, setScanning] = useState(false);
  const [sel, setSel] = useState(null);         // {vendorDir, vendor, round}
  const [files, setFiles] = useState([]);       // [{name, kind:'base'|'recv', on}]
  const [data, setData] = useState(null);       // {bases, recvs}
  const [loadingRound, setLoadingRound] = useState(false);
  const [stock, setStock] = useState(null);     // v_option_current_stock (상품코드·group_key·옵션)
  const [edit, setEdit] = useState({ ship: {}, recv: {}, bad: {}, note: {}, extra: [] }); // 수동 입력(차수별 브라우저 기억)
  const [memo, setMemo] = useState('');
  const [fileName, setFileName] = useState('');
  const [addRow, setAddRow] = useState({ code: '', ship: '', recv: '' });
  const [overArm, setOverArm] = useState(false); // 덮어쓰기 2단계 확인
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const msgTimer = useRef(null);
  const armTimer = useRef(null);
  useEffect(() => () => { clearTimeout(msgTimer.current); clearTimeout(armTimer.current); }, []);
  const flash = (kind, text) => { clearTimeout(msgTimer.current); setMsg({ kind, text }); msgTimer.current = setTimeout(() => setMsg(null), 3000); };

  useEffect(() => { if (FS_SUPPORTED) idbGet('root').then((h) => { if (h) setRootDir(h); }); }, []);
  useEffect(() => {
    sbAll('v_option_current_stock?select=group_key,ba_flag,상품코드,상품명,옵션&order=상품코드.asc,옵션.asc')
      .then(setStock).catch(() => setStock([]));
  }, []);

  const scan = useCallback(async (h = rootDir) => {
    if (!h) return;
    setScanning(true);
    try {
      if (!(await ensurePermission(h))) throw new Error('폴더 권한이 허용되지 않았습니다');
      setTree(await scanRoot(h));
    } catch (e) {
      setFolderErr(String(e.message || e).slice(0, 160));
    } finally {
      setScanning(false);
    }
  }, [rootDir]);

  const connectFolder = async (simple = false) => {
    setFolderErr('');
    try {
      const h = await window.showDirectoryPicker(simple ? { mode: 'readwrite' } : { id: 'printpo-nayeom', mode: 'readwrite' });
      setRootDir(h);
      await idbSet('root', h);
      await scan(h);
    } catch (e) {
      if (e && e.name === 'AbortError' && !simple) return;
      setFolderErr(`${e?.name || 'Error'}: ${e?.message || ''}`.slice(0, 160));
    }
  };

  // 재고 인덱스: 상품코드 → 행, group_key|옵션 → 베이스(B) 행
  const idx = useMemo(() => {
    const byCode = new Map(), baseOf = new Map();
    (stock || []).forEach((r) => {
      const c = trim(r['상품코드']);
      if (c && !byCode.has(c)) byCode.set(c, r);
      if (r.ba_flag === 'B') baseOf.set(`${r.group_key}|${trim(r['옵션'])}`, r);
    });
    return { byCode, baseOf };
  }, [stock]);

  const openRound = async (vd, r) => {
    setSel({ vendorDir: vd.name, vendor: vd.vendor, round: r.no, dir: r.dir, done: r.done });
    setData(null); setOverArm(false);
    const saved = lsGet(lsKey(vd.vendor, r.no));
    setEdit({ ship: {}, recv: {}, bad: {}, note: {}, extra: [], ...(saved || {}) });
    setFileName(`${r.no}차_베이스출고(추가)_${vd.vendor}.xlsx`);
    const fl = [];
    try {
      if (!(await ensurePermission(rootDir))) throw new Error('폴더 권한이 허용되지 않았습니다');
      for await (const [fn, fh] of r.dir.entries()) {
        if (fh.kind !== 'file' || !/\.xlsx$/i.test(fn) || fn.startsWith('~$')) continue;
        if (fn.includes('베이스출고') && !fn.includes('(추가')) fl.push({ name: fn, kind: 'base', on: true });
        else if (fn.includes('정상입고')) fl.push({ name: fn, kind: 'recv', on: true });
      }
    } catch (e) {
      flash('err', `폴더를 읽지 못했습니다 — ${String(e.message || e).slice(0, 60)}`);
    }
    fl.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
    setFiles(fl);
    await loadFiles(r.dir, fl, r.no, vd.vendor);
  };

  const loadFiles = async (dir, fl, round, vendor) => {
    setLoadingRound(true);
    try {
      const bases = [], recvs = [];
      for (const f of fl.filter((x) => x.on)) (f.kind === 'base' ? bases : recvs).push(...(await readRows(dir, f.name, f.file)));
      setData({ bases, recvs });
      // 메모 기본값: '오늘(KST YYMMDD)_센터출고_업체_N차(추가)' — 업체명은 정상입고 메모 표기(예: 코스타컴퍼니), 없으면 폴더 업체명
      const m = recvs.map((x) => x.memo.match(/^\d{6}_[^_]*입고_(.+?)[\s_]*\d+\s*차/)).find(Boolean);
      const d6 = new Date(Date.now() + 9 * 3600e3).toISOString().slice(2, 10).replace(/-/g, '');
      setMemo(`${d6}_센터출고_${m ? m[1] : vendor}_${round}차(추가)`);
    } catch (e) {
      flash('err', `엑셀 읽기 실패 — ${String(e.message || e).slice(0, 60)}`);
      setData({ bases: [], recvs: [] });
    } finally {
      setLoadingRound(false);
    }
  };

  // 폴더 연결 없이: 차수 폴더(또는 엑셀 파일들)를 직접 골라 계산 → 결과는 다운로드
  const openLocal = async (fileList) => {
    const all = [...(fileList || [])].filter((f) => /\.xlsx$/i.test(f.name) && !f.name.startsWith('~$'));
    const fl = [];
    all.forEach((f) => {
      if (f.name.includes('베이스출고') && !f.name.includes('(추가')) fl.push({ name: f.name, kind: 'base', on: true, file: f });
      else if (f.name.includes('정상입고')) fl.push({ name: f.name, kind: 'recv', on: true, file: f });
    });
    if (!fl.length) { flash('err', '베이스출고 · 정상입고 엑셀을 찾지 못했습니다 — 차수 폴더나 두 파일을 골라주세요'); return; }
    fl.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
    const { round, vendor } = guessRoundVendor(fl.map((f) => f.name));
    setSel({ vendorDir: '', vendor: vendor || '업체', round, dir: null, local: true });
    setData(null); setOverArm(false);
    const saved = round ? lsGet(lsKey(vendor, round)) : null;
    setEdit({ ship: {}, recv: {}, bad: {}, note: {}, extra: [], ...(saved || {}) });
    setFileName(`${round || 'N'}차_베이스출고(추가)_${vendor || '업체'}.xlsx`);
    setFiles(fl);
    await loadFiles(null, fl, round || 'N', vendor);
  };

  const toggleFile = (name) => {
    const fl = files.map((f) => (f.name === name ? { ...f, on: !f.on } : f));
    setFiles(fl);
    if (sel) loadFiles(sel.dir, fl, sel.round, sel.vendor);
  };

  // 차수별 수동 입력은 브라우저에 기억(다시 열어도 불량·수정값 유지)
  useEffect(() => { if (sel && sel.round) lsSet(lsKey(sel.vendor, sel.round), edit); }, [edit, sel]);

  // 계산 행: 베이스 코드 기준으로 베이스출고·정상입고 합산
  const calc = useMemo(() => {
    if (!data) return null;
    const rows = new Map();
    const ensure = (code, name, option) => {
      if (!rows.has(code)) rows.set(code, { code, name, option, ship: 0, recv: 0, arts: new Set(), inBase: false });
      return rows.get(code);
    };
    data.bases.forEach((b) => { const r = ensure(b.code, b.name, b.option); r.ship += b.qty; r.inBase = true; });
    const baseList = [...rows.values()];
    const unmatched = [];
    data.recvs.forEach((x) => {
      // 1) 이 차수 베이스출고 행 중 상품명 규칙: 같은 옵션 + 입고 상품명이 베이스 상품명으로 시작(가장 긴 이름 우선)
      //    (재고 group_key 의 베이스는 실제 출고한 베이스 코드와 다를 수 있어 차수 파일을 먼저 본다)
      const nx = normName(x.name);
      let target = baseList.filter((r) => r.option === x.option && nx.startsWith(normName(r.name)))
        .sort((a, c) => normName(c.name).length - normName(a.name).length)[0] || null;
      if (!target) { // 2) 재고 뷰: group_key + 같은 옵션의 B 상품
        const st = idx.byCode.get(x.code);
        const b = st ? idx.baseOf.get(`${st.group_key}|${trim(st['옵션'])}`) : null;
        if (b) target = ensure(trim(b['상품코드']), trim(b['상품명']), trim(b['옵션']));
      }
      if (!target) { unmatched.push(x); return; }
      target.recv += x.qty;
      target.arts.add(x.name);
    });
    (edit.extra || []).forEach((e) => { if (!rows.has(e.code)) { const r = ensure(e.code, e.name, e.option); r.manual = true; } });
    const list = [...rows.values()].map((r) => {
      const ship = r.code in edit.ship ? num(edit.ship[r.code]) : r.ship;
      const recv = r.code in edit.recv ? num(edit.recv[r.code]) : r.recv;
      const bad = num(edit.bad[r.code]);
      return { ...r, arts: [...r.arts].join(', '), fileShip: r.ship, fileRecv: r.recv, ship, recv, bad, add: ship - recv - bad, note: edit.note[r.code] || '' };
    });
    const tot = list.reduce((a, r) => ({ ship: a.ship + r.ship, recv: a.recv + r.recv, bad: a.bad + r.bad, add: a.add + r.add }), { ship: 0, recv: 0, bad: 0, add: 0 });
    return { list, unmatched, tot };
  }, [data, idx, edit]);

  // 모든 행의 추가 출고가 0 이면 파일을 만들지 않음(어드민에 올릴 것 없음)
  const allZero = !!calc && calc.list.every((r) => r.add === 0);
  const setField = (field, code, v) => setEdit((p) => ({ ...p, [field]: { ...p[field], [code]: v } }));
  const clearField = (field, code) => setEdit((p) => { const m = { ...p[field] }; delete m[code]; return { ...p, [field]: m }; });

  const addExtra = () => {
    const code = trim(addRow.code).toUpperCase();
    if (!isCode(code)) { flash('err', '베이스 상품코드를 입력해주세요 (예: S13160)'); return; }
    if (calc?.list.some((r) => r.code === code)) { flash('neutral', `${code} 은 이미 표에 있습니다 — 표에서 수량을 고쳐주세요`); return; }
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
    return { ...p, extra: (p.extra || []).filter((e) => e.code !== code), ship: strip(p.ship), recv: strip(p.recv), bad: strip(p.bad), note: strip(p.note) };
  });

  const buildBlob = async () => {
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
    return new Blob([await wb.xlsx.writeBuffer()], { type: XLSX_MIME });
  };

  const save = async () => {
    if (!calc || !sel) return;
    const fn = trim(fileName);
    if (!/\.xlsx$/i.test(fn)) { flash('err', '파일명은 .xlsx 로 끝나야 합니다'); return; }
    if (!calc.list.length) { flash('err', '저장할 행이 없습니다'); return; }
    if (allZero) { flash('neutral', '조정할 수량이 모두 0 — 파일을 만들지 않습니다'); return; }
    if (sel.local) { await downloadOnly(); return; }
    setSaving(true);
    try {
      if (!(await ensurePermission(rootDir))) throw new Error('폴더 권한이 허용되지 않았습니다');
      let exists = false;
      try { await sel.dir.getFileHandle(fn); exists = true; } catch (e) { exists = false; }
      if (exists && !overArm) {
        setOverArm(true);
        clearTimeout(armTimer.current);
        armTimer.current = setTimeout(() => setOverArm(false), 3000);
        flash('neutral', '같은 이름의 파일이 있습니다 — 3초 안에 한 번 더 누르면 덮어씁니다');
        return;
      }
      setOverArm(false);
      await writeFile(sel.dir, fn, await buildBlob());
      flash('ok', `${sel.vendorDir}/${sel.round}차/${fn} 저장 · 합계 ${fmt(calc.tot.add)}장`);
      setTree((t) => t && t.map((v) => (v.name !== sel.vendorDir ? v : { ...v, rounds: v.rounds.map((r) => (r.no === sel.round ? { ...r, done: true } : r)) })));
    } catch (e) {
      flash('err', `저장 실패 — ${String(e.message || e).slice(0, 80)}`);
    } finally {
      setSaving(false);
    }
  };

  const downloadOnly = async () => {
    if (!calc) return;
    if (allZero) { flash('neutral', '조정할 수량이 모두 0 — 파일을 만들지 않습니다'); return; }
    try {
      downloadBlob(await buildBlob(), trim(fileName) || 'base_extra.xlsx');
      flash('ok', `${trim(fileName)} 다운로드 · 합계 ${fmt(calc.tot.add)}장 — 차수 폴더에 옮겨주세요`);
    } catch (e) { flash('err', '엑셀 생성 실패'); }
  };

  // ── 화면 ──
  const chip = (r, vd) => {
    const on = sel && !sel.local && sel.vendorDir === vd.name && sel.round === r.no;
    const ready = r.hasBase && r.hasRecv;
    return (
      <button key={r.name} type="button" onClick={() => openRound(vd, r)} title={!r.hasBase ? '베이스출고 파일 없음' : !r.hasRecv ? '정상입고 파일 없음' : r.done ? '베이스출고(추가) 파일 있음' : '생성 전'}
        style={{
          padding: '5px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
          border: `1px solid ${on ? '#4f46e5' : r.done ? '#86efac' : ready ? '#cbd5e1' : '#e5e7eb'}`,
          background: on ? '#4f46e5' : r.done ? '#f0fdf4' : '#fff', color: on ? '#fff' : r.done ? '#15803d' : ready ? '#0f172a' : '#94a3b8',
        }}>
        {r.name}{r.done ? ' ✓' : ''}
      </button>
    );
  };

  const numInput = (value, onChange, changed) => (
    <input type="number" value={value} onChange={(e) => onChange(e.target.value)}
      style={{ ...S.qty, width: 60, color: changed ? '#b45309' : '#0f172a', borderColor: changed ? '#f59e0b' : '#cbd5e1', background: changed ? '#fffbeb' : '#fff' }} />
  );

  return (
    <div>
      <div style={S.card}>
        <div style={{ ...S.bar, justifyContent: 'space-between' }}>
          <h3 style={S.title}><span style={S.step}>1</span>나염 차수 선택</h3>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8, padding: '10px 12px', borderRadius: 8, border: '1px dashed #cbd5e1', background: sel?.local ? '#eef2ff' : '#fff' }}>
          <b style={{ fontSize: 12.5, color: '#334155' }}>파일 선택</b>
          <label style={{ ...S.btn(false, false), fontSize: 12, padding: '5px 10px' }}>
            📂 차수 폴더 선택
            <input type="file" webkitdirectory="" directory="" multiple style={{ display: 'none' }} onChange={(e) => { openLocal(e.target.files); e.target.value = ''; }} />
          </label>
          <label style={{ ...S.btn(false, false), fontSize: 12, padding: '5px 10px' }}>
            📄 엑셀 파일 선택
            <input type="file" accept=".xlsx" multiple style={{ display: 'none' }} onChange={(e) => { openLocal(e.target.files); e.target.value = ''; }} />
          </label>
          <span style={{ fontSize: 12, color: '#64748b' }}>예: 02_나염_국제프린팅_입고차 폴더 (또는 그 안의 베이스출고 · 정상입고 파일) → 결과 엑셀은 다운로드되니 차수 폴더에 옮겨주세요</span>
        </div>
        {folderErr && (
          <div style={{ ...S.msg('err'), display: 'flex', gap: 8, alignItems: 'center' }}>
            폴더 연결 실패 — {folderErr}
            <button style={{ ...S.btn(false, false), fontSize: 12, padding: '4px 8px' }} onClick={() => connectFolder(true)}>기본 위치로 다시 열기</button>
          </div>
        )}
        {tree && !tree.length && <div style={S.msg('err')}>‘_입고’ 업체 폴더를 찾지 못했습니다 — 02_나염 폴더를 연결해주세요</div>}
        {tree && tree.map((vd) => (
          <div key={vd.name} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', borderTop: '1px solid #f1f5f9' }}>
            <div style={{ width: 110, flexShrink: 0, fontSize: 13, fontWeight: 700, color: '#334155', paddingTop: 4 }}>{vd.vendor}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{vd.rounds.map((r) => chip(r, vd))}</div>
          </div>
        ))}
        {tree && <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 6 }}>✓ 초록 = 베이스출고(추가) 파일 있음 · 회색 글씨 = 베이스출고 또는 정상입고 파일이 아직 없음</div>}
      </div>

      {sel && (
        <div style={S.card}>
          <div style={{ ...S.bar, justifyContent: 'space-between' }}>
            <h3 style={S.title}><span style={S.step}>2</span>{sel.vendor} {sel.round}차 — 추가 출고 계산</h3>
            <span style={{ fontSize: 12, color: '#64748b' }}>추가 출고 = 베이스출고 − 정상입고 − 업체 보고 불량 (음수도 그대로)</span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {files.length === 0 && <span style={S.msg('err')}>베이스출고 · 정상입고 엑셀이 없습니다</span>}
            {files.map((f) => (
              <label key={f.name} style={{ display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 12, padding: '4px 9px', borderRadius: 6, border: '1px solid #e5e7eb', background: f.on ? (f.kind === 'base' ? '#eef2ff' : '#f0fdfa') : '#f8fafc', color: f.on ? '#0f172a' : '#94a3b8', cursor: 'pointer' }}>
                <input type="checkbox" checked={f.on} onChange={() => toggleFile(f.name)} />
                <b style={{ color: f.kind === 'base' ? '#4f46e5' : '#0f766e' }}>{f.kind === 'base' ? '베이스' : '입고'}</b>{f.name}
              </label>
            ))}
          </div>
          {loadingRound && <div style={S.empty}>⏳ 엑셀 읽는 중…</div>}
          {!loadingRound && calc && (
            <>
              <div style={{ ...S.tableWrap, maxHeight: 560, overflowY: 'auto' }}>
                <table style={S.table}>
                  <thead><tr>
                    <th style={S.th}>상품코드</th><th style={S.th}>상품명</th><th style={S.th}>옵션</th><th style={S.th}>입고 상품</th>
                    <th style={{ ...S.th, textAlign: 'right' }}>베이스출고</th><th style={{ ...S.th, textAlign: 'right' }}>정상입고</th>
                    <th style={{ ...S.th, textAlign: 'right' }}>불량(업체)</th><th style={{ ...S.th, textAlign: 'right' }}>추가 출고</th><th style={S.th}>메모(근거)</th><th style={S.th}></th>
                  </tr></thead>
                  <tbody>
                    {calc.list.map((r) => (
                      <tr key={r.code} style={{ background: r.manual ? '#fffbeb' : undefined }}>
                        <td style={{ ...S.td, ...S.mono }}>{r.code}</td>
                        <td style={S.td}>{r.name}{!r.inBase && !r.manual && <span style={{ color: '#b91c1c', fontSize: 11 }}> · 베이스출고 파일에 없음</span>}</td>
                        <td style={S.td}>{r.option}</td>
                        <td style={{ ...S.td, fontSize: 11, color: '#64748b' }}>{r.arts || <span style={{ color: '#dc2626' }}>입고 없음</span>}</td>
                        <td style={{ ...S.td, textAlign: 'right' }} title={`파일 값 ${r.fileShip}`}>
                          {numInput(r.ship, (v) => (v === '' || num(v) === r.fileShip) && !r.manual ? clearField('ship', r.code) : setField('ship', r.code, v), r.code in edit.ship && !r.manual)}
                        </td>
                        <td style={{ ...S.td, textAlign: 'right' }} title={`파일 값 ${r.fileRecv}`}>
                          {numInput(r.recv, (v) => (v === '' || num(v) === r.fileRecv) && !r.manual ? clearField('recv', r.code) : setField('recv', r.code, v), r.code in edit.recv && !r.manual)}
                        </td>
                        <td style={{ ...S.td, textAlign: 'right' }}>
                          <input type="number" min={0} value={edit.bad[r.code] ?? ''} placeholder="0" onChange={(e) => setField('bad', r.code, e.target.value)} style={{ ...S.qty, width: 50, color: '#b45309' }} />
                        </td>
                        <td style={{ ...S.td, textAlign: 'right', fontWeight: 800, color: r.add < 0 ? '#dc2626' : r.add > 0 ? '#0f766e' : '#94a3b8' }}>{r.add}</td>
                        <td style={S.td}>
                          <input value={r.note} placeholder="예: 원단불량 3" onChange={(e) => setField('note', r.code, e.target.value)} style={{ ...S.input, fontSize: 12, padding: '3px 6px', width: 150 }} />
                        </td>
                        <td style={S.td}>{r.manual && <button style={{ ...S.btn(false, false), fontSize: 11, padding: '2px 6px' }} onClick={() => removeExtra(r.code)}>삭제</button>}</td>
                      </tr>
                    ))}
                    <tr style={{ background: '#f8fafc' }}>
                      <td style={{ ...S.td, fontWeight: 700 }} colSpan={4}>합계 · {calc.list.length}행</td>
                      {[calc.tot.ship, calc.tot.recv, calc.tot.bad, calc.tot.add].map((v, i) => (
                        <td key={i} style={{ ...S.td, textAlign: 'right', fontWeight: 800, color: i === 3 ? '#0f766e' : '#0f172a' }}>{fmt(v)}</td>
                      ))}
                      <td style={S.td} colSpan={2}></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {calc.unmatched.length > 0 && (
                <div style={{ ...S.msg('err'), marginTop: 8 }}>
                  베이스를 찾지 못한 입고 상품 {calc.unmatched.length}건 (계산 제외): {calc.unmatched.map((u) => `${u.code} ${u.name} ${u.option} ${u.qty}장`).join(' · ')}
                </div>
              )}
              <div style={{ ...S.bar, marginTop: 10, marginBottom: 0, fontSize: 12, color: '#475569' }}>
                <b>행 추가</b> (베이스출고 파일에 없는데 실제로 나간 베이스)
                <input value={addRow.code} onChange={(e) => setAddRow((p) => ({ ...p, code: e.target.value }))} placeholder="베이스 상품코드" style={{ ...S.input, width: 120, fontSize: 12 }} />
                베이스출고 <input type="number" value={addRow.ship} onChange={(e) => setAddRow((p) => ({ ...p, ship: e.target.value }))} style={{ ...S.qty, width: 60 }} />
                정상입고 <input type="number" value={addRow.recv} onChange={(e) => setAddRow((p) => ({ ...p, recv: e.target.value }))} style={{ ...S.qty, width: 60 }} />
                <button style={{ ...S.btn(false, false), fontSize: 12, padding: '5px 10px' }} onClick={addExtra}>+ 추가</button>
                <span style={{ color: '#94a3b8' }}>· 주황 칸 = 파일 값에서 수정함 · 입력값은 이 브라우저에 차수별로 기억됩니다</span>
              </div>
            </>
          )}
        </div>
      )}

      {sel && calc && !loadingRound && (
        <div style={S.card}>
          <h3 style={{ ...S.title, marginBottom: 10 }}><span style={S.step}>3</span>엑셀 저장</h3>
          <div style={S.bar}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'inline-flex', gap: 6, alignItems: 'center' }}>메모
              <input value={memo} onChange={(e) => setMemo(e.target.value)} style={{ ...S.input, width: 300 }} />
            </label>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'inline-flex', gap: 6, alignItems: 'center' }}>파일명
              <input value={fileName} onChange={(e) => { setFileName(e.target.value); setOverArm(false); }} style={{ ...S.input, width: 280 }} />
            </label>
          </div>
          <div style={{ ...S.bar, marginBottom: 0 }}>
            <span style={{ fontSize: 12, color: '#64748b' }}>저장 위치: <b style={{ color: '#334155' }}>{sel.local ? '다운로드 폴더 (차수 폴더에 옮겨주세요)' : `${sel.vendorDir}/${sel.round}차/`}</b> · 상품코드 | 수량 | 메모 | 상품명 | 옵션 · 합계 <b style={{ color: '#0f766e' }}>{fmt(calc.tot.add)}장</b></span>
            <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              {msg && <span style={S.msg(msg.kind)}>{msg.text}</span>}
              {allZero && <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>조정할 수량이 모두 0 — 파일 생성 안 함</span>}
              {!sel.local && <button style={S.btn(false, saving || allZero)} disabled={saving || allZero} onClick={downloadOnly}>다운로드만</button>}
              <button style={{ ...S.btn(true, saving || allZero), ...(overArm ? { background: '#dc2626', borderColor: '#dc2626' } : {}) }} disabled={saving || allZero} onClick={save}>
                {saving ? '저장 중…' : sel.local ? '⬇ 엑셀 다운로드' : overArm ? '한 번 더 누르면 덮어쓰기' : '📁 공유 폴더에 저장'}
              </button>
            </span>
          </div>
        </div>
      )}
      {msg && !(sel && calc && !loadingRound) && <div style={{ ...S.msg(msg.kind), marginTop: -8, marginBottom: 12 }}>{msg.text}</div>}
    </div>
  );
}
