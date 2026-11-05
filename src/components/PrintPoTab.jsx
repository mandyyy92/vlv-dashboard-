// src/components/PrintPoTab.jsx
// 발주서 작성 — 프린팅 외주(아트웍 프린팅·나염) 업체·차수별 발주와 이지어드민 업로드용 엑셀 생성
//  1) 판매 순위: 최근 N일 판매(무신사 + MFS, 바코드 기준)로 아트웍 상품 순위 → 판매 많은 컬러만 진행
//  2) 업체 분배: print_supplier_products(업체·단가·샘플 관리) 디자인명과 상품명 매칭, 기본은 최저 단가 업체
//  3) 발주 저장(print_po / print_po_lines) + 발송요청 · 베이스출고 · 입고대기 엑셀
//  4) 입고 후 실입고수량 입력 → 정상입고 · MFS출고 · 베이스출고(추가출고) 엑셀
// 베이스 상품: 같은 group_key(바코드 앞 8자리) + B 타입 + 같은 옵션명 (예: (♥일반)후드 → 엘리멘트 후디, (☆기모)후드 → 시그니처 후디)
// inventory 등 보호 테이블은 뷰(v_option_current_stock)·읽기만 사용한다.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SUPABASE_URL, sbHeaders } from '../lib/supabaseClient';

const REST = `${SUPABASE_URL}/rest/v1`;

async function sbFetch(path, init = {}) {
  const r = await fetch(`${REST}/${path}`, { ...init, headers: { ...sbHeaders, ...(init.headers || {}) } });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text || r.statusText}`);
  return text ? JSON.parse(text) : null;
}
// PostgREST 1000행 상한 → offset 페이징 전량 조회 (path 에 order 포함할 것)
async function sbAll(path) {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const chunk = await sbFetch(`${path}&limit=1000&offset=${off}`);
    out.push(...(chunk || []));
    if (!chunk || chunk.length < 1000) break;
  }
  return out;
}

const kstDate = (d = new Date()) => new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const yymmdd = (ymd) => String(ymd || '').slice(2).replace(/-/g, '');
// KST 'YYYY-MM-DD HH:mm'
const fmtDateTime = (d) => new Date(new Date(d).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
const num = (v) => Number(v) || 0;

// SheetJS(XLSX) CDN 동적 로드 — 다른 탭과 같은 방식(의존성 추가 없음)
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
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
function downloadBlob(blob, fileName) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
// sheets: [{name, rows(2차원 배열), cols?}] · writer(blob, fileName) 가 있으면 폴더에 저장, 없으면 다운로드
async function saveXlsx(fileName, sheets, writer) {
  const XLSX = await loadXLSX();
  const wb = XLSX.utils.book_new();
  sheets.forEach(({ name, rows, cols }) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    if (cols) ws['!cols'] = cols.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  });
  const blob = new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: XLSX_MIME });
  return writer ? writer(blob, fileName) : downloadBlob(blob, fileName);
}

// ── 공유 폴더(\\…\02_나염) 바로 저장 — File System Access API (Chrome·Edge) ──
// 폴더 구조: {NN}_{업체}_발송요청/파일  ·  {NN}_{업체}_입고/{N}차/파일. 업체 폴더가 없으면 다음 번호로 새로 만든다.
const FS_SUPPORTED = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
const FOLDER_ALIAS = { 국제프린팅: ['국제나염'], 코스타컴퍼니: ['코스타'] }; // 기존 폴더 이름의 업체 표기
const idbKv = (mode, fn) => new Promise((resolve, reject) => {
  const open = indexedDB.open('printpo-fs', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('kv');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const tx = open.result.transaction('kv', mode);
    const req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  };
});
const idbGet = (k) => idbKv('readonly', (s) => s.get(k)).catch(() => null);
const idbSet = (k, v) => idbKv('readwrite', (s) => s.put(v, k)).catch(() => null);

async function ensurePermission(handle) {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}
// 업체 폴더 찾기/만들기 — suffix: '발송요청' | '입고'
async function supplierDir(root, supplier, suffix) {
  const bare = supplier.replace(/\(.*?\)/g, '').trim(); // '코스타컴퍼니(나염)' → '코스타컴퍼니' (이름 변경 전 저장된 발주)
  const keys = [...new Set([supplier, bare, ...[supplier, bare].flatMap((s) => [...(VENDOR_ALIAS[s] || []), ...(FOLDER_ALIAS[s] || [])])].filter(Boolean))];
  let found = null, sameSupplierNo = null, maxNo = 0;
  for await (const [name, h] of root.entries()) {
    if (h.kind !== 'directory') continue;
    const no = Number((name.match(/^(\d+)_/) || [])[1]) || 0;
    maxNo = Math.max(maxNo, no);
    if (!keys.some((k) => name.includes(k))) continue;
    if (no) sameSupplierNo = no;
    if (name.endsWith(`_${suffix}`)) found = h;
  }
  if (found) return found;
  const no = String(sameSupplierNo || maxNo + 1).padStart(2, '0');
  return root.getDirectoryHandle(`${no}_${supplier}_${suffix}`, { create: true });
}
async function writeFile(dir, fileName, blob) {
  const fh = await dir.getFileHandle(fileName, { create: true });
  const w = await fh.createWritable();
  await w.write(blob);
  await w.close();
}

// ── 발송요청(업체 전달용) 서식 엑셀: ExcelJS — 테두리·초록 헤더·셀 병합·이미지 ──
async function loadExcelJS() {
  if (typeof window.ExcelJS === 'undefined') {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
      s.onload = res;
      s.onerror = () => rej(new Error('ExcelJS 로드 실패'));
      document.head.appendChild(s);
    });
  }
  return window.ExcelJS;
}
// 상품 이미지 → base64. 이미지 서버에 CORS 가 없어 /api/img 프록시(Vercel)를 거친다. 실패하면 이미지 없이 진행.
async function fetchImageB64(url) {
  if (!url) return null;
  try {
    const r = await fetch(`/api/img?u=${encodeURIComponent(url)}`);
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !type.startsWith('image/')) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { base64: btoa(bin), extension: type.includes('png') ? 'png' : type.includes('gif') ? 'gif' : 'jpeg' };
  } catch (e) {
    return null;
  }
}
const XL_GREEN = 'FFE2EFDA';
const XL_FONT = { name: '맑은 고딕', size: 10 };
const xlThin = { style: 'thin', color: { argb: 'FF8C8C8C' } };
const xlMedium = { style: 'medium', color: { argb: 'FF595959' } };
// groups: [{image, rows}] — 그룹 단위로 mergeCols(0-based) 세로 병합, 첫 열에 이미지
async function addStyledSheet(wb, { name, headers, widths, groups, total, mergeCols }) {
  const ws = wb.addWorksheet(name);
  ws.columns = widths.map((width) => ({ width }));
  const n = headers.length;
  const styleRow = (r, { bold = false, fill = false, top = xlThin, bottom = xlThin } = {}) => {
    for (let c = 1; c <= n; c++) {
      const cell = ws.getCell(r, c);
      cell.font = { ...XL_FONT, bold };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = { top, bottom, left: xlThin, right: xlThin };
      if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL_GREEN } };
    }
  };
  ws.addRow(headers).height = 22;
  styleRow(1, { bold: true, fill: true, bottom: xlMedium });
  const imgs = await Promise.all(groups.map((g) => fetchImageB64(g.image)));
  groups.forEach((g, gi) => {
    const start = ws.rowCount + 1;
    const h = Math.max(20, Math.ceil(52 / g.rows.length)); // 이미지(약 60px)가 들어갈 높이 확보
    g.rows.forEach((vals) => { ws.addRow(vals).height = h; });
    const end = ws.rowCount;
    for (let r = start; r <= end; r++) styleRow(r);
    if (end > start) mergeCols.forEach((c) => ws.mergeCells(start, c + 1, end, c + 1));
    if (imgs[gi]) {
      // 병합 칸 정가운데 — 픽셀로 계산해 EMU(1px = 9525) 오프셋으로 지정
      const EMU = 9525;
      const colPx = Math.round(widths[0] * 7 + 5);          // 엑셀 열 너비(문자) → 픽셀
      const rowPx = (h * 96) / 72;                          // 행 높이(pt) → 픽셀
      const size = Math.min(60, Math.floor(rowPx * g.rows.length) - 8, colPx - 8);
      const top = (rowPx * g.rows.length - size) / 2;
      const rowIdx = Math.min(g.rows.length - 1, Math.floor(top / rowPx));
      const id = wb.addImage(imgs[gi]);
      ws.addImage(id, {
        tl: { nativeCol: 0, nativeColOff: Math.round(((colPx - size) / 2) * EMU), nativeRow: start - 1 + rowIdx, nativeRowOff: Math.round((top - rowIdx * rowPx) * EMU) },
        ext: { width: size, height: size },
        editAs: 'oneCell',
      });
    }
  });
  if (total) {
    ws.addRow(total).height = 20;
    styleRow(ws.rowCount, { bold: true, fill: true, top: xlMedium });
  }
}
async function saveStyledXlsx(fileName, sheets, writer) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  for (const sh of sheets) await addStyledSheet(wb, sh);
  const blob = new Blob([await wb.xlsx.writeBuffer()], { type: XLSX_MIME });
  return writer ? writer(blob, fileName) : downloadBlob(blob, fileName);
}

// 옵션 "[화이트/블랙-M]" → {color:"화이트/블랙", size:"M"}
const splitOption = (opt) => {
  const s = String(opt || '').trim().replace(/^\[/, '').replace(/\]$/, '');
  const i = s.lastIndexOf('-');
  return i < 0 ? { color: s, size: '' } : { color: s.slice(0, i), size: s.slice(i + 1) };
};
const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', 'FREE', 'F', 'OS'];
const sizeRank = (size) => {
  const s = String(size || '').toUpperCase();
  const inner = (s.match(/\(([^)]+)\)/) || [])[1] || s;
  const i = SIZE_ORDER.indexOf(inner);
  return i < 0 ? 99 : i;
};

// 업체·단가·샘플 관리 디자인명("044 레글런", "Prompt 후드", "Chaser 링거 반팔") ↔ 아트웍 상품명("상의-레글런 044") 매칭
// 디자인명 = 아트웍 이름 단어 + 종류 단어. 아트웍 이름 단어는 상품명 단어와 정확히 일치, 종류 단어는 하나 이상 포함.
const TYPE_WORDS = ['후드', '집업', '레글런', '롱슬리브', '링거', '반팔', '맨투맨', '에코백', '볼캡', '피그먼트', '에센셜', 'w.슬림', '우먼', '버뮤다', '팬츠', '재단물'];
const nameWords = (name) => String(name || '').toLowerCase().split(/[\s\-()♥☆★_/]+/).filter(Boolean);
const parseDesign = (designName) => {
  const words = nameWords(String(designName || '').replace(/\([^)]*\)/g, ' '));
  const types = words.filter((w) => TYPE_WORDS.includes(w));
  const arts = words.filter((w) => !TYPE_WORDS.includes(w) && !/^\d$/.test(w));
  return { types, arts };
};
const designMatches = (design, productName) => {
  if (!design.arts.length) return false;
  const pw = nameWords(productName);
  const lower = String(productName || '').toLowerCase();
  return design.arts.every((a) => pw.includes(a)) && (!design.types.length || design.types.some((t) => lower.includes(t)));
};

// 시즌 필터 — 봄·가을·겨울(P·F·W) / 여름(S), 사계절(A)은 양쪽 모두 포함. 기본값은 현재 달 기준(6~8월 여름, 그 외 봄·가을·겨울)
const SEASON_SETS = {
  fw: { label: '봄·가을·겨울', codes: ['P', 'F', 'W', 'A'] },
  ss: { label: '여름', codes: ['S', 'A'] },
  all: { label: '전체', codes: null },
};
const defaultSeasonSet = () => { const m = new Date().getMonth() + 1; return m >= 6 && m <= 8 ? 'ss' : 'fw'; };

// 사이즈별 숫자 색 — 범례 칩과 같은 색으로 짝지음 (베이스 부족은 빨강이 우선)
const NUM_COLOR = {
  // 두 가지 색: 판매(수요) = 블루그레이 / 재고 3종(입고대기·MFS·베이스) = 세이지 그린 진하기 차이
  sold: { fg: '#1e3a5f', bg: '#d5dfec' },     // 판매
  incoming: { fg: '#2f5d50', bg: '#d9eae3' }, // 입고대기
  mfs: { fg: '#46786a', bg: '#e5f0eb' },      // MFS
  base: { fg: '#6b9286', bg: '#f0f6f3' },     // 베이스
};

// 시트(sheet_print_orders) 업체명이 업체·단가 관리와 다른 경우 — 차수 추천용
const VENDOR_ALIAS = { 국제프린팅: ['국제프린팅', '국제나염'], 코스타컴퍼니: ['코스타컴퍼니', '코스타컴퍼니(나염)'] };

const S = {
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 16 },
  title: { fontSize: 15, fontWeight: 700, color: '#0f172a', margin: 0 },
  bar: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 },
  input: { fontSize: 13, padding: '6px 9px', border: '1px solid #d1d5db', borderRadius: 8, minWidth: 0 },
  qty: { width: 56, fontSize: 12, padding: '3px 5px', border: '1px solid #cbd5e1', borderRadius: 5, textAlign: 'right', fontWeight: 700, color: '#0f766e' },
  btn: (primary, disabled) => ({
    fontSize: 13, padding: '7px 12px', borderRadius: 8, cursor: disabled ? 'not-allowed' : 'pointer',
    border: `1px solid ${primary ? '#4f46e5' : '#d1d5db'}`, background: primary ? '#4f46e5' : '#fff', color: primary ? '#fff' : '#111827',
    fontWeight: primary ? 700 : 500, opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap',
  }),
  tableWrap: { overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
  th: { textAlign: 'left', padding: '7px 8px', background: '#f9fafb', color: '#475569', fontWeight: 600, borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' },
  td: { padding: '6px 8px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle' },
  mono: { fontFamily: 'ui-monospace,Menlo,Consolas,monospace', fontSize: 11.5 },
  msg: (kind) => ({ fontSize: 13, fontWeight: 600, color: kind === 'ok' ? '#15803d' : kind === 'err' ? '#b91c1c' : '#64748b' }),
  empty: { textAlign: 'center', padding: 32, color: '#94a3b8' },
  step: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 99, background: '#4f46e5', color: '#fff', fontSize: 12, fontWeight: 800, marginRight: 8 },
};

// ── 4) 베이스 재고 추가 조정: 발송요청 파일 + 입고(조정) 파일 업로드 비교 ──
// 파일명용 업체 약칭: '코스타컴퍼니(나염)' → '코스타'
const shortSupplier = (s) => String(s || '').replace(/\(.*?\)/g, '').replace(/컴퍼니$/, '').trim();
const normHead = (v) => String(v ?? '').replace(/\s/g, '');
const isCode = (v) => /^[A-Z]\d{3,}$/i.test(String(v ?? '').trim());
// 시트 중 필요한 헤더가 모두 있는 표 찾기 → [{헤더: 값}] (병합으로 빈 상품명은 위 값으로 채움)
async function readTable(file, required, prefer = []) {
  const XLSX = await loadXLSX();
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  let best = null;
  wb.SheetNames.forEach((sn) => {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const heads = rows[i].map(normHead);
      if (!required.every((h) => heads.includes(h))) continue;
      const score = prefer.filter((h) => heads.includes(h)).length;
      if (!best || score > best.score) best = { rows, hi: i, heads, score };
      break;
    }
  });
  if (!best) return null;
  const out = [];
  let lastName = '';
  best.rows.slice(best.hi + 1).forEach((r) => {
    const o = {};
    best.heads.forEach((h, j) => { if (h && !(h in o)) o[h] = r[j]; });
    if (o['상품명']) lastName = String(o['상품명']).trim(); else o['상품명'] = lastName;
    out.push(o);
  });
  return out;
}
// 파일명에서 차수·업체: '12차_국제나염_발송요청_261020.xlsx'
const guessFromName = (name) => {
  const n = String(name || '');
  const round = (n.match(/(\d+)\s*차/) || [])[1] || '';
  const sup = (n.replace(/\.[^.]+$/, '').split('_').find((t) => t && !/\d+\s*차|발송요청|입고|^\d+$/.test(t)) || '').trim();
  return { round, sup };
};

function BaseAdjustUpload({ stock, baseIndex, suppliers, makeWriter, whereText, flash, rootDir }) {
  const [reqFile, setReqFile] = useState(null);
  const [recvFile, setRecvFile] = useState(null);
  const [round, setRound] = useState('');
  const [sup, setSup] = useState('');
  const [result, setResult] = useState(null); // {rows, unmatched}
  const [putOver, setPutOver] = useState({});  // {baseCode: 수동 수정}
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const stockByCode = useMemo(() => {
    const m = new Map();
    stock.forEach((r) => { if (r['상품코드']) m.set(String(r['상품코드']).trim(), r); });
    return m;
  }, [stock]);

  const pickReq = (f) => {
    setReqFile(f); setResult(null); setErr('');
    if (f) { const g = guessFromName(f.name); if (g.round) setRound(g.round); if (g.sup) setSup(shortSupplier(g.sup)); }
  };
  const pickRecv = (f) => {
    setRecvFile(f); setResult(null); setErr('');
    if (f && !round) { const g = guessFromName(f.name); if (g.round) setRound(g.round); }
  };

  const compare = async () => {
    if (!reqFile || !recvFile) { setErr('파일 2개를 모두 올려주세요'); return; }
    setBusy(true); setErr('');
    try {
      const req = await readTable(reqFile, ['베이스상품코드', '옵션'], ['1차출고', '수량']);
      if (!req) throw new Error('① 발송요청 파일에서 "베이스 상품코드" 표를 찾지 못했습니다');
      const recv = await readTable(recvFile, ['상품코드', '옵션', '조정'], ['불량', '의뢰수량']);
      if (!recv) throw new Error('② 입고 파일에서 "상품코드 · 옵션 · 조정" 표를 찾지 못했습니다');
      // 베이스(발송요청) — 1차 + 2차 출고, 둘 다 비면 수량
      const bases = new Map();
      req.forEach((r) => {
        const code = String(r['베이스상품코드'] ?? '').trim();
        if (!isCode(code)) return;
        const shipped = num(r['1차출고']) + num(r['2차출고']);
        const ship = shipped || num(r['수량']);
        if (!bases.has(code)) bases.set(code, { code, name: String(r['상품명'] || '').trim(), option: String(r['옵션'] || '').trim(), ship: 0, recv: 0, bad: 0, arts: [], artNames: new Set() });
        bases.get(code).ship += ship;
      });
      // 입고(아트웍) → 재고의 group_key + 같은 옵션 B 상품 = 베이스
      const unmatched = [];
      recv.forEach((r) => {
        const code = String(r['상품코드'] ?? '').trim();
        if (!isCode(code)) return;
        const adj = num(r['조정']), bad = num(r['불량']);
        const st = stockByCode.get(code);
        const base = st ? baseIndex.get(`${st.group_key}|${String(st['옵션'] || '').trim()}`) : null;
        const bcode = base ? String(base['상품코드']).trim() : '';
        if (!bcode) { unmatched.push({ code, name: r['상품명'], option: r['옵션'], adj, bad, why: st ? '베이스 상품 없음' : '재고에 상품코드 없음' }); return; }
        if (!bases.has(bcode)) bases.set(bcode, { code: bcode, name: base['상품명'], option: base['옵션'], ship: 0, recv: 0, bad: 0, arts: [], artNames: new Set(), notInReq: true });
        const b = bases.get(bcode);
        b.recv += adj; b.bad += bad; b.arts.push(code); b.artNames.add(String(r['상품명'] || '').trim());
      });
      setResult({ rows: [...bases.values()].map((b) => ({ ...b, artNames: [...b.artNames].join(', ') })), unmatched });
      setPutOver({});
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const leftOf = (b) => b.ship - b.recv - b.bad;
  const putOf = (b) => (b.code in putOver ? num(putOver[b.code]) : Math.max(0, leftOf(b)));
  const noteOf = (b) => {
    const left = leftOf(b);
    if (b.notInReq) return '발송요청 파일에 없는 베이스';
    if (left < 0) return `${-left}장 초과 입고 — 추가 차감 없음`;
    if (b.ship && !b.recv) return '입고 없음 — 업체 잔여 확인';
    if (left >= 20 && left >= b.ship / 2) return `${left}장 부족 — 업체 잔여 확인`;
    return '';
  };

  const download = async () => {
    if (!result) return;
    const N = String(round).trim(), s = sup.trim();
    if (!N || !s) { setErr('차수와 업체를 입력해주세요'); return; }
    if (rootDir) await ensurePermission(rootDir).catch(() => false);
    setBusy(true);
    try {
      const ExcelJS = await loadExcelJS();
      const wb = new ExcelJS.Workbook();
      const thin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
      const border = { top: thin, left: thin, bottom: thin, right: thin };
      const green = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
      const blue = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
      const d6 = yymmdd(kstDate());
      const memo = `${d6}_${s}_베이스입고(추가)_${N}차`;
      const rows = result.rows;
      const ws = wb.addWorksheet('베이스 재고 입력');
      ws.mergeCells('A1:K1');
      ws.getCell('A1').value = `${s} ${N}차 — 어드민 베이스 재고 입력 수량 (${d6})`;
      ws.getCell('A1').font = { bold: true, size: 14 };
      ws.mergeCells('A2:K2');
      ws.getCell('A2').value = '1차 출고는 어드민에서 이미 차감됨 · 어드민에 넣을 수량 = 1차 출고 − 조정(입고) − 불량 (0 미만이면 0, 추가 차감 없음)';
      ws.getCell('A2').font = { size: 10, color: { argb: 'FF64748B' } };
      const h = ws.getRow(4);
      h.values = ['베이스 상품코드', '베이스 상품명', '옵션', '입고 상품코드', '입고 상품명', '1차 출고(차감완료)', '조정(입고)', '불량', '남은 베이스', '어드민에 넣을 수량', '비고'];
      h.height = 30;
      h.eachCell((c) => { c.font = { bold: true }; c.fill = green; c.border = border; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
      rows.forEach((b, i) => {
        const n = 5 + i, left = leftOf(b), put = putOf(b), note = noteOf(b);
        const manual = b.code in putOver;
        const row = ws.getRow(n);
        row.values = [b.code, b.name, b.option, b.arts.join(', '), b.artNames, b.ship, b.recv, b.bad || null,
          { formula: `F${n}-G${n}-H${n}`, result: left },
          manual ? put : { formula: `MAX(0,I${n})`, result: put },
          manual ? [note, '수동 수정'].filter(Boolean).join(' · ') : note];
        row.eachCell({ includeEmpty: true }, (c) => { c.border = border; c.alignment = { vertical: 'middle', horizontal: 'center' }; });
        [6, 7, 8, 9, 10].forEach((c) => { row.getCell(c).numFmt = '#,##0;[Red]-#,##0'; });
        row.getCell(10).font = { bold: true };
        if (put > 0) row.getCell(10).fill = blue;
        if (note) { row.getCell(11).font = { color: { argb: 'FFC00000' }, size: 10 }; row.getCell(11).alignment = { horizontal: 'left', vertical: 'middle' }; }
      });
      const last = 4 + rows.length, t = last + 1;
      const tr = ws.getRow(t);
      const tot = (k) => rows.reduce((a, b) => a + k(b), 0);
      tr.values = ['합 계', '', '', '', '',
        { formula: `SUM(F5:F${last})`, result: tot((b) => b.ship) }, { formula: `SUM(G5:G${last})`, result: tot((b) => b.recv) },
        { formula: `SUM(H5:H${last})`, result: tot((b) => b.bad) }, { formula: `SUM(I5:I${last})`, result: tot(leftOf) },
        { formula: `SUM(J5:J${last})`, result: tot(putOf) }, ''];
      ws.mergeCells(`A${t}:E${t}`);
      tr.eachCell({ includeEmpty: true }, (c) => { c.font = { bold: true }; c.fill = green; c.border = border; c.alignment = { horizontal: 'center' }; c.numFmt = '#,##0;[Red]-#,##0'; });
      if (result.unmatched.length) {
        const u0 = t + 2;
        ws.getCell(`A${u0}`).value = '베이스를 찾지 못한 입고 상품 (계산 제외)';
        ws.getCell(`A${u0}`).font = { bold: true, color: { argb: 'FFC00000' } };
        result.unmatched.forEach((u, i) => { ws.getRow(u0 + 1 + i).values = ['', '', u.option, u.code, u.name, '', u.adj, u.bad || null, '', '', u.why]; });
      }
      [14, 20, 12, 14, 26, 12, 11, 8, 10, 12, 34].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
      ws.views = [{ state: 'frozen', ySplit: 4 }];
      const ws2 = wb.addWorksheet('어드민 입력용');
      ws2.getRow(1).values = ['베이스 상품코드', '상품명', '옵션', '입력 수량', '메모'];
      ws2.getRow(1).eachCell((c) => { c.font = { bold: true }; c.fill = green; c.border = border; c.alignment = { horizontal: 'center' }; });
      let k = 2;
      rows.forEach((b) => {
        const put = putOf(b);
        if (put <= 0) return;
        const r = ws2.getRow(k++);
        r.values = [b.code, b.name, b.option, put, memo];
        r.eachCell((c) => { c.border = border; c.alignment = { horizontal: 'center' }; });
      });
      const tt = ws2.getRow(k);
      tt.values = ['합 계', '', '', { formula: `SUM(D2:D${Math.max(2, k - 1)})`, result: tot(putOf) }, ''];
      tt.eachCell({ includeEmpty: true }, (c) => { c.font = { bold: true }; c.fill = green; c.border = border; c.alignment = { horizontal: 'center' }; });
      [14, 22, 14, 10, 34].forEach((w, i) => { ws2.getColumn(i + 1).width = w; });
      const blob = new Blob([await wb.xlsx.writeBuffer()], { type: XLSX_MIME });
      // 폴더 저장: 업체 약칭 → 등록 업체명(폴더 찾기용)
      const full = (suppliers.find((x) => shortSupplier(x.name) === s || x.name === s) || {}).name || s;
      const path = await makeWriter(full, '입고', N)(blob, `${N}차_베이스입고(추가)_${s}.xlsx`);
      flash('ok', `${N}차_베이스입고(추가)_${s} · ${tot(putOf).toLocaleString()}장 · ${whereText([path])}`);
    } catch (e) {
      flash('err', `엑셀 생성 실패 — ${String(e.message || e).slice(0, 80)}`);
    } finally {
      setBusy(false);
    }
  };

  const fileBox = (label, file, onPick, hint) => (
    <label style={{ flex: '1 1 260px', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', border: `1px dashed ${file ? '#14b8a6' : '#cbd5e1'}`, borderRadius: 8, background: file ? '#f0fdfa' : '#f8fafc', cursor: 'pointer', fontSize: 12 }}>
      <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={(e) => { onPick(e.target.files?.[0] || null); e.target.value = ''; }} />
      <b style={{ color: '#0f766e', whiteSpace: 'nowrap' }}>{label}</b>
      <span style={{ color: file ? '#0f172a' : '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file ? file.name : hint}</span>
    </label>
  );

  const rows = result?.rows || [];
  const sum = rows.reduce((a, b) => ({ ship: a.ship + b.ship, recv: a.recv + b.recv, bad: a.bad + b.bad, left: a.left + leftOf(b), put: a.put + putOf(b) }), { ship: 0, recv: 0, bad: 0, left: 0, put: 0 });

  return (
    <div style={{ border: '1px solid #99f6e4', borderRadius: 10, padding: 12, marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        {fileBox('① 발송요청', reqFile, pickReq, '베이스 상품코드 · 1차 출고 있는 파일')}
        {fileBox('② 입고', recvFile, pickRecv, '상품코드 · 조정 · 불량 있는 파일')}
      </div>
      <div style={{ ...S.bar, marginBottom: 0 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>차수
          <input value={round} onChange={(e) => setRound(e.target.value.replace(/\D/g, ''))} style={{ ...S.input, width: 50, margin: '0 4px' }} />차
        </label>
        <label style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>업체
          <input value={sup} onChange={(e) => setSup(e.target.value)} placeholder="코스타" style={{ ...S.input, width: 110, marginLeft: 4 }} />
        </label>
        <span style={{ fontSize: 12, color: '#64748b' }}>파일명: <b style={{ color: '#334155' }}>{round || 'N'}차_베이스입고(추가)_{sup || '업체'}.xlsx</b></span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
          <button style={S.btn(false, busy)} disabled={busy} onClick={compare}>{busy && !result ? '비교 중…' : '비교하기'}</button>
          {result && <button style={S.btn(true, busy)} disabled={busy} onClick={download}>엑셀 생성 ({sum.put.toLocaleString()}장)</button>}
        </span>
      </div>
      {err && <div style={{ ...S.msg('err'), marginTop: 8 }}>{err}</div>}
      {result && (
        <div style={{ marginTop: 10 }}>
          <div style={{ ...S.tableWrap, maxHeight: 460, overflowY: 'auto' }}>
            <table style={S.table}>
              <thead><tr>
                <th style={S.th}>베이스 코드</th><th style={S.th}>베이스 상품</th><th style={S.th}>옵션</th><th style={S.th}>입고 상품</th>
                <th style={{ ...S.th, textAlign: 'right' }}>1차 출고</th><th style={{ ...S.th, textAlign: 'right' }}>조정(입고)</th>
                <th style={{ ...S.th, textAlign: 'right' }}>불량</th><th style={{ ...S.th, textAlign: 'right' }}>남은 베이스</th>
                <th style={{ ...S.th, textAlign: 'right' }}>어드민에 넣을 수량</th><th style={S.th}>비고</th>
              </tr></thead>
              <tbody>
                {rows.map((b) => {
                  const left = leftOf(b);
                  return (
                    <tr key={b.code}>
                      <td style={{ ...S.td, ...S.mono }}>{b.code}</td>
                      <td style={S.td}>{b.name}</td>
                      <td style={S.td}>{b.option}</td>
                      <td style={{ ...S.td, fontSize: 11, color: '#64748b' }}>{b.arts.join(', ')}</td>
                      <td style={{ ...S.td, textAlign: 'right' }}>{b.ship.toLocaleString()}</td>
                      <td style={{ ...S.td, textAlign: 'right' }}>{b.recv.toLocaleString()}</td>
                      <td style={{ ...S.td, textAlign: 'right', color: b.bad ? '#b45309' : '#cbd5e1' }}>{b.bad || '-'}</td>
                      <td style={{ ...S.td, textAlign: 'right', fontWeight: 700, color: left < 0 ? '#dc2626' : '#334155' }}>{left}</td>
                      <td style={{ ...S.td, textAlign: 'right' }}>
                        <input type="number" min={0} value={putOf(b)} onChange={(e) => setPutOver((s) => ({ ...s, [b.code]: e.target.value }))} style={S.qty} />
                      </td>
                      <td style={{ ...S.td, fontSize: 11, color: '#b91c1c' }}>{noteOf(b)}</td>
                    </tr>
                  );
                })}
                <tr style={{ background: '#f8fafc' }}>
                  <td style={{ ...S.td, fontWeight: 700 }} colSpan={4}>합계</td>
                  {[sum.ship, sum.recv, sum.bad, sum.left, sum.put].map((v, i) => (
                    <td key={i} style={{ ...S.td, textAlign: 'right', fontWeight: 800, color: i === 4 ? '#0f766e' : '#0f172a' }}>{v.toLocaleString()}</td>
                  ))}
                  <td style={S.td}></td>
                </tr>
              </tbody>
            </table>
          </div>
          {result.unmatched.length > 0 && (
            <div style={{ ...S.msg('err'), marginTop: 8 }}>
              베이스를 찾지 못한 입고 상품 {result.unmatched.length}건 (계산 제외): {result.unmatched.map((u) => `${u.code} ${u.option} (${u.why})`).join(' · ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function PrintPoTab() {
  const [stock, setStock] = useState([]);        // v_option_current_stock
  const [designs, setDesigns] = useState([]);    // print_supplier_products + 업체명
  const [suppliers, setSuppliers] = useState([]);
  const [sales, setSales] = useState({});        // {barcode: qty}
  const [pos, setPos] = useState([]);            // print_po (+lines)
  const [sheetRounds, setSheetRounds] = useState({}); // {vendor: maxRound}
  const [loading, setLoading] = useState(true);
  const [salesLoading, setSalesLoading] = useState(false);
  const [error, setError] = useState('');
  const [poMissing, setPoMissing] = useState(false);
  const [seasonSet, setSeasonSet] = useState(defaultSeasonSet); // 판매 순위 시즌 필터
  const [minSold, setMinSold] = useState(100);   // 판매 기간 판매량이 이 수 이상인 상품만
  const [images, setImages] = useState({});      // {상품코드: 이미지URL}
  const [mfs, setMfs] = useState(null);        // {barcode: {avail, incoming, defect}} · null = 뷰 없음
  const [reloadKey, setReloadKey] = useState(0); // 새로고침 버튼 — 재고·판매·발주 다시 불러오기
  const [refreshing, setRefreshing] = useState(false);
  const [loadedAt, setLoadedAt] = useState(null); // 리스트 생성(불러온) 시각

  const [days, setDays] = useState(30);
  const [targetDays, setTargetDays] = useState(30);
  const [q, setQ] = useState('');
  const [showN, setShowN] = useState(20);
  const [baseLimit, setBaseLimit] = useState(true);      // 베이스 재고 한도 적용(초과분 줄이고 재고 0 이면 제외)
  const [baseIncoming, setBaseIncoming] = useState(false); // 베이스 입고대기 수량도 한도에 포함

  const [picked, setPicked] = useState({});      // {productName: true}
  const [supplierOf, setSupplierOf] = useState({}); // {productName: supplierId}
  const [colorOn, setColorOn] = useState({});    // {`${product}|${color}`: bool}
  const [qtyOf, setQtyOf] = useState({});        // {artworkCode: number|string}
  const [meta, setMeta] = useState({});          // {supplierId: {round_no, order_date}}
  const [saving, setSaving] = useState(false);

  const [openPo, setOpenPo] = useState(null);    // 입고 처리 중 po id
  const [viewPo, setViewPo] = useState(null);    // 옵션별 발주 수량 펼친 po id
  const [rootDir, setRootDir] = useState(null);  // 엑셀 저장 폴더(02_나염) 핸들 — 브라우저(IndexedDB)에 기억
  useEffect(() => { if (FS_SUPPORTED) idbGet('root').then((h) => { if (h) setRootDir(h); }); }, []);
  const [recvQty, setRecvQty] = useState({});    // {lineId: value}
  const [recvDate, setRecvDate] = useState(kstDate());
  const [adjPo, setAdjPo] = useState(null);      // 4) 베이스 재고 조정 펼친 po id
  const [defectOf, setDefectOf] = useState({});  // {lineId: 불량}
  const [putOf, setPutOf] = useState({});        // {lineId: 어드민에 넣을 수량 수동 수정}
  const [delArm, setDelArm] = useState(null);

  const [msg, setMsg] = useState(null);
  const msgTimer = useRef(null);
  const delTimer = useRef(null);
  useEffect(() => () => { clearTimeout(msgTimer.current); clearTimeout(delTimer.current); }, []);
  const flash = (kind, text) => {
    clearTimeout(msgTimer.current);
    setMsg({ kind, text });
    msgTimer.current = setTimeout(() => setMsg(null), 3000);
  };

  const loadPos = useCallback(async () => {
    try {
      const rows = await sbFetch('print_po?select=*,print_po_lines(*)&order=created_at.desc&limit=200');
      setPos(rows || []);
      setPoMissing(false);
    } catch (e) {
      setPos([]);
      setPoMissing(true);
    }
  }, []);

  // 재고 · 업체 · 단가 · 시트 차수 (1회)
  useEffect(() => {
    (async () => {
      if (reloadKey === 0) setLoading(true); else setRefreshing(true); // 새로고침은 화면 유지
      setError('');
      try {
        const [st, sup, psp, sheet, mfsRows, invImg, oldImg] = await Promise.all([
          sbAll('v_option_current_stock?select=group_key,option_key,ba_flag,바코드,상품명,옵션,가용재고,입고대기,상품코드&order=상품코드.asc,옵션.asc'),
          sbFetch('print_suppliers?select=id,name,active&order=name.asc'),
          sbFetch('print_supplier_products?select=id,supplier_id,design_name,unit_cost,sample_status&limit=2000'),
          sbAll('sheet_print_orders?select=vendor,order_round&order=row_key.asc').catch(() => []),
          // MFS 최신 재고(뷰 v_mfs_stock_latest) — 없으면 MFS 줄 없이 동작
          sbAll('v_mfs_stock_latest?select=barcode,avail,incoming,defect&order=barcode.asc').catch(() => null),
          // 상품 이미지: inventory 최신 스냅샷 뷰 우선, 없으면 product_images(보관본)
          sbAll('v_inventory_image_latest?select=product_code,image_url&order=product_code.asc').catch(() => []),
          sbAll('product_images?select=상품코드,이미지url&order=상품코드.asc').catch(() => []),
        ]);
        const img = {};
        (oldImg || []).forEach((r) => { if (r['이미지url']) img[r['상품코드']] = r['이미지url']; });
        (invImg || []).forEach((r) => { if (r.image_url) img[r.product_code] = r.image_url; });
        setImages(img);
        setStock(st || []);
        setMfs(mfsRows ? Object.fromEntries(mfsRows.map((r) => [r.barcode, { avail: num(r.avail), incoming: num(r.incoming), defect: num(r.defect) }])) : null);
        setSuppliers((sup || []).filter((s) => s.active !== false));
        const nameById = new Map((sup || []).map((s) => [String(s.id), s.name]));
        setDesigns((psp || []).map((d) => ({ ...d, supplier_name: nameById.get(String(d.supplier_id)) || '', ...parseDesign(d.design_name) })));
        const sr = {};
        (sheet || []).forEach((r) => { const v = String(r.vendor || ''); sr[v] = Math.max(sr[v] || 0, num(r.order_round)); });
        setSheetRounds(sr);
      } catch (e) {
        setError(e.message || String(e));
      } finally {
        setLoading(false);
        setRefreshing(false);
        setLoadedAt(new Date());
      }
    })();
    loadPos();
  }, [loadPos, reloadKey]);

  // 최근 N일 판매 — 이지어드민 전체 판매처(배송·송장·접수·발주, 협찬 제외) + MFS(결제오류·환불/교환 클레임 제외)
  useEffect(() => {
    let alive = true;
    (async () => {
      setSalesLoading(true);
      try {
        const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
        const M = encodeURIComponent('MUSINSA Detailed Order');
        const [mu, mf] = await Promise.all([
          sbAll(`${M}?select=바코드,상품수량,주문수량,판매처&주문일=gte.${since}&상태=in.(배송,송장,접수,발주)&order=id.asc`),
          sbAll(`mfs_sales?select=barcode,quantity,order_status,claim_status&sale_date=gte.${since}&order=id.asc`),
        ]);
        const m = {};
        // 이지어드민 전체 판매처 합산 — 협찬(VDP_협찬)은 판매가 아니므로 제외 (판매처 빈 값은 포함)
        (mu || []).forEach((r) => {
          const b = r['바코드'];
          if (!b || String(r['판매처'] || '').includes('협찬')) return;
          m[b] = (m[b] || 0) + (num(r['상품수량']) || num(r['주문수량']));
        });
        (mf || []).forEach((r) => {
          if (!r.barcode || r.order_status === '결제오류') return;
          if (r.claim_status && r.claim_status !== '클레임무효') return;
          m[r.barcode] = (m[r.barcode] || 0) + num(r.quantity);
        });
        if (alive) { setSales(m); setLoadedAt(new Date()); }
      } catch (e) {
        if (alive) flash('err', '판매 데이터를 불러오지 못했습니다');
      } finally {
        if (alive) setSalesLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [days, reloadKey]);

  // 베이스 찾기: group_key + B + 같은 옵션명
  const baseIndex = useMemo(() => {
    const m = new Map();
    stock.forEach((r) => { if (r.ba_flag === 'B') m.set(`${r.group_key}|${String(r['옵션'] || '').trim()}`, r); });
    return m;
  }, [stock]);

  // 아트웍 상품(상품명) 단위로 묶고, 매칭되는 업체 디자인이 있는 것만 후보
  const products = useMemo(() => {
    const byName = new Map();
    stock.forEach((r) => {
      if (r.ba_flag !== 'A') return;
      const name = r['상품명'] || '';
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(r);
    });
    const out = [];
    byName.forEach((rows, name) => {
      const cands = designs.filter((d) => designMatches(d, name));
      if (!cands.length) return;
      const options = rows.map((r) => {
        const { color, size } = splitOption(r['옵션']);
        const base = baseIndex.get(`${r.group_key}|${String(r['옵션'] || '').trim()}`) || null;
        return {
          code: r['상품코드'], barcode: r['바코드'], option: r['옵션'], color, size,
          sold: sales[r['바코드']] || 0, stock: num(r['가용재고']), incoming: num(r['입고대기']), base,
          mfs: mfs ? (mfs[r['바코드']] || { avail: 0, incoming: 0, defect: 0 }) : null,
        };
      });
      const colors = new Map();
      options.forEach((o) => {
        if (!colors.has(o.color)) colors.set(o.color, { color: o.color, sold: 0, options: [] });
        const c = colors.get(o.color);
        c.sold += o.sold;
        c.options.push(o);
      });
      const colorList = [...colors.values()].sort((a, b) => b.sold - a.sold);
      colorList.forEach((c) => c.options.sort((a, b) => sizeRank(a.size) - sizeRank(b.size)));
      // 업체 후보: 승인완료 · 단가 낮은 순(0 은 뒤로)
      const sup = [...cands].sort((a, b) => (a.sample_status === '승인완료' ? 0 : 1) - (b.sample_status === '승인완료' ? 0 : 1)
        || (num(a.unit_cost) || 1e9) - (num(b.unit_cost) || 1e9));
      // 시즌 = 바코드 4번째 자리 (P 봄 · S 여름 · F 가을 · W 겨울 · A 사계절)
      const imgRow = rows.find((r) => images[r['상품코드']]);
      out.push({ name, sold: colorList.reduce((s, c) => s + c.sold, 0), colors: colorList, cands: sup, season: String(rows[0].group_key || '')[3] || '', image: imgRow ? images[imgRow['상품코드']] : '' });
    });
    return out.sort((a, b) => b.sold - a.sold || a.name.localeCompare(b.name, 'ko'));
  }, [stock, designs, sales, baseIndex, mfs, images]);

  // 기본 진행 컬러: 판매 많은 순으로 누적 80% 까지(최소 1개, 판매 0 컬러 제외)
  const defaultColorOn = useCallback((p) => {
    const set = new Set();
    let acc = 0;
    for (const c of p.colors) {
      if (c.sold <= 0) break;
      if (set.size && acc >= p.sold * 0.8) break;
      set.add(c.color);
      acc += c.sold;
    }
    return set;
  }, []);
  const recommend = (o) => {
    // 자사 창고(가용+입고대기)와 MFS(가용+입고예정) 재고를 모두 뺀다
    const need = Math.ceil((o.sold / Math.max(1, days)) * targetDays) - o.stock - o.incoming - (o.mfs ? o.mfs.avail + o.mfs.incoming : 0);
    return need > 0 ? Math.ceil(need / 10) * 10 : 0;
  };
  const isColorOn = (p, c) => {
    const k = `${p.name}|${c.color}`;
    return k in colorOn ? colorOn[k] : defaultColorOn(p).has(c.color);
  };
  const qtyFor = (o) => (o.code in qtyOf ? qtyOf[o.code] : recommend(o));
  const baseAvail = (base) => (base ? num(base['가용재고']) + (baseIncoming ? num(base['입고대기']) : 0) : 0);

  // 베이스 재고 한도 배분 — 판매 순위가 높은 상품부터 같은 베이스 옵션의 재고를 나눠 쓴다(여러 아트웍이 한 베이스를 공유).
  // {아트웍코드: {raw: 입력·추천수량, eff: 실제 발주수량, avail: 배분 직전 남은 베이스 재고}}
  const alloc = useMemo(() => {
    const left = {};
    const out = {};
    products.forEach((p) => {
      if (!picked[p.name]) return;
      p.colors.forEach((c) => {
        if (!isColorOn(p, c)) return;
        c.options.forEach((o) => {
          const raw = Math.max(0, num(qtyFor(o)));
          if (!baseLimit) { out[o.code] = { raw, eff: raw, avail: null }; return; }
          const key = o.base ? o.base['상품코드'] : null;
          const avail = key ? (key in left ? left[key] : baseAvail(o.base)) : 0;
          const eff = Math.min(raw, Math.max(0, avail));
          if (key) left[key] = avail - eff;
          out[o.code] = { raw, eff, avail };
        });
      });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, picked, colorOn, qtyOf, days, targetDays, baseLimit, baseIncoming]);

  const togglePick = (p) => setPicked((s) => ({ ...s, [p.name]: !s[p.name] }));
  const supplierFor = (p) => {
    const id = supplierOf[p.name];
    return p.cands.find((d) => String(d.supplier_id) === String(id)) || p.cands[0];
  };

  // 선택 결과 → 업체별 발주 리스트
  const groups = useMemo(() => {
    const m = new Map();
    products.forEach((p) => {
      if (!picked[p.name]) return;
      const d = supplierFor(p);
      if (!d) return;
      p.colors.forEach((c) => {
        if (!isColorOn(p, c)) return;
        c.options.forEach((o) => {
          const a = alloc[o.code];
          if (!a || a.eff <= 0) return;
          const key = String(d.supplier_id);
          if (!m.has(key)) m.set(key, { supplier_id: d.supplier_id, supplier_name: d.supplier_name, lines: [] });
          m.get(key).lines.push({ product: p.name, o, qty: a.eff, raw: a.raw, unit_cost: num(d.unit_cost) });
        });
      });
    });
    return [...m.values()].sort((a, b) => a.supplier_name.localeCompare(b.supplier_name, 'ko'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, picked, supplierOf, colorOn, alloc]);

  // 베이스 재고 때문에 줄었거나 빠진 옵션 (발주 리스트 안내용)
  const baseCut = useMemo(() => {
    const vals = Object.values(alloc).filter((a) => a.raw > 0 && a.eff < a.raw);
    return { dropped: vals.filter((a) => a.eff === 0).length, reduced: vals.filter((a) => a.eff > 0).length };
  }, [alloc]);

  const nextRound = (g) => {
    const names = VENDOR_ALIAS[g.supplier_name] || [g.supplier_name];
    const fromSheet = Math.max(0, ...names.map((n) => sheetRounds[n] || 0));
    const fromDb = Math.max(0, ...pos.filter((p) => String(p.supplier_id) === String(g.supplier_id)).map((p) => num(p.round_no)));
    return Math.max(fromSheet, fromDb) + 1;
  };
  const metaOf = (g) => ({ round_no: nextRound(g), order_date: kstDate(), ...(meta[g.supplier_id] || {}) });
  const setMetaField = (g, k, v) => setMeta((s) => ({ ...s, [g.supplier_id]: { ...(s[g.supplier_id] || {}), [k]: v } }));

  // ── 엑셀: 발주 시 3개 ──
  const downloadRequestFiles = async (supplierName, roundNo, orderDate, lines) => {
    const N = roundNo, d6 = yymmdd(orderDate);
    // 1) 발송요청 — 상품별 수량(아트웍) / 발송 요청(베이스, 같은 베이스 옵션은 합산)
    // 같은 이름끼리 묶기(순서 유지) — 이미지·상품명 셀 병합 단위
    const groupBy = (arr, keyOf) => {
      const m = new Map();
      arr.forEach((x) => { const k = keyOf(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); });
      return [...m.values()];
    };
    const artSum = lines.reduce((s, l) => s + l.request_qty, 0);
    // 의뢰수량 = 실제 발주 수량(베이스 재고 한도 적용 후) · 조정·1차 출고는 비워두고 입고·출고 후 직접 기입
    const artGroups = groupBy(lines, (l) => l.artwork_name).map((gl) => ({
      image: images[(gl.find((l) => images[l.artwork_code]) || {}).artwork_code] || '',
      rows: gl.map((l, i) => {
        const raw = l.raw_qty ?? l.request_qty;
        return ['', l.artwork_barcode, l.artwork_code, i === 0 ? l.artwork_name : '', l.option_name, l.request_qty, '', raw !== l.request_qty ? `추천 ${raw} → 베이스 재고 한도` : '']; // 조정은 입고 후 직접 기입 — 비워둠
      }),
    }));
    const baseMap = new Map();
    lines.forEach((l) => {
      const k = l.base_code || `(베이스 없음) ${l.artwork_code}`;
      if (!baseMap.has(k)) baseMap.set(k, { code: l.base_code || '', name: l.base_name || '(베이스 없음)', option: l.option_name, qty: 0 });
      baseMap.get(k).qty += l.request_qty;
    });
    const bases = [...baseMap.values()];
    const baseGroups = groupBy(bases, (b) => b.name).map((gb) => ({
      image: images[(gb.find((b) => images[b.code]) || {}).code] || '',
      rows: gb.map((b, i) => ['', b.code, i === 0 ? b.name : '', b.option, b.qty, '', '', '', '']), // 1차 출고는 출고 후 직접 기입 — 비워둠
    }));
    const out = [];
    out.push(await saveStyledXlsx(`${N}차_${supplierName}_발송요청_${d6}.xlsx`, [
      { name: '상품별 수량', headers: ['이미지', '바코드', '상품코드', '상품명', '옵션', '의뢰수량', '조정', '비고'],
        widths: [12, 22, 11, 28, 18, 10, 10, 18], groups: artGroups, mergeCols: [0, 3],
        total: ['', '', '', '', '합 계', artSum, '', ''] },
      { name: '발송 요청', headers: ['이미지', '베이스 상품코드', '상품명', '옵션', '수량', '1차 출고', '2차 출고', '차이', '박스 수량'],
        widths: [12, 15, 24, 18, 9, 10, 10, 8, 10], groups: baseGroups, mergeCols: [0, 2],
        total: ['합 계', '', '', '', artSum, '', '', '', ''] },
    ], makeWriter(supplierName, '발송요청')));
    // 2) 베이스출고 — 베이스 상품코드 · 수량 · 메모 (이지어드민)
    const bm = `${d6}_${supplierName}_베이스출고_${N}차`;
    out.push(await saveXlsx(`${N}차_베이스출고_${supplierName}.xlsx`, [{
      name: 'Sheet1', cols: [10, 8, 32, 22, 18],
      rows: [['상품코드', '수량', '메모'], ...bases.filter((b) => b.code).map((b) => [b.code, b.qty, bm, b.name, b.option])],
    }], makeWriter(supplierName, '입고', N)));
    // 3) 입고대기 — 아트웍 상품코드 · 의뢰수량 · 메모
    const wm = `${d6}_${supplierName}_입고대기_${N}차`;
    out.push(await saveXlsx(`${N}차_입고대기_${supplierName}.xlsx`, [{
      name: 'Sheet1', cols: [10, 8, 32, 26, 18],
      rows: [['상품코드', '수량', '메모'], ...lines.map((l) => [l.artwork_code, l.request_qty, wm, l.artwork_name, l.option_name])],
    }], makeWriter(supplierName, '입고', N)));
    return out;
  };

  // ── 공유 폴더 바로 저장 ──
  const connectFolder = async () => {
    try {
      let h;
      try {
        h = await window.showDirectoryPicker({ id: 'printpo-nayeom', mode: 'readwrite' });
      } catch (e1) {
        if (e1 && e1.name === 'AbortError' && !/network|path|start/i.test(e1.message || '')) throw e1; // 사용자가 취소
        // 네트워크 폴더·기억된 시작 위치 문제 → 옵션 없이 다시 열고 권한은 따로 요청
        h = await window.showDirectoryPicker();
        if (!(await ensurePermission(h))) throw Object.assign(new Error('쓰기 권한이 거부되었습니다'), { name: 'NotAllowedError' });
      }
      setRootDir(h);
      await idbSet('root', h);
      flash('ok', `저장 폴더 연결: ${h.name}`);
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      console.error('[저장 폴더 연결 실패]', e);
      const why = e?.name === 'SecurityError' ? '브라우저가 이 위치를 막았습니다 — 네트워크 드라이브로 연결(Z: 등) 후 선택해주세요'
        : e?.name === 'NotAllowedError' ? '쓰기 권한이 없습니다'
        : `${e?.name || ''} ${e?.message || ''}`.trim();
      flash('err', `폴더를 연결하지 못했습니다 — ${why}`.slice(0, 120));
    }
  };
  // 반환값: 저장된 위치 문자열(폴더) 또는 '' (다운로드)
  const makeWriter = (supplier, kind, round) => async (blob, fileName) => {
    if (!rootDir) { downloadBlob(blob, fileName); return ''; }
    try {
      if (!(await ensurePermission(rootDir))) throw new Error('permission');
      const parent = await supplierDir(rootDir, supplier, kind);
      const dir = kind === '입고' ? await parent.getDirectoryHandle(`${round}차`, { create: true }) : parent;
      await writeFile(dir, fileName, blob);
      return kind === '입고' ? `${parent.name}/${round}차` : parent.name;
    } catch (e) {
      downloadBlob(blob, fileName); // 폴더 저장 실패 → 다운로드로 대신
      return '';
    }
  };
  const whereText = (paths) => {
    const ps = [...new Set((paths || []).filter(Boolean))];
    return ps.length ? `${rootDir?.name || ''} 폴더에 저장 (${ps.join(' · ')})` : '다운로드';
  };

  // 업체 1곳 발주 저장 + 3개 파일
  const savePo = async (g) => {
    const m = metaOf(g);
    if (!num(m.round_no)) { flash('err', '차수를 입력해주세요'); return; }
    if (poMissing) { flash('err', '발주 저장 테이블이 없습니다 — supabase/print_po.sql 을 실행해주세요'); return; }
    if (rootDir) await ensurePermission(rootDir).catch(() => false); // 폴더 권한은 클릭 직후에 요청해야 함
    setSaving(true);
    try {
      const [po] = await sbFetch('print_po', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ supplier_id: g.supplier_id, supplier_name: g.supplier_name, round_no: num(m.round_no), order_date: m.order_date }),
      });
      const lines = g.lines.map((l) => ({
        po_id: po.id, artwork_code: l.o.code, artwork_name: l.product, option_name: l.o.option, artwork_barcode: l.o.barcode,
        base_code: l.o.base?.['상품코드'] || null, base_name: l.o.base?.['상품명'] || null, base_barcode: l.o.base?.['바코드'] || null,
        request_qty: l.qty, unit_cost: l.unit_cost,
      }));
      await sbFetch('print_po_lines', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(lines) });
      const paths = await downloadRequestFiles(g.supplier_name, num(m.round_no), m.order_date, lines.map((x, i) => ({ ...x, raw_qty: g.lines[i].raw })));
      // 저장된 업체 상품은 선택 해제
      const done = new Set(g.lines.map((l) => l.product));
      setPicked((s) => { const n = { ...s }; done.forEach((k) => delete n[k]); return n; });
      await loadPos();
      flash('ok', `${g.supplier_name} ${m.round_no}차 저장 · 엑셀 3개 ${whereText(paths)}`);
    } catch (e) {
      flash('err', `저장 실패 — ${String(e.message || e).slice(0, 80)}`);
    } finally {
      setSaving(false);
    }
  };

  // ── 입고 처리 ──
  const current = pos.find((p) => p.id === openPo) || null;
  const curLines = useMemo(() => [...(current?.print_po_lines || [])].sort((a, b) => a.id - b.id), [current]);
  const recvOf = (l) => (l.id in recvQty ? recvQty[l.id] : (l.received_qty ?? l.request_qty));
  const openReceive = (p) => {
    setOpenPo(openPo === p.id ? null : p.id);
    setRecvQty({});
    setRecvDate(p.received_date || kstDate());
  };

  // ── 4) 베이스 재고 추가 조정 (입고 후) ──
  // 1차 출고(발주수량)는 이미 어드민에서 차감됨 → 남은 베이스 = 출고 − 입고 − 불량, 어드민에 넣을 수량 = max(0, 남은 베이스)
  // 입고가 출고보다 많아도 추가 차감하지 않음(0)
  const adjCur = pos.find((p) => p.id === adjPo) || null;
  const adjLines = useMemo(() => [...(adjCur?.print_po_lines || [])].sort((a, b) => a.id - b.id), [adjCur]);
  const defectOfLine = (l) => (l.id in defectOf ? defectOf[l.id] : (l.defect_qty ?? ''));
  const leftOf = (l) => num(l.request_qty) - num(l.received_qty) - num(defectOfLine(l));
  // 직접 수정값 > (불량을 고쳤으면 다시 계산) > 저장값 > 계산값
  const putOfLine = (l) => {
    if (l.id in putOf) return putOf[l.id];
    if (!(l.id in defectOf) && l.base_return_qty != null) return l.base_return_qty;
    return Math.max(0, leftOf(l));
  };
  const openAdjust = (p) => {
    setAdjPo(adjPo === p.id ? null : p.id);
    setDefectOf({});
    setPutOf({});
  };
  const saveAdjust = async () => {
    if (!adjCur) return;
    if (rootDir) await ensurePermission(rootDir).catch(() => false);
    setSaving(true);
    try {
      const N = adjCur.round_no, sup = adjCur.supplier_name, d6 = yymmdd(kstDate());
      // 불량·넣을 수량 저장 — 컬럼이 없으면(SQL 미실행) 저장은 건너뛰고 엑셀만 생성
      let saved = true;
      try {
        await Promise.all(adjLines.map((l) => sbFetch(`print_po_lines?id=eq.${l.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ defect_qty: num(defectOfLine(l)), base_return_qty: num(putOfLine(l)) }),
        })));
        await sbFetch(`print_po?id=eq.${adjCur.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ base_adjusted_at: new Date().toISOString() }),
        });
      } catch (e) { saved = false; }
      // 같은 베이스 코드끼리 합산
      const m = new Map();
      adjLines.forEach((l) => {
        if (!l.base_code) return;
        if (!m.has(l.base_code)) m.set(l.base_code, { code: l.base_code, name: l.base_name, option: l.option_name, ship: 0, recv: 0, bad: 0, put: 0 });
        const r = m.get(l.base_code);
        r.ship += num(l.request_qty); r.recv += num(l.received_qty); r.bad += num(defectOfLine(l)); r.put += num(putOfLine(l));
      });
      const bases = [...m.values()];
      const memo = `${d6}_${shortSupplier(sup)}_베이스입고(추가)_${N}차`;
      const path = await saveXlsx(`${N}차_베이스입고(추가)_${shortSupplier(sup)}.xlsx`, [
        { name: '어드민 입력', cols: [10, 8, 32, 22, 18], rows: [['상품코드', '수량', '메모'], ...bases.filter((b) => b.put > 0).map((b) => [b.code, b.put, memo, b.name, b.option])] },
        { name: '계산 내역', cols: [12, 22, 16, 10, 10, 8, 10, 12], rows: [
          ['베이스 상품코드', '베이스 상품명', '옵션', '1차 출고', '입고', '불량', '남은 베이스', '어드민에 넣을 수량'],
          ...bases.map((b) => [b.code, b.name, b.option, b.ship, b.recv, b.bad, b.ship - b.recv - b.bad, b.put]),
          ['합계', '', '', ...['ship', 'recv', 'bad'].map((k) => bases.reduce((s, b) => s + b[k], 0)), bases.reduce((s, b) => s + b.ship - b.recv - b.bad, 0), bases.reduce((s, b) => s + b.put, 0)],
        ] },
      ], makeWriter(sup, '입고', N));
      await loadPos();
      const total = bases.reduce((s, b) => s + b.put, 0);
      if (saved) flash('ok', `${sup} ${N}차 베이스 ${total.toLocaleString()}장 · 엑셀 ${whereText([path])}`);
      else flash('err', `엑셀은 생성됨 · 불량 저장 실패 — supabase/print_po_base_adjust.sql 실행 필요`);
    } catch (e) {
      flash('err', `베이스 조정 실패 — ${String(e.message || e).slice(0, 80)}`);
    } finally {
      setSaving(false);
    }
  };

  const saveReceive = async () => {
    if (!current) return;
    if (rootDir) await ensurePermission(rootDir).catch(() => false);
    setSaving(true);
    try {
      await Promise.all(curLines.map((l) => sbFetch(`print_po_lines?id=eq.${l.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ received_qty: num(recvOf(l)) }),
      })));
      await sbFetch(`print_po?id=eq.${current.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'received', received_date: recvDate }),
      });
      const N = current.round_no, sup = current.supplier_name, d6 = yymmdd(recvDate);
      const recvRows = curLines.filter((l) => num(recvOf(l)) > 0);
      const head = ['상품코드', '수량', '메모', '상품명', '옵션', '바코드'];
      const cols = [10, 8, 32, 26, 18, 20];
      const wr = makeWriter(sup, '입고', N); // {NN}_{업체}_입고/{N}차 폴더
      const paths = [];
      paths.push(await saveXlsx(`${N}차_정상입고_${sup}.xlsx`, [{ name: 'Sheet1', cols, rows: [head, ...recvRows.map((l) => [l.artwork_code, num(recvOf(l)), `${d6}_${sup}_정상입고_${N}차`, l.artwork_name, l.option_name, l.artwork_barcode])] }], wr));
      paths.push(await saveXlsx(`${N}차_MFS출고_${sup}.xlsx`, [{ name: 'Sheet1', cols, rows: [head, ...recvRows.map((l) => [l.artwork_code, num(recvOf(l)), `${d6}_${sup}_MFS출고_${N}차`, l.artwork_name, l.option_name, l.artwork_barcode])] }], wr));
      // 베이스 재고는 추가로 빼지 않음 — 남은 베이스는 4) 베이스 재고 추가 조정에서 어드민에 다시 넣음
      await loadPos();
      setAdjPo(current.id);
      flash('ok', `${sup} ${N}차 입고 저장 · 엑셀 2개 ${whereText(paths)} — 아래 4)에서 베이스 재고 조정`);
    } catch (e) {
      flash('err', `입고 저장 실패 — ${String(e.message || e).slice(0, 80)}`);
    } finally {
      setSaving(false);
    }
  };

  // 저장한 발주의 발송요청 파일 다시 받기
  const redownload = async (p) => {
    try {
      if (rootDir) await ensurePermission(rootDir).catch(() => false);
      const paths = await downloadRequestFiles(p.supplier_name, p.round_no, p.order_date, [...(p.print_po_lines || [])].sort((a, b) => a.id - b.id));
      flash('ok', `${p.supplier_name} ${p.round_no}차 엑셀 3개 ${whereText(paths)}`);
    } catch (e) {
      flash('err', '엑셀 생성 실패');
    }
  };

  // 삭제 — 2단계(3초 안에 다시 누르면 삭제)
  const deletePo = async (p) => {
    if (delArm !== p.id) {
      clearTimeout(delTimer.current);
      setDelArm(p.id);
      delTimer.current = setTimeout(() => setDelArm(null), 3000);
      return;
    }
    clearTimeout(delTimer.current);
    setDelArm(null);
    try {
      await sbFetch(`print_po?id=eq.${p.id}`, { method: 'DELETE' });
      if (openPo === p.id) setOpenPo(null);
      await loadPos();
      flash('neutral', `${p.supplier_name} ${p.round_no}차 삭제됨`);
    } catch (e) {
      flash('err', '삭제 실패 — 다시 시도해주세요');
    }
  };

  const shownProducts = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const seasons = SEASON_SETS[seasonSet].codes;
    return products.filter((p) => (!seasons || seasons.includes(p.season)) && p.sold >= minSold
      && (!kw || p.name.toLowerCase().includes(kw) || p.cands.some((d) => d.supplier_name.includes(q.trim()))));
  }, [products, q, seasonSet, minSold]);

  if (loading) return <div style={S.card}><div style={S.empty}>⏳ 재고·업체 데이터를 불러오는 중...</div></div>;
  if (error) return <div style={S.card}><div style={{ ...S.empty, color: '#b91c1c' }}>불러오지 못했습니다: {error}</div></div>;

  return (
    <div>
      {msg && (
        <div role="status" style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 50, padding: '10px 16px', borderRadius: 10, fontSize: 14, fontWeight: 600, color: '#fff', boxShadow: '0 6px 20px rgba(15,23,42,.15)', background: msg.kind === 'ok' ? '#15803d' : msg.kind === 'err' ? '#b91c1c' : '#475569' }}>{msg.text}</div>
      )}
      {poMissing && (
        <div style={{ ...S.card, borderColor: '#fecaca', background: '#fef2f2', ...S.msg('err') }}>
          발주 저장 테이블이 없습니다 — Supabase SQL Editor 에서 supabase/print_po.sql 을 실행해주세요
        </div>
      )}

      {/* 1) 판매 순위 → 상품·컬러 선택 */}
      <div style={S.card}>
        <div style={{ ...S.bar, justifyContent: 'space-between' }}>
          <h3 style={S.title}><span style={S.step}>1</span>판매 순위에서 상품·컬러 선택</h3>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: '#64748b' }}>
              리스트 생성 <b style={{ color: '#334155' }}>{loadedAt ? fmtDateTime(loadedAt) : '-'}</b>
            </span>
            <button style={{ ...S.btn(false, refreshing || salesLoading), fontSize: 12 }} disabled={refreshing || salesLoading}
              onClick={() => setReloadKey((k) => k + 1)}>
              {refreshing || salesLoading ? '불러오는 중…' : '🔄 새로고침'}
            </button>
          </span>
        </div>
        <div style={S.bar}>
          <label style={{ fontSize: 12, color: '#475569', fontWeight: 600 }}>판매 기간
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ ...S.input, marginLeft: 6 }}>
              {[7, 14, 30, 60].map((d) => <option key={d} value={d}>최근 {d}일</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12, color: '#475569', fontWeight: 600 }}>목표 재고 일수
            <input type="number" min={1} value={targetDays} onChange={(e) => setTargetDays(Math.max(1, Number(e.target.value) || 1))} style={{ ...S.input, width: 64, marginLeft: 6 }} />일
          </label>
          <span style={{ display: 'inline-flex', gap: 4 }}>
            {Object.entries(SEASON_SETS).map(([k, s]) => (
              <button key={k} onClick={() => setSeasonSet(k)}
                style={{ ...S.btn(false, false), fontSize: 12, padding: '5px 10px', ...(seasonSet === k ? { borderColor: '#4f46e5', color: '#4f46e5', fontWeight: 700, background: '#eef2ff' } : {}) }}>
                {s.label}
              </button>
            ))}
          </span>
          <label style={{ fontSize: 12, color: '#475569', fontWeight: 600 }}>판매
            <input type="number" min={0} step={10} value={minSold} onChange={(e) => setMinSold(Math.max(0, Number(e.target.value) || 0))} style={{ ...S.input, width: 64, margin: '0 4px' }} />장 이상
          </label>
          <input style={{ ...S.input, flex: '1 1 200px' }} placeholder="상품명 · 업체 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          <label style={{ fontSize: 12, color: '#475569', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={baseLimit} onChange={(e) => setBaseLimit(e.target.checked)} />베이스 재고 한도 적용
          </label>
          <label style={{ fontSize: 12, color: baseLimit ? '#475569' : '#cbd5e1', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={baseIncoming} disabled={!baseLimit} onChange={(e) => setBaseIncoming(e.target.checked)} />베이스 입고대기 포함
          </label>
          {salesLoading && <span style={S.msg('neutral')}>판매 집계 중…</span>}
        </div>
        {/* 사이즈별 숫자 범례 — 항목명만 색 칩으로 */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 12, marginBottom: 10 }}>
          {[[NUM_COLOR.sold, '판매'], [NUM_COLOR.incoming, '입고대기'], ...(mfs ? [[NUM_COLOR.mfs, 'MFS']] : []), [NUM_COLOR.base, '베이스']].map(([c, k]) => (
            <b key={k} style={{ padding: '3px 10px', borderRadius: 99, background: c.bg, color: c.fg }}>{k}</b>
          ))}
        </div>

        {!shownProducts.length ? <div style={S.empty}>표시할 상품이 없습니다</div> : shownProducts.slice(0, showN).map((p, idx) => {
          const on = !!picked[p.name];
          const d = supplierFor(p);
          return (
            <div key={p.name} style={{ border: `1px solid ${on ? '#a5b4fc' : '#e5e7eb'}`, background: on ? '#f8faff' : '#fff', borderRadius: 10, marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', flexWrap: 'wrap' }}>
                <input type="checkbox" checked={on} onChange={() => togglePick(p)} style={{ width: 16, height: 16, cursor: 'pointer' }} />
                <span style={{ width: 28, fontSize: 12, fontWeight: 800, color: '#94a3b8' }}>{idx + 1}</span>
                {p.image
                  ? <img src={p.image} alt="" loading="lazy" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6, border: '1px solid #e5e7eb', flexShrink: 0 }} onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                  : <span style={{ width: 40, height: 40, borderRadius: 6, background: '#f1f5f9', flexShrink: 0 }} />}
                <span onClick={() => togglePick(p)} style={{ flex: '1 1 220px', fontWeight: 700, color: '#0f172a', cursor: 'pointer' }}>{p.name}</span>
                <span style={{ fontSize: 12, color: '#475569' }}>판매 <b style={{ color: '#0f172a' }}>{p.sold.toLocaleString()}</b></span>
                <select value={d ? d.supplier_id : ''} onChange={(e) => setSupplierOf((s) => ({ ...s, [p.name]: e.target.value }))} style={{ ...S.input, fontSize: 12 }}>
                  {p.cands.map((c) => (
                    <option key={c.id} value={c.supplier_id}>{c.supplier_name} · {c.design_name} · {num(c.unit_cost) ? `${num(c.unit_cost).toLocaleString()}원` : '단가 미입력'}{c.sample_status !== '승인완료' ? ` (${c.sample_status})` : ''}</option>
                  ))}
                </select>
              </div>
              {on && (
                <div style={{ padding: '0 12px 10px' }}>
                  <div style={S.tableWrap}>
                    <table style={S.table}>
                      <thead><tr>
                        <th style={S.th}>진행</th><th style={S.th}>컬러</th><th style={{ ...S.th, textAlign: 'right' }}>판매</th><th style={{ ...S.th, textAlign: 'right' }}>비중</th>
                        <th style={S.th}>사이즈별 의뢰수량</th>
                      </tr></thead>
                      <tbody>
                        {p.colors.map((c) => {
                          const cOn = isColorOn(p, c);
                          return (
                            <tr key={c.color} style={{ opacity: cOn ? 1 : 0.45 }}>
                              <td style={S.td}><input type="checkbox" checked={cOn} onChange={() => setColorOn((s) => ({ ...s, [`${p.name}|${c.color}`]: !cOn }))} /></td>
                              <td style={{ ...S.td, fontWeight: 600 }}>{c.color}</td>
                              <td style={{ ...S.td, textAlign: 'right', fontWeight: 700 }}>{c.sold.toLocaleString()}</td>
                              <td style={{ ...S.td, textAlign: 'right', color: '#64748b' }}>{p.sold ? Math.round((c.sold / p.sold) * 100) : 0}%</td>
                              <td style={S.td}>
                                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                  {c.options.map((o) => {
                                    const baseQty = o.base ? num(o.base['가용재고']) : null;
                                    const v = qtyFor(o);
                                    const a = alloc[o.code];
                                    const short = baseLimit ? !!a && a.raw > 0 && a.eff < a.raw : baseQty !== null && num(v) > baseQty;
                                    const baseBad = short || !o.base;
                                    // 사이즈 카드: 위 = 사이즈·의뢰수량, 아래 = 판매 / 입고대기 / MFS / 베이스 칸
                                    const tiles = [
                                      [NUM_COLOR.sold, '판매', o.sold.toLocaleString(), `최근 ${days}일 판매량 (무신사 + MFS)`],
                                      [NUM_COLOR.incoming, '입고대기', o.incoming.toLocaleString(), `아트웍 입고대기 ${o.incoming} (가용재고 ${o.stock})`],
                                      ...(o.mfs ? [[NUM_COLOR.mfs, 'MFS', o.mfs.avail.toLocaleString(), `MFS 가용 ${o.mfs.avail} · 입고예정 ${o.mfs.incoming} · 불량 ${o.mfs.defect}`]] : []),
                                      [baseBad ? { fg: '#dc2626', bg: '#fee2e2' } : NUM_COLOR.base, '베이스', o.base ? baseAvail(o.base).toLocaleString() : '없음',
                                        o.base ? `베이스 ${o.base['상품코드']} ${o.base['상품명']} ${o.option} · 가용 ${baseQty}${baseIncoming ? ` + 입고대기 ${num(o.base['입고대기'])}` : ''}` : '같은 바코드 그룹·옵션의 베이스 상품을 찾지 못함'],
                                    ];
                                    return (
                                      <div key={o.code} title={`${o.code} · ${o.option}`} style={{ border: `1px solid ${short ? '#fecaca' : '#e2e8f0'}`, borderRadius: 8, padding: 8, background: '#fff' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                          <span style={{ minWidth: 26, fontSize: 13, fontWeight: 800, color: '#0f172a' }}>{o.size || '-'}</span>
                                          <input type="number" min={0} step={10} disabled={!cOn} value={v}
                                            onChange={(e) => setQtyOf((s) => ({ ...s, [o.code]: e.target.value }))} style={{ ...S.qty, width: 70, borderColor: short ? '#dc2626' : '#cbd5e1' }} />
                                          {cOn && short && (
                                            <span style={{ fontSize: 11, fontWeight: 800, color: a.eff ? '#ea580c' : '#dc2626', whiteSpace: 'nowrap' }}>
                                              {a.eff ? `→ ${a.eff} 베이스 한도` : (o.base ? '베이스 없음 · 제외' : '베이스 미매칭 · 제외')}
                                            </span>
                                          )}
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${tiles.length}, minmax(52px, 1fr))`, gap: 4 }}>
                                          {tiles.map(([col, label, value, tip]) => (
                                            <div key={label} title={tip} style={{ background: col.bg, borderRadius: 6, padding: '3px 6px', textAlign: 'center' }}>
                                              <div style={{ fontSize: 10, fontWeight: 600, color: col.fg, opacity: 0.85 }}>{label}</div>
                                              <div style={{ fontSize: 13, fontWeight: 800, color: col.fg }}>{value}</div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {shownProducts.length > showN && (
          <button style={{ ...S.btn(false, false), width: '100%', marginTop: 4 }} onClick={() => setShowN((n) => n + 20)}>더 보기 ({shownProducts.length - showN}개 남음)</button>
        )}
      </div>

      {/* 2) 업체·차수별 발주 리스트 */}
      <div style={S.card}>
        <div style={{ ...S.bar, justifyContent: 'space-between' }}>
          <h3 style={S.title}><span style={S.step}>2</span>업체·차수별 발주 리스트</h3>
          {/* 엑셀 저장 위치 — 폴더 연결 시 업체별 발송요청 / 입고/{N}차 폴더에 바로 저장 */}
          {FS_SUPPORTED ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#475569' }}>
              {rootDir ? <>📁 저장 폴더 <b style={{ color: '#0f172a' }}>{rootDir.name}</b></> : <span style={{ color: '#94a3b8' }}>폴더 미연결 · 다운로드 폴더로 저장</span>}
              <button style={{ ...S.btn(!rootDir, false), fontSize: 12, padding: '5px 10px' }} onClick={connectFolder}>{rootDir ? '변경' : '📁 저장 폴더 연결'}</button>
            </span>
          ) : (
            <span style={{ fontSize: 12, color: '#94a3b8' }}>폴더 바로 저장은 Chrome·Edge 에서만 가능 · 다운로드로 저장</span>
          )}
        </div>
        {baseLimit && (baseCut.dropped > 0 || baseCut.reduced > 0) && (
          <div style={{ ...S.msg('err'), fontSize: 12, marginBottom: 10 }}>
            베이스 재고 부족 — {baseCut.dropped ? `${baseCut.dropped}개 옵션 제외` : ''}{baseCut.dropped && baseCut.reduced ? ' · ' : ''}{baseCut.reduced ? `${baseCut.reduced}개 옵션 수량 줄임` : ''}
            {' '}(발송요청 '상품별 수량' 시트에 의뢰수량 / 조정으로 함께 표시)
          </div>
        )}
        {!groups.length ? <div style={S.empty}>1단계에서 상품을 선택하면 업체별로 묶여 나옵니다</div> : groups.map((g) => {
          const m = metaOf(g);
          const total = g.lines.reduce((s, l) => s + l.qty, 0);
          const cost = g.lines.reduce((s, l) => s + l.qty * l.unit_cost, 0);
          return (
            <div key={g.supplier_id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, marginBottom: 12 }}>
              <div style={{ ...S.bar, marginBottom: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>{g.supplier_name}</span>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>차수
                  <input type="number" min={1} value={m.round_no} onChange={(e) => setMetaField(g, 'round_no', e.target.value)} style={{ ...S.input, width: 64, marginLeft: 4 }} />차
                </label>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>발주일
                  <input type="date" value={m.order_date} onChange={(e) => setMetaField(g, 'order_date', e.target.value)} style={{ ...S.input, marginLeft: 4 }} />
                </label>
                <span style={{ fontSize: 12, color: '#64748b' }}>{g.lines.length}옵션 · <b style={{ color: '#0f172a' }}>{total.toLocaleString()}장</b>{cost ? ` · 약 ${cost.toLocaleString()}원` : ''}</span>
                <button style={{ ...S.btn(true, saving || poMissing), marginLeft: 'auto' }} disabled={saving || poMissing} onClick={() => savePo(g)}>
                  {saving ? '저장 중…' : '저장 + 엑셀 3개 (발송요청·베이스출고·입고대기)'}
                </button>
              </div>
              <div style={{ ...S.tableWrap, maxHeight: 300, overflowY: 'auto' }}>
                <table style={S.table}>
                  <thead><tr>
                    <th style={S.th}>아트웍 상품</th><th style={S.th}>상품코드</th><th style={S.th}>옵션</th><th style={{ ...S.th, textAlign: 'right' }}>의뢰수량</th>
                    <th style={S.th}>베이스 상품</th><th style={S.th}>베이스 코드</th><th style={{ ...S.th, textAlign: 'right' }}>베이스 재고</th>
                  </tr></thead>
                  <tbody>
                    {g.lines.map((l) => {
                      const bq = l.o.base ? num(l.o.base['가용재고']) : null;
                      return (
                        <tr key={l.o.code}>
                          <td style={S.td}>{l.product}</td>
                          <td style={{ ...S.td, ...S.mono }}>{l.o.code}</td>
                          <td style={S.td}>{l.o.option}</td>
                          <td style={{ ...S.td, textAlign: 'right', fontWeight: 700 }}>{l.qty.toLocaleString()}</td>
                          <td style={{ ...S.td, color: l.o.base ? '#334155' : '#dc2626' }}>{l.o.base ? l.o.base['상품명'] : '베이스 없음'}</td>
                          <td style={{ ...S.td, ...S.mono }}>{l.o.base?.['상품코드'] || '-'}</td>
                          <td style={{ ...S.td, textAlign: 'right', color: bq !== null && l.qty > bq ? '#dc2626' : '#64748b', fontWeight: bq !== null && l.qty > bq ? 700 : 400 }}>{bq ?? '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>

      {/* 3) 저장된 발주 · 입고 처리 */}
      <div style={S.card}>
        <h3 style={{ ...S.title, marginBottom: 12 }}><span style={S.step}>3</span>저장된 발주 · 입고 처리</h3>
        {!pos.length ? <div style={S.empty}>{poMissing ? '발주 저장 테이블을 만든 뒤 사용할 수 있습니다' : '저장된 발주가 없습니다'}</div> : pos.map((p) => {
          const lines = p.print_po_lines || [];
          const total = lines.reduce((s, l) => s + num(l.request_qty), 0);
          const recvTotal = lines.reduce((s, l) => s + num(l.received_qty), 0);
          const open = openPo === p.id;
          return (
            <div key={p.id} style={{ border: `1px solid ${open ? '#a5b4fc' : '#e5e7eb'}`, borderRadius: 10, marginBottom: 8 }}>
              <div onClick={() => setViewPo((v) => (v === p.id ? null : p.id))} title="클릭하면 옵션별 발주 수량"
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', flexWrap: 'wrap', cursor: 'pointer' }}>
                <span style={{ fontSize: 10, color: '#94a3b8', width: 10 }}>{viewPo === p.id ? '▼' : '▶'}</span>
                <span style={{ fontWeight: 800, color: '#0f172a' }}>{p.supplier_name} · {p.round_no}차</span>
                <span style={{ fontSize: 12, color: '#64748b' }}>발주 {p.order_date} · {lines.length}옵션 · {total.toLocaleString()}장</span>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: p.status === 'received' ? '#dcfce7' : '#e0e7ff', color: p.status === 'received' ? '#15803d' : '#4338ca' }}>
                  {p.status === 'received' ? `입고완료 ${p.received_date || ''} · ${recvTotal.toLocaleString()}장` : '발송요청'}
                </span>
                <span onClick={(e) => e.stopPropagation()} style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button style={{ ...S.btn(false, false), fontSize: 12 }} onClick={() => redownload(p)}>발주 엑셀 다시 받기</button>
                  <button style={{ ...S.btn(open, false), fontSize: 12 }} onClick={() => openReceive(p)}>{open ? '닫기' : '입고 처리'}</button>
                  <button style={{ ...S.btn(false, false), fontSize: 12, ...(delArm === p.id ? { borderColor: '#dc2626', color: '#dc2626', fontWeight: 700 } : {}) }} onClick={() => deletePo(p)}>
                    {delArm === p.id ? '한 번 더 누르면 삭제' : '삭제'}
                  </button>
                </span>
              </div>
              {/* 옵션별 발주 수량 (헤더 클릭으로 펼침) */}
              {viewPo === p.id && !open && (
                <div style={{ padding: '0 12px 12px' }}>
                  <div style={{ ...S.tableWrap, maxHeight: 360, overflowY: 'auto' }}>
                    <table style={S.table}>
                      <thead><tr>
                        <th style={S.th}></th><th style={S.th}>아트웍 상품</th><th style={S.th}>상품코드</th><th style={S.th}>옵션</th>
                        <th style={{ ...S.th, textAlign: 'right' }}>발주수량</th>
                        {p.status === 'received' && <th style={{ ...S.th, textAlign: 'right' }}>실입고</th>}
                        <th style={S.th}>베이스 상품</th><th style={S.th}>베이스 코드</th>
                      </tr></thead>
                      <tbody>
                        {[...lines].sort((a, b) => a.id - b.id).map((l, i, arr) => {
                          const first = i === 0 || arr[i - 1].artwork_name !== l.artwork_name;
                          return (
                            <tr key={l.id}>
                              <td style={{ ...S.td, width: 40 }}>
                                {first && images[l.artwork_code] && <img src={images[l.artwork_code]} alt="" loading="lazy" style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 5 }} />}
                              </td>
                              <td style={{ ...S.td, fontWeight: first ? 700 : 400, color: first ? '#0f172a' : '#cbd5e1' }}>{first ? l.artwork_name : '〃'}</td>
                              <td style={{ ...S.td, ...S.mono }}>{l.artwork_code}</td>
                              <td style={S.td}>{l.option_name}</td>
                              <td style={{ ...S.td, textAlign: 'right', fontWeight: 700 }}>{num(l.request_qty).toLocaleString()}</td>
                              {p.status === 'received' && <td style={{ ...S.td, textAlign: 'right', color: num(l.received_qty) === num(l.request_qty) ? '#334155' : '#dc2626', fontWeight: 700 }}>{num(l.received_qty).toLocaleString()}</td>}
                              <td style={{ ...S.td, color: l.base_code ? '#475569' : '#dc2626' }}>{l.base_name || '베이스 없음'}</td>
                              <td style={{ ...S.td, ...S.mono }}>{l.base_code || '-'}</td>
                            </tr>
                          );
                        })}
                        <tr style={{ background: '#f8fafc' }}>
                          <td style={{ ...S.td, fontWeight: 700 }} colSpan={4}>합계</td>
                          <td style={{ ...S.td, textAlign: 'right', fontWeight: 800 }}>{total.toLocaleString()}</td>
                          {p.status === 'received' && <td style={{ ...S.td, textAlign: 'right', fontWeight: 800 }}>{recvTotal.toLocaleString()}</td>}
                          <td style={S.td} colSpan={2}></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {open && (
                <div style={{ padding: '0 12px 12px' }}>
                  <div style={S.bar}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>입고일
                      <input type="date" value={recvDate} onChange={(e) => setRecvDate(e.target.value)} style={{ ...S.input, marginLeft: 4 }} />
                    </label>
                    <span style={{ fontSize: 12, color: '#64748b' }}>실입고수량을 입력하면 정상입고·MFS출고는 그 수량 그대로 생성됩니다 · 남은 베이스는 아래 4)에서 조정</span>
                  </div>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                    <div style={{ ...S.tableWrap, flex: '3 1 480px', maxHeight: 360, overflowY: 'auto' }}>
                      <table style={S.table}>
                        <thead><tr>
                          <th style={S.th}>아트웍 상품</th><th style={S.th}>상품코드</th><th style={S.th}>옵션</th>
                          <th style={{ ...S.th, textAlign: 'right' }}>의뢰</th><th style={{ ...S.th, textAlign: 'right' }}>실입고</th>
                        </tr></thead>
                        <tbody>
                          {curLines.map((l) => {
                            const v = recvOf(l);
                            const diff = num(v) - num(l.request_qty);
                            return (
                              <tr key={l.id}>
                                <td style={S.td}>{l.artwork_name}</td>
                                <td style={{ ...S.td, ...S.mono }}>{l.artwork_code}</td>
                                <td style={S.td}>{l.option_name}</td>
                                <td style={{ ...S.td, textAlign: 'right' }}>{num(l.request_qty).toLocaleString()}</td>
                                <td style={{ ...S.td, textAlign: 'right' }}>
                                  <input type="number" min={0} value={v} onChange={(e) => setRecvQty((s) => ({ ...s, [l.id]: e.target.value }))} style={S.qty} />
                                  {diff !== 0 && <div style={{ fontSize: 10, fontWeight: 700, color: diff > 0 ? '#2563eb' : '#dc2626' }}>{diff > 0 ? `+${diff}` : diff}</div>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                    <button style={S.btn(true, saving)} disabled={saving} onClick={saveReceive}>
                      {saving ? '저장 중…' : '입고 저장 + 엑셀 2개 (정상입고·MFS출고)'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 4) 베이스 재고 추가 조정 (입고 후) */}
      <div style={S.card}>
        <h3 style={{ ...S.title, marginBottom: 12 }}><span style={S.step}>4</span>베이스 재고 추가 조정 (입고 후)</h3>
        <BaseAdjustUpload stock={stock} baseIndex={baseIndex} suppliers={suppliers} makeWriter={makeWriter} whereText={whereText} flash={flash} rootDir={rootDir} />
        {(() => {
          const recvPos = pos.filter((p) => p.status === 'received');
          if (!recvPos.length) return null;
          return recvPos.map((p) => {
            const open = adjPo === p.id;
            const lines = p.print_po_lines || [];
            const savedPut = lines.reduce((s, l) => s + num(l.base_return_qty), 0);
            return (
              <div key={p.id} style={{ border: `1px solid ${open ? '#99f6e4' : '#e5e7eb'}`, borderRadius: 10, marginBottom: 8 }}>
                <div onClick={() => openAdjust(p)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', flexWrap: 'wrap', cursor: 'pointer' }}>
                  <span style={{ fontSize: 10, color: '#94a3b8', width: 10 }}>{open ? '▼' : '▶'}</span>
                  <span style={{ fontWeight: 800, color: '#0f172a' }}>{p.supplier_name} · {p.round_no}차</span>
                  <span style={{ fontSize: 12, color: '#64748b' }}>입고 {p.received_date || '-'} · {lines.length}옵션</span>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: p.base_adjusted_at ? '#ccfbf1' : '#f1f5f9', color: p.base_adjusted_at ? '#0f766e' : '#64748b' }}>
                    {p.base_adjusted_at ? `조정 파일 생성 ${fmtDateTime(p.base_adjusted_at)} · ${savedPut.toLocaleString()}장` : '조정 전'}
                  </span>
                </div>
                {open && (() => {
                  const sum = adjLines.reduce((s, l) => ({
                    ship: s.ship + num(l.request_qty), recv: s.recv + num(l.received_qty), bad: s.bad + num(defectOfLine(l)),
                    left: s.left + leftOf(l), put: s.put + num(putOfLine(l)),
                  }), { ship: 0, recv: 0, bad: 0, left: 0, put: 0 });
                  return (
                    <div style={{ padding: '0 12px 12px' }}>
                      <div style={{ ...S.tableWrap, maxHeight: 420, overflowY: 'auto' }}>
                        <table style={S.table}>
                          <thead><tr>
                            <th style={S.th}>베이스 코드</th><th style={S.th}>베이스 상품</th><th style={S.th}>옵션</th><th style={S.th}>아트웍 상품</th>
                            <th style={{ ...S.th, textAlign: 'right' }}>1차 출고</th><th style={{ ...S.th, textAlign: 'right' }}>입고</th>
                            <th style={{ ...S.th, textAlign: 'right' }}>불량</th><th style={{ ...S.th, textAlign: 'right' }}>남은 베이스</th>
                            <th style={{ ...S.th, textAlign: 'right' }}>어드민에 넣을 수량</th><th style={S.th}>비고</th>
                          </tr></thead>
                          <tbody>
                            {adjLines.map((l) => {
                              const left = leftOf(l);
                              const put = putOfLine(l);
                              return (
                                <tr key={l.id}>
                                  <td style={{ ...S.td, ...S.mono }}>{l.base_code || '-'}</td>
                                  <td style={{ ...S.td, color: l.base_code ? '#334155' : '#dc2626' }}>{l.base_name || '베이스 없음'}</td>
                                  <td style={S.td}>{l.option_name}</td>
                                  <td style={{ ...S.td, color: '#64748b', fontSize: 12 }}>{l.artwork_name}</td>
                                  <td style={{ ...S.td, textAlign: 'right' }}>{num(l.request_qty).toLocaleString()}</td>
                                  <td style={{ ...S.td, textAlign: 'right' }}>{num(l.received_qty).toLocaleString()}</td>
                                  <td style={{ ...S.td, textAlign: 'right' }}>
                                    <input type="number" min={0} value={defectOfLine(l)} placeholder="0"
                                      onChange={(e) => { const v = e.target.value; setDefectOf((s) => ({ ...s, [l.id]: v })); setPutOf((s) => { const n = { ...s }; delete n[l.id]; return n; }); }}
                                      style={{ ...S.qty, color: '#b45309' }} />
                                  </td>
                                  <td style={{ ...S.td, textAlign: 'right', fontWeight: 700, color: left < 0 ? '#dc2626' : '#334155' }}>{left}</td>
                                  <td style={{ ...S.td, textAlign: 'right' }}>
                                    <input type="number" min={0} value={put} disabled={!l.base_code}
                                      onChange={(e) => setPutOf((s) => ({ ...s, [l.id]: e.target.value }))} style={S.qty} />
                                  </td>
                                  <td style={{ ...S.td, fontSize: 11, color: '#b91c1c' }}>
                                    {!l.base_code ? '베이스 없음 — 제외' : left < 0 ? `${-left}장 초과 입고 · 추가 차감 없음` : left >= 20 && left >= num(l.request_qty) / 2 ? '미입고 많음 · 업체 잔여 확인' : ''}
                                  </td>
                                </tr>
                              );
                            })}
                            <tr style={{ background: '#f8fafc' }}>
                              <td style={{ ...S.td, fontWeight: 700 }} colSpan={4}>합계</td>
                              {[sum.ship, sum.recv, sum.bad, sum.left, sum.put].map((v, i) => (
                                <td key={i} style={{ ...S.td, textAlign: 'right', fontWeight: 800, color: i === 4 ? '#0f766e' : '#0f172a' }}>{v.toLocaleString()}</td>
                              ))}
                              <td style={S.td}></td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginTop: 10 }}>
                        <span style={{ fontSize: 12, color: '#64748b' }}>같은 베이스 코드는 합산 · 넣을 수량 0 은 파일에서 제외</span>
                        <button style={S.btn(true, saving)} disabled={saving} onClick={saveAdjust}>
                          {saving ? '저장 중…' : `저장 + 베이스 재고 조정 엑셀 (${sum.put.toLocaleString()}장)`}
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          });
        })()}
      </div>
    </div>
  );
}
