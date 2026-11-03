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
// sheets: [{name, rows(2차원 배열), cols?}]
async function saveXlsx(fileName, sheets) {
  const XLSX = await loadXLSX();
  const wb = XLSX.utils.book_new();
  sheets.forEach(({ name, rows, cols }) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    if (cols) ws['!cols'] = cols.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  });
  XLSX.writeFile(wb, fileName);
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
  // 한 가지 색(블루그레이)에서 진하기만 다르게 — 판매가 가장 진하고 베이스가 가장 옅음
  sold: { fg: '#1e3a5f', bg: '#d5dfec' },     // 판매
  incoming: { fg: '#2f5079', bg: '#e1e8f2' }, // 입고대기
  mfs: { fg: '#4a6a92', bg: '#ebf0f6' },      // MFS
  base: { fg: '#6a84a6', bg: '#f3f6fa' },     // 베이스
};

// 시트(sheet_print_orders) 업체명이 업체·단가 관리와 다른 경우 — 차수 추천용
const VENDOR_ALIAS = { 국제나염: ['국제나염', '국제프린팅'] };

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
  const [mfs, setMfs] = useState(null);         // {barcode: {avail, incoming, defect}} · null = 뷰 없음

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
  const [recvQty, setRecvQty] = useState({});    // {lineId: value}
  const [recvDate, setRecvDate] = useState(kstDate());
  const [extraOf, setExtraOf] = useState({});    // {baseCode: value} 추가출고 수동 수정
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
      setLoading(true);
      setError('');
      try {
        const [st, sup, psp, sheet, mfsRows] = await Promise.all([
          sbAll('v_option_current_stock?select=group_key,option_key,ba_flag,바코드,상품명,옵션,가용재고,입고대기,상품코드&order=상품코드.asc,옵션.asc'),
          sbFetch('print_suppliers?select=id,name,active&order=name.asc'),
          sbFetch('print_supplier_products?select=id,supplier_id,design_name,unit_cost,sample_status&limit=2000'),
          sbAll('sheet_print_orders?select=vendor,order_round&order=row_key.asc').catch(() => []),
          // MFS 최신 재고(뷰 v_mfs_stock_latest) — 없으면 MFS 줄 없이 동작
          sbAll('v_mfs_stock_latest?select=barcode,avail,incoming,defect&order=barcode.asc').catch(() => null),
        ]);
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
      }
    })();
    loadPos();
  }, [loadPos]);

  // 최근 N일 판매 — 무신사(배송·송장·접수·발주) + MFS(결제오류·환불/교환 클레임 제외)
  useEffect(() => {
    let alive = true;
    (async () => {
      setSalesLoading(true);
      try {
        const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
        const M = encodeURIComponent('MUSINSA Detailed Order');
        const [mu, mf] = await Promise.all([
          sbAll(`${M}?select=바코드,상품수량,주문수량&주문일=gte.${since}&상태=in.(배송,송장,접수,발주)&order=id.asc`),
          sbAll(`mfs_sales?select=barcode,quantity,order_status,claim_status&sale_date=gte.${since}&order=id.asc`),
        ]);
        const m = {};
        (mu || []).forEach((r) => { const b = r['바코드']; if (b) m[b] = (m[b] || 0) + (num(r['상품수량']) || num(r['주문수량'])); });
        (mf || []).forEach((r) => {
          if (!r.barcode || r.order_status === '결제오류') return;
          if (r.claim_status && r.claim_status !== '클레임무효') return;
          m[r.barcode] = (m[r.barcode] || 0) + num(r.quantity);
        });
        if (alive) setSales(m);
      } catch (e) {
        if (alive) flash('err', '판매 데이터를 불러오지 못했습니다');
      } finally {
        if (alive) setSalesLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [days]);

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
      out.push({ name, sold: colorList.reduce((s, c) => s + c.sold, 0), colors: colorList, cands: sup, season: String(rows[0].group_key || '')[3] || '' });
    });
    return out.sort((a, b) => b.sold - a.sold || a.name.localeCompare(b.name, 'ko'));
  }, [stock, designs, sales, baseIndex, mfs]);

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
    const art = [['이미지', '바코드', '상품코드', '상품명', '옵션', '의뢰수량', '조정', '비고']];
    let prev = '';
    lines.forEach((l) => {
      // 의뢰수량 = 입력·추천 수량, 조정 = 베이스 재고 한도 적용 후 실제 발주 수량
      const raw = l.raw_qty ?? l.request_qty;
      art.push(['', l.artwork_barcode, l.artwork_code, l.artwork_name === prev ? '' : l.artwork_name, l.option_name, raw, l.request_qty, raw !== l.request_qty ? '베이스 재고 한도' : '']);
      prev = l.artwork_name;
    });
    const artSum = lines.reduce((s, l) => s + l.request_qty, 0);
    const rawSum = lines.reduce((s, l) => s + (l.raw_qty ?? l.request_qty), 0);
    art.push(['', '', '', '', '합 계', rawSum, artSum, '']);
    const baseMap = new Map();
    lines.forEach((l) => {
      const k = l.base_code || `(베이스 없음) ${l.artwork_code}`;
      if (!baseMap.has(k)) baseMap.set(k, { code: l.base_code || '', name: l.base_name || '(베이스 없음)', option: l.option_name, qty: 0 });
      baseMap.get(k).qty += l.request_qty;
    });
    const bases = [...baseMap.values()];
    const req = [['상품코드', '베이스 상품코드', '상품명', '옵션', '수량', '1차 출고', '2차 출고', '차이', '박스 수량']];
    bases.forEach((b) => req.push(['', b.code, b.name, b.option, b.qty, b.qty, '', '', '']));
    req.push(['합 계', '', '', '', artSum, artSum, 0, 0, '']);
    await saveXlsx(`${N}차_${supplierName}_발송요청_${d6}.xlsx`, [
      { name: '상품별 수량', rows: art, cols: [8, 20, 10, 28, 18, 9, 9, 16] },
      { name: '발송 요청', rows: req, cols: [10, 14, 22, 18, 8, 9, 9, 7, 9] },
    ]);
    // 2) 베이스출고 — 베이스 상품코드 · 수량 · 메모 (이지어드민)
    const bm = `${d6}_${supplierName}_베이스출고_${N}차`;
    await saveXlsx(`${N}차_베이스출고_${supplierName}.xlsx`, [{
      name: 'Sheet1', cols: [10, 8, 32, 22, 18],
      rows: [['상품코드', '수량', '메모'], ...bases.filter((b) => b.code).map((b) => [b.code, b.qty, bm, b.name, b.option])],
    }]);
    // 3) 입고대기 — 아트웍 상품코드 · 의뢰수량 · 메모
    const wm = `${d6}_${supplierName}_입고대기_${N}차`;
    await saveXlsx(`${N}차_입고대기_${supplierName}.xlsx`, [{
      name: 'Sheet1', cols: [10, 8, 32, 26, 18],
      rows: [['상품코드', '수량', '메모'], ...lines.map((l) => [l.artwork_code, l.request_qty, wm, l.artwork_name, l.option_name])],
    }]);
  };

  // 업체 1곳 발주 저장 + 3개 파일
  const savePo = async (g) => {
    const m = metaOf(g);
    if (!num(m.round_no)) { flash('err', '차수를 입력해주세요'); return; }
    if (poMissing) { flash('err', '발주 저장 테이블이 없습니다 — supabase/print_po.sql 을 실행해주세요'); return; }
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
      await downloadRequestFiles(g.supplier_name, num(m.round_no), m.order_date, lines.map((x, i) => ({ ...x, raw_qty: g.lines[i].raw })));
      // 저장된 업체 상품은 선택 해제
      const done = new Set(g.lines.map((l) => l.product));
      setPicked((s) => { const n = { ...s }; done.forEach((k) => delete n[k]); return n; });
      await loadPos();
      flash('ok', `${g.supplier_name} ${m.round_no}차 저장 · 엑셀 3개 생성`);
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
  const extraRows = useMemo(() => {
    const m = new Map();
    curLines.forEach((l) => {
      if (!l.base_code) return;
      if (!m.has(l.base_code)) m.set(l.base_code, { code: l.base_code, name: l.base_name, option: l.option_name, diff: 0 });
      m.get(l.base_code).diff += num(recvOf(l)) - num(l.request_qty);
    });
    return [...m.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curLines, recvQty]);
  const extraOfRow = (r) => (r.code in extraOf ? extraOf[r.code] : r.diff);

  const openReceive = (p) => {
    setOpenPo(openPo === p.id ? null : p.id);
    setRecvQty({});
    setExtraOf({});
    setRecvDate(p.received_date || kstDate());
  };

  const saveReceive = async () => {
    if (!current) return;
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
      await saveXlsx(`${N}차_정상입고_${sup}.xlsx`, [{ name: 'Sheet1', cols, rows: [head, ...recvRows.map((l) => [l.artwork_code, num(recvOf(l)), `${d6}_${sup}_정상입고_${N}차`, l.artwork_name, l.option_name, l.artwork_barcode])] }]);
      await saveXlsx(`${N}차_MFS출고_${sup}.xlsx`, [{ name: 'Sheet1', cols, rows: [head, ...recvRows.map((l) => [l.artwork_code, num(recvOf(l)), `${d6}_${sup}_MFS출고_${N}차`, l.artwork_name, l.option_name, l.artwork_barcode])] }]);
      const em = `${yymmdd(current.order_date)}_베이스출고_${sup}_${N}차 (추가출고 수량 조정)`;
      await saveXlsx(`${N}차_베이스출고(추가출고)_${sup}.xlsx`, [{ name: 'Sheet1', cols: [10, 8, 40, 22, 18], rows: [['상품코드', '수량', '메모'], ...extraRows.map((r) => [r.code, num(extraOfRow(r)), em, r.name, r.option])] }]);
      await loadPos();
      flash('ok', `${sup} ${N}차 입고 저장 · 엑셀 3개 생성`);
    } catch (e) {
      flash('err', `입고 저장 실패 — ${String(e.message || e).slice(0, 80)}`);
    } finally {
      setSaving(false);
    }
  };

  // 저장한 발주의 발송요청 파일 다시 받기
  const redownload = (p) => downloadRequestFiles(p.supplier_name, p.round_no, p.order_date, [...(p.print_po_lines || [])].sort((a, b) => a.id - b.id))
    .catch(() => flash('err', '엑셀 생성 실패'));

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
        <h3 style={{ ...S.title, marginBottom: 12 }}><span style={S.step}>2</span>업체·차수별 발주 리스트</h3>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 800, color: '#0f172a' }}>{p.supplier_name} · {p.round_no}차</span>
                <span style={{ fontSize: 12, color: '#64748b' }}>발주 {p.order_date} · {lines.length}옵션 · {total.toLocaleString()}장</span>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: p.status === 'received' ? '#dcfce7' : '#e0e7ff', color: p.status === 'received' ? '#15803d' : '#4338ca' }}>
                  {p.status === 'received' ? `입고완료 ${p.received_date || ''} · ${recvTotal.toLocaleString()}장` : '발송요청'}
                </span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button style={{ ...S.btn(false, false), fontSize: 12 }} onClick={() => redownload(p)}>발주 엑셀 다시 받기</button>
                  <button style={{ ...S.btn(open, false), fontSize: 12 }} onClick={() => openReceive(p)}>{open ? '닫기' : '입고 처리'}</button>
                  <button style={{ ...S.btn(false, false), fontSize: 12, ...(delArm === p.id ? { borderColor: '#dc2626', color: '#dc2626', fontWeight: 700 } : {}) }} onClick={() => deletePo(p)}>
                    {delArm === p.id ? '한 번 더 누르면 삭제' : '삭제'}
                  </button>
                </span>
              </div>
              {open && (
                <div style={{ padding: '0 12px 12px' }}>
                  <div style={S.bar}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>입고일
                      <input type="date" value={recvDate} onChange={(e) => setRecvDate(e.target.value)} style={{ ...S.input, marginLeft: 4 }} />
                    </label>
                    <span style={{ fontSize: 12, color: '#64748b' }}>실입고수량을 입력하면 정상입고·MFS출고는 그 수량 그대로, 추가출고는 (실입고 − 의뢰)로 계산됩니다</span>
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
                    <div style={{ ...S.tableWrap, flex: '2 1 300px' }}>
                      <table style={S.table}>
                        <thead><tr><th style={S.th} colSpan={3}>베이스출고(추가출고) — 수정 가능</th></tr>
                          <tr><th style={S.th}>베이스 코드</th><th style={S.th}>옵션</th><th style={{ ...S.th, textAlign: 'right' }}>수량</th></tr></thead>
                        <tbody>
                          {extraRows.map((r) => (
                            <tr key={r.code}>
                              <td style={{ ...S.td, ...S.mono }}>{r.code}</td>
                              <td style={S.td}>{r.name} {r.option}</td>
                              <td style={{ ...S.td, textAlign: 'right' }}>
                                <input type="number" value={extraOfRow(r)} onChange={(e) => setExtraOf((s) => ({ ...s, [r.code]: e.target.value }))} style={S.qty} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                    <button style={S.btn(true, saving)} disabled={saving} onClick={saveReceive}>
                      {saving ? '저장 중…' : '입고 저장 + 엑셀 3개 (정상입고·MFS출고·추가출고)'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
