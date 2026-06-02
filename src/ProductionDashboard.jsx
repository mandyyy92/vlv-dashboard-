import { useState, useMemo, useRef, useEffect, Fragment } from "react";
import { sb, SUPABASE_URL, SUPABASE_KEY, sbHeaders } from "./lib/supabaseClient";

// ============================================================
// XLSX 동적 로딩 (CDN, 의존성 추가 없음)
// ============================================================
let __xlsxLoadPromise = null;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (__xlsxLoadPromise) return __xlsxLoadPromise;
  __xlsxLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error("XLSX 로드 실패"));
    document.head.appendChild(s);
  });
  return __xlsxLoadPromise;
}

// ============================================================
// 유틸리티
// ============================================================
// 오더 입고완료 판정 임계값 (입고율 ratio, 0~1). 나중에 쉽게 조정.
const COMPLETE_THRESHOLD = 0.9;

// 오더 상태 단일 판정 함수. 배지/KPI/탭/매트릭스 등 모든 곳이 이 결과를 동일하게 사용한다.
// 우선순위: 입고완료(입고율 >= 90%, 납기 지나도 우선) → 부분입고(입고율 0% 초과) → 지연(0% + 납기경과) → 진행중.
function determineOrderStatus(total_qty, received_qty, expected_final_date) {
  if (total_qty <= 0) return "in_progress";
  const ratio = received_qty / total_qty;
  if (ratio >= COMPLETE_THRESHOLD) return "completed"; // 입고완료를 가장 먼저 판정 (지연보다 우선)
  if (ratio > 0) return "partial";
  const overdue = expected_final_date && new Date(expected_final_date) < new Date();
  return overdue ? "delayed" : "in_progress";
}

function calcOrderTotals(order, items, inbounds) {
  const total_qty = items.reduce((s, it) => s + (it.order_qty || 0), 0);
  const received_qty = inbounds.reduce((s, ib) => s + (ib.qty || 0), 0);
  const remain_qty = received_qty - total_qty;

  const status = determineOrderStatus(total_qty, received_qty, order.expected_final_date);

  // 수동 저장된 실제 완료일이 있으면 우선 사용, 없으면 완납 시 마지막 입고일로 추정
  let actual_final_date = order.actual_final_date || null;
  if (!actual_final_date && received_qty >= total_qty && total_qty > 0 && inbounds.length > 0) {
    const sortedDates = inbounds.map(ib => ib.inbound_date).filter(Boolean).sort();
    actual_final_date = sortedDates[sortedDates.length - 1];
  }

  const leadtime_days = actual_final_date && order.contract_date
    ? Math.round((new Date(actual_final_date) - new Date(order.contract_date)) / 86400000)
    : null;

  return { total_qty, received_qty, remain_qty, status, leadtime_days, actual_final_date, receive_rate: total_qty ? Math.round((received_qty / total_qty) * 1000) / 10 : 0 };
}

const STATUS_LABEL = {
  in_progress: { ko: "진행중", color: "#64748B", bg: "#F1F5F9" },
  partial: { ko: "부분입고", color: "#0369A1", bg: "#E0F2FE" },
  completed: { ko: "입고완료", color: "#15803D", bg: "#DCFCE7" },
  delayed: { ko: "지연", color: "#B91C1C", bg: "#FEE2E2" },
};

const fmt = (n) => (n ?? 0).toLocaleString();
const pct = (n) => `${(n ?? 0).toFixed(1)}%`;
// 상품명 공백제거(매칭 키). RPC name_key와 동일 규칙.
const stripSpaces = (s) => String(s || "").replace(/\s/g, "");
// 두 날짜의 일수 차이 (to - from). 둘 중 하나라도 없으면 null
const dayDiff = (from, to) => {
  if (!from || !to) return null;
  return Math.round((new Date(to) - new Date(from)) / 86400000);
};

// ============================================================
// Supabase 헬퍼 (production 전용)
// ============================================================
const PO_API = `${SUPABASE_URL}/rest/v1`;

async function fetchOrders() {
  const r = await fetch(`${PO_API}/production_orders?select=*&order=created_at.desc`, { headers: sbHeaders });
  if (!r.ok) throw new Error("오더 조회 실패");
  return r.json();
}
async function fetchItems(orderId) {
  const r = await fetch(`${PO_API}/production_order_items?order_id=eq.${orderId}&select=*&order=id.asc`, { headers: sbHeaders });
  return r.ok ? r.json() : [];
}
async function fetchAllItems() {
  const r = await fetch(`${PO_API}/production_order_items?select=*&order=id.asc`, { headers: sbHeaders });
  return r.ok ? r.json() : [];
}
async function fetchInbounds(orderId) {
  const r = await fetch(`${PO_API}/inbound_history?order_id=eq.${orderId}&select=*&order=inbound_round.asc`, { headers: sbHeaders });
  return r.ok ? r.json() : [];
}
async function fetchAllInbounds() {
  const r = await fetch(`${PO_API}/inbound_history?select=*`, { headers: sbHeaders });
  return r.ok ? r.json() : [];
}
// 입고 라인(옵션별). inbound_history 와 별개로 색상×사이즈 단위 입고수량을 담는다.
async function fetchAllInboundLines() {
  const r = await fetch(`${PO_API}/inbound_lines?select=*`, { headers: sbHeaders });
  return r.ok ? r.json() : [];
}
async function insertInboundLines(lines) {
  if (!lines || lines.length === 0) return [];
  const r = await fetch(`${PO_API}/inbound_lines`, { method: "POST", headers: sbHeaders, body: JSON.stringify(lines) });
  if (!r.ok) throw new Error("입고 라인 저장 실패");
  return r.json();
}
// 특정 오더의 입고 차수(round)에 해당하는 라인 삭제. order_id/round 둘 다 영문/숫자 컬럼이라 in() 정상.
async function deleteInboundLinesByRounds(orderId, rounds) {
  const rs = [...new Set((rounds || []).filter(v => v != null))];
  if (orderId == null || rs.length === 0) return;
  await fetch(`${PO_API}/inbound_lines?order_id=eq.${orderId}&round=in.(${rs.join(",")})`, { method: "DELETE", headers: sbHeaders });
}
async function insertOrder(payload) {
  const r = await fetch(`${PO_API}/production_orders`, { method: "POST", headers: sbHeaders, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error("오더 생성 실패");
  return r.json();
}
async function insertItems(items) {
  const r = await fetch(`${PO_API}/production_order_items`, { method: "POST", headers: sbHeaders, body: JSON.stringify(items) });
  if (!r.ok) throw new Error("아이템 생성 실패");
  return r.json();
}
async function insertInbound(payload) {
  const r = await fetch(`${PO_API}/inbound_history`, { method: "POST", headers: sbHeaders, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error("입고 등록 실패");
  return r.json();
}
async function deleteOrder(id) {
  await fetch(`${PO_API}/production_orders?id=eq.${id}`, { method: "DELETE", headers: sbHeaders });
}
async function deleteAllOrders() {
  await fetch(`${PO_API}/production_orders?id=gt.0`, { method: "DELETE", headers: sbHeaders });
}
async function updateOrder(id, patch) {
  const r = await fetch(`${PO_API}/production_orders?id=eq.${id}`, { method: "PATCH", headers: sbHeaders, body: JSON.stringify(patch) });
  return r.ok ? r.json() : null;
}
async function deleteInbound(id) {
  const r = await fetch(`${PO_API}/inbound_history?id=eq.${id}`, { method: "DELETE", headers: sbHeaders });
  if (!r.ok) throw new Error("입고 기록 삭제 실패");
}
// 입고 이력 여러 건을 id 기준으로 삭제. id in.(...) 일괄 삭제 시도 후,
// 0건 삭제되면 id 하나씩 루프 delete로 폴백. 삭제된 건수를 반환.
async function deleteInbounds(ids) {
  const list = [...new Set((ids || []).filter(v => v != null))];
  if (list.length === 0) return 0;
  // 1차: in.(...) 일괄 삭제 (sbHeaders가 Prefer: return=representation 이라 삭제된 행을 반환)
  try {
    const r = await fetch(`${PO_API}/inbound_history?id=in.(${list.join(",")})`, { method: "DELETE", headers: sbHeaders });
    if (r.ok) {
      const rows = await r.json().catch(() => null);
      if (Array.isArray(rows) && rows.length > 0) return rows.length;
      // 0건이면 폴백으로 진행
    }
  } catch (e) {
    // 폴백으로 진행
  }
  // 폴백: id 하나씩 삭제
  let count = 0;
  for (const id of list) {
    const rr = await fetch(`${PO_API}/inbound_history?id=eq.${id}`, { method: "DELETE", headers: sbHeaders });
    if (rr.ok) count++;
  }
  if (count === 0) throw new Error("입고 기록 삭제 실패");
  return count;
}

// ============================================================
// 매핑 사전 (작업지시서 ↔ inventory)
// ============================================================

// 스타일NO 예외 매핑 (작업지시서 → inventory 바코드 prefix)
const STYLE_NO_MAP = {
  "V24ST01UA501": "V25ST006U",  // Restchill
  "V25ST01UA501": "V25ST57U",   // Graychill
  // 9자 짧은 스타일NO들 (자기 자신 매핑 - 9자 패턴 강제 사용)
  "V26PS01W": "V26PS01W",       // 나일론 롱 스커트
  "V26SP01U": "V26SP01U",       // 나일론 버뮤다 팬츠
};

// 색상 매핑 (작업지시서 영문 → inventory 바코드 2글자 코드)
const COLOR_MAP = {
  "BLACK": "BK",
  "WHITE": "OW",
  "NAVY": "NV",
  "CHARCOAL": "CO",
  "MELANGE": "ME",
  "WHITE MELANGE": "WM",
  "CREAM": "CM",
  "BURGUNDY": "BG",
  "GRAY": "GY",
  "GREY": "GY",
  "BEIGE": "BE",
  "BLUE": "BL",
  "LIGHT BLUE": "LB",
  "RED": "RE",
  "YELLOW": "YE",
  "KHAKI": "KA",
  "GREEN": "GR",
  "BROWN": "BR",
  "PINK": "PK",
  "ORANGE": "OR",
  "PURPLE": "PU",
  "IVORY": "IV",
};

// 색상 영문 → 한글 매핑 (상품명+옵션 검색용)
const COLOR_KR_MAP = {
  "BLACK": "블랙",
  "WHITE": "화이트",
  "NAVY": "네이비",
  "CHARCOAL": "차콜",
  "MELANGE": "멜란지",
  "WHITE MELANGE": "백멜란지",
  "CREAM": "크림",
  "BURGUNDY": "버건디",
  "GRAY": "그레이",
  "GREY": "그레이",
  "BEIGE": "베이지",
  "BLUE": "블루",
  "LIGHT BLUE": "라이트블루",
  "RED": "레드",
  "YELLOW": "옐로우",
  "KHAKI": "카키",
  "GREEN": "그린",
  "BROWN": "브라운",
  "PINK": "핑크",
  "ORANGE": "오렌지",
  "PURPLE": "퍼플",
  "IVORY": "아이보리",
};

// 색상 2글자 코드(NV/BK/CO…) → 한글 매핑. COLOR_MAP(영문→코드)와 COLOR_KR_MAP(영문→한글)을 결합해 자동 생성.
const COLOR_CODE_KR_MAP = Object.keys(COLOR_MAP).reduce((acc, en) => {
  const code = COLOR_MAP[en];
  const kr = COLOR_KR_MAP[en];
  if (code && kr && !acc[code]) acc[code] = kr;
  return acc;
}, {});

// 색상 정규화: 코드(NV)·영문(NAVY) → 한글(네이비)로 통일. 이미 한글이거나 매핑 없으면 원본.
// 발주(오더 아이템)·입고(inbound_lines) 양쪽 키를 같은 표현으로 맞추기 위함.
function normalizeColorKey(c) {
  const raw = String(c || "").trim().replace(/\s*\(.*\)\s*$/, "").trim(); // "크림(114)" → "크림"
  if (!raw) return "";
  const up = raw.toUpperCase();
  if (COLOR_KR_MAP[up]) return COLOR_KR_MAP[up];        // 영문 색상명
  if (COLOR_CODE_KR_MAP[up]) return COLOR_CODE_KR_MAP[up]; // 2글자 색상코드
  return raw;                                            // 이미 한글 등
}

// 사이즈 정규화: "90(S)"→"S", "OS"→"FREE", 그 외 대문자 표준화(M/L/XL…).
function normalizeSizeKey(s) {
  const raw = String(s || "").trim();
  if (!raw) return "";
  const m = raw.match(/\(([^)]+)\)/);          // "90(S)" → "S"
  const base = (m ? m[1] : raw).trim().toUpperCase();
  return base === "OS" ? "FREE" : base;
}

// 영문 상품명 → 한글 상품명 매핑 (작업지시서 → inventory)
const PRODUCT_NAME_KR_MAP = {
  "Essential": "에센셜",
  "Restchill": "Restchill",
  "Unisex Ringer T-shirt": "공용 링거티",
  "Women's Long Sleeve T-shirt": "우먼 롱슬리브",
  "W.Slim": "W.슬림",
  "Women's Ringer T-shirt": "우먼 링거티",
  "Men's Crop T-shirt": "맨즈 크롭 반팔",
  "Graychill": "Graychill",
  // 신상품 추가
  "Layered Skirt": "레이어드 스커트",
  "Nylon Long Skirt": "롱스커트",
  "Nylon Bermuda Pants": "나일론 버뮤다 팬츠",
  "Unisex Windbreaker": "공용 바람막이",
  "Pigment T-shirt": "피그먼트",
  "Pigment Tee": "피그먼트",
};

// 사이즈 → 한글 사이즈 표기 변환 (S → 90(S))
const SIZE_KR_MAP = {
  "S": "90(S)",
  "M": "95(M)",
  "L": "100(L)",
  "XL": "105(XL)",
  "2XL": "110(2XL)",
  "FREE": "FREE",
  "OS": "FREE",
};

// 사이즈 변환 (작업지시서 → 바코드 끝 부분)
function sizeToBarcodeSuffix(size, stylePrefix) {
  const s = String(size).trim().toUpperCase();
  // 12자 스타일NO (V24ST01UB400 같은 표준 패턴): "00" + 사이즈
  const isStdPattern = stylePrefix.length >= 12;
  if (isStdPattern) {
    if (s === "FREE" || s === "OS") return ["00F", "FRE"]; // 두 패턴 다 시도
    if (s === "XL" || s === "2XL") return ["0XL"];
    if (s === "S" || s === "M" || s === "L") return [`00${s}`];
    return [`00${s}`];
  } else {
    // 9자 짧은 스타일NO (V25ST006U 같은 예외 패턴): 사이즈만
    if (s === "FREE" || s === "OS") return ["FRE", "FREE"];
    if (s === "XL" || s === "2XL") return ["X", "XL"];
    return [s];
  }
}

// 작업지시서 한 라인 → 바코드 후보 리스트 생성
function buildBarcodeCandidates(styleNo, color, size) {
  // 1) 스타일NO 매핑 적용
  const stylePrefix = STYLE_NO_MAP[styleNo] || styleNo;
  
  // 2) 색상 약자 변환
  const colorCode = COLOR_MAP[color.toUpperCase()] || color.substring(0, 2).toUpperCase();
  
  // 3) 사이즈 후보들
  const sizeSuffixes = sizeToBarcodeSuffix(size, stylePrefix);
  
  // 4) 조합
  return sizeSuffixes.map(suffix => `${stylePrefix}${colorCode}${suffix}`);
}

// inventory에서 바코드들로 SKU 코드 검색 (RPC 함수 호출)
async function lookupInventoryBySkus(barcodes) {
  if (!barcodes || barcodes.length === 0) return {};
  const url = `${SUPABASE_URL}/rest/v1/rpc/lookup_inventory_by_barcodes`;
  console.log("[inventory 조회] RPC 호출, 바코드 수:", barcodes.length);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: sbHeaders,
      body: JSON.stringify({ barcode_list: barcodes }),
    });
    console.log("[inventory 조회] 응답 status:", r.status);
    if (!r.ok) {
      const errText = await r.text();
      console.error("[inventory 조회] 실패", r.status, errText);
      return {};
    }
    const rows = await r.json();
    console.log("[inventory 조회] 받은 row 수:", rows.length);
    if (rows.length > 0) console.log("[inventory 조회] 첫 row:", rows[0]);
    const map = {};
    for (const row of rows) {
      const barcode = row.barcode;
      if (barcode && !map[barcode]) {
        map[barcode] = {
          sku_code: row.sku_code,
          name: row.product_name,
          option: row.option,
        };
      }
    }
    return map;
  } catch (e) {
    console.error("[inventory 조회] 예외", e);
    return {};
  }
}

// 한 라인의 SKU 코드 찾기 (여러 바코드 후보 중 첫 매칭)
function findSkuFromInventoryMap(invMap, styleNo, color, size) {
  const candidates = buildBarcodeCandidates(styleNo, color, size);
  for (const bc of candidates) {
    if (invMap[bc]) return { ...invMap[bc], matched_barcode: bc, match_method: "barcode" };
  }
  return null;
}

// inventory(상품마스터) 상품명 정규화: 첫 '-' 기준으로 뒤쪽만 사용.
// 예) '하의-나일론 버뮤다 팬츠' → '나일론 버뮤다 팬츠'.  '-' 없으면 전체 그대로.
function normalizeInventoryName(name) {
  const s = String(name || "").trim();
  const i = s.indexOf("-");
  return (i === -1 ? s : s.slice(i + 1)).trim();
}

// 한글 상품명+옵션으로 inventory 검색 (RPC 함수 fallback 매칭)
// 비교 규칙: 작업지시서 상품명(한글) vs '-' 뒤로 정규화한 inventory 상품명을 trim 후 비교.
//           일치(=) 우선, 없으면 포함관계. (서버측 RPC SQL과 동일 로직을 클라이언트에서도 적용)
async function lookupInventoryByNameAndOption(productNameEn, color, size) {
  // 작업지시서 상품명은 이미 한글('나일론 버뮤다 팬츠')인 경우가 많음.
  // 영문이면 한글로 매핑, 한글이면 그대로 사용.
  const targetName = (PRODUCT_NAME_KR_MAP[productNameEn] || productNameEn || "").trim();
  if (!targetName) return null;

  // 옵션은 '[한글색상-사이즈]' 형식 그대로 비교. inventory 옵션이 이미 한글이라
  // 색상 영문코드 변환(NAVY→NV 등)은 쓰지 않는다.
  const colorKr = COLOR_KR_MAP[String(color || "").toUpperCase()] || color;
  const sizeSimple = String(size || "").toUpperCase().trim();
  const sizeKr = SIZE_KR_MAP[sizeSimple] || sizeSimple;

  // 원사이즈(FREE/F/OS/없음/'-'/빈값): inventory가 [색상-OS]·[색상-FREE] 등 어떤 사이즈 토큰으로
  // 저장돼도 잡히도록 LIKE 와일드카드 패턴 사용. (Postgres LIKE에서 %만 와일드카드, []는 리터럴)
  const isFreeSize = ["", "FREE", "F", "OS", "없음", "-"].includes(sizeSimple);
  let optionPatterns;
  if (isFreeSize) {
    optionPatterns = [
      `[${colorKr}-%]`,   // [베이지-OS], [베이지-FREE] 등 그 색상의 어떤 사이즈든 매칭
      `[${colorKr}]`,     // 사이즈 없이 색상만 저장한 경우
    ];
  } else {
    // 일반 사이즈(S/M/L 등)는 기존 [색상-사이즈] 패턴 그대로
    optionPatterns = [
      `[${colorKr}-${sizeSimple}]`,
      `[${colorKr}-${sizeKr}]`,
    ];
  }
  const uniquePatterns = [...new Set(optionPatterns)];

  const url = `${SUPABASE_URL}/rest/v1/rpc/lookup_inventory_by_name_option`;

  for (const pattern of uniquePatterns) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: sbHeaders,
        body: JSON.stringify({
          name_kr: targetName,
          option_pattern: pattern,
        }),
      });
      if (!r.ok) continue;
      const rows = await r.json();
      if (!rows || rows.length === 0) continue;

      // inventory 상품명을 '-' 뒤로 정규화 후 비교: 일치 우선 → 없으면 포함관계 → 그래도 없으면 첫 행
      const exact = rows.find(row => normalizeInventoryName(row.product_name) === targetName);
      const partial = rows.find(row => {
        const n = normalizeInventoryName(row.product_name);
        return n.includes(targetName) || targetName.includes(n);
      });
      const row = exact || partial || rows[0];

      return {
        sku_code: row.sku_code,
        barcode: row.barcode,
        name: row.product_name,
        option: row.option,
        match_method: "name_option",
      };
    } catch (e) {
      continue;
    }
  }
  return null;
}

// 상품코드(S21895)로 inventory 조회 → 상품명/옵션 반환
async function lookupInventoryByProductCode(skuCodes) {
  if (!skuCodes || skuCodes.length === 0) return {};
  const colCode = '%22%EC%83%81%ED%92%88%EC%BD%94%EB%93%9C%22';
  // PostgREST in 연산자: 따옴표 없이 쉼표로 구분
  const inList = skuCodes.join(",");
  const url = `${SUPABASE_URL}/rest/v1/inventory?${colCode}=in.(${encodeURIComponent(inList)})&select=*`;
  try {
    const r = await fetch(url, { headers: sbHeaders });
    if (!r.ok) {
      console.error("inventory 조회 실패", r.status);
      return {};
    }
    const rows = await r.json();
    const map = {};
    for (const row of rows) {
      const code = row["상품코드"];
      if (code && !map[code]) {
        map[code] = {
          barcode: row["바코드"],
          name: row["상품명"],
          option: row["옵션"],
        };
      }
    }
    return map;
  } catch (e) {
    console.error("inventory 조회 예외", e);
    return {};
  }
}

// 상품명(공백제거 키)으로 상품 썸네일 일괄 조회 (RPC lookup_image_by_name)
// 입력: 공백제거한 상품명 배열. 반환: { name_key: image_url } 맵.
async function lookupImagesByNames(nameKeys) {
  if (!nameKeys || nameKeys.length === 0) return {};
  const url = `${SUPABASE_URL}/rest/v1/rpc/lookup_image_by_name`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: sbHeaders,
      body: JSON.stringify({ p_names: nameKeys }),
    });
    if (!r.ok) {
      console.error("[이미지 조회] 실패", r.status, await r.text());
      return {};
    }
    const rows = await r.json();
    const map = {};
    for (const row of rows || []) {
      if (row.name_key && row.image_url && !map[row.name_key]) {
        map[row.name_key] = row.image_url;
      }
    }
    return map;
  } catch (e) {
    console.error("[이미지 조회] 예외", e);
    return {};
  }
}

// ============================================================
// 엑셀 파서 (PowerShell 스크립트와 동일 로직)
// ============================================================
async function parseWorkorder(file) {
  const XLSX = await loadXlsx();
  const ab = await file.arrayBuffer();
  const wb = XLSX.read(ab, { type: "array", cellDates: true, sheetStubs: false });

  const allItems = [];
  const skippedSheets = [];
  const sheetsSummary = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const hidden = wb.Workbook?.Sheets?.find(s => s.name === sheetName)?.Hidden;
    if (hidden && hidden !== 0) {
      skippedSheets.push(sheetName);
      continue;
    }

    // 셀 단위 직접 접근
    const cell = (r, c) => {
      const ref = XLSX.utils.encode_cell({ r: r - 1, c: c - 1 });
      const v = ws[ref];
      return v ? v.v : null;
    };

    const range = XLSX.utils.decode_range(ws["!ref"] || "A1:Z40");

    // 'STYLE NO' 헤더를 찾아 그 블록에서 스타일NO·상품명·작업처 값을 읽는다.
    // 상품명은 시트 탭 이름이 아니라 'STYLE NO 값 오른쪽의 상품명 셀'(보통 C5)을 사용.
    let styleNo = null, productName = null, factory = null;
    {
      let sr = 0, sc = 0;
      outerS: for (let r = 1; r <= Math.min(range.e.r + 1, 20); r++) {
        for (let c = 1; c <= range.e.c + 1; c++) {
          const v = cell(r, c);
          if (v && String(v).replace(/\s/g, "").toUpperCase().includes("STYLENO")) {
            sr = r; sc = c; break outerS;
          }
        }
      }
      if (sr > 0) {
        // 같은 행 오른쪽 셀이 값이면 인라인 라벨, 비었거나 헤더 텍스트면 컬럼 헤더(값은 다음 행)
        const rightVal = cell(sr, sc + 1);
        const rightTrim = rightVal == null ? "" : String(rightVal).replace(/\s/g, "");
        const isHeaderRow = rightTrim === "" || ["상품명", "품명", "작업처", "작업장", "공장"].includes(rightTrim);
        if (isHeaderRow) {
          styleNo = cell(sr + 1, sc);
          productName = cell(sr + 1, sc + 1);
          factory = cell(sr + 1, sc + 2);
        } else {
          styleNo = cell(sr, sc + 1);
          productName = cell(sr, sc + 2);
          factory = cell(sr, sc + 3);
        }
      } else {
        // 'STYLE NO'를 못 찾으면 기존 고정 위치(B5/C5/D5)로 fallback
        styleNo = cell(5, 2);
        productName = cell(5, 3);
        factory = cell(5, 4);
      }
    }
    if (!styleNo || !String(styleNo).trim()) continue;

    // COLOR 헤더 위치 탐색 (시트를 위→아래 스캔. "COLOR" 뿐 아니라 "COLOR(스와치 컬러)" 등도 인식)
    let colorRow = 0, colorCol = 0;
    outer: for (let r = 1; r <= range.e.r + 1; r++) {
      for (let c = 1; c <= range.e.c + 1; c++) {
        const v = cell(r, c);
        if (v && String(v).trim().toUpperCase().startsWith("COLOR")) {
          colorRow = r; colorCol = c;
          break outer;
        }
      }
    }
    if (colorRow === 0) continue;

    // 사이즈 헤더
    const sizes = [];
    for (let c = colorCol + 1; c <= range.e.c + 1; c++) {
      const s = cell(colorRow + 1, c);
      if (s) {
        const sTrim = String(s).trim();
        if (sTrim && sTrim !== "Q'TY" && sTrim !== "QTY") sizes.push({ col: c, size: sTrim });
      }
    }

    let sheetTotal = 0;
    let sheetSkus = 0;
    for (let dr = colorRow + 2; dr <= range.e.r + 1; dr++) {
      const color = cell(dr, colorCol);
      if (!color || !String(color).trim()) continue;
      // 색상값에 붙은 괄호코드(예: "크림(114)", "블랙(33)") 제거 → 매칭은 괄호 앞부분만 사용
      const colorClean = String(color).trim().replace(/\s*\(.*\)\s*$/, "").trim() || String(color).trim();
      for (const sz of sizes) {
        const qty = cell(dr, sz.col);
        if (typeof qty === "number" && qty > 0) {
          allItems.push({
            sheet: sheetName,
            style_no: String(styleNo).trim(),
            product_name: String(productName || "").trim(),
            factory: String(factory || "").trim(),
            color: colorClean,
            size: sz.size,
            qty: Math.round(qty),
          });
          sheetTotal += Math.round(qty);
          sheetSkus++;
        }
      }
    }

    if (sheetTotal > 0) {
      sheetsSummary.push({ name: sheetName, style: String(styleNo).trim(), product: String(productName || ""), qty: sheetTotal, skus: sheetSkus });
    }
  }

  const totalQty = allItems.reduce((s, it) => s + it.qty, 0);
  const factories = [...new Set(allItems.map(it => it.factory))].filter(Boolean);

  return {
    items: allItems,
    total_qty: totalQty,
    sku_count: allItems.length,
    sheets_processed: sheetsSummary.length,
    sheets_summary: sheetsSummary,
    skipped_sheets: skippedSheets,
    factories,
  };
}

// ============================================================
// 패킹리스트 파서
// 양식: 헤더 행을 '상품코드'/'수량' 등 헤더 텍스트로 스캔해 컬럼 위치를 잡음.
//   예) 상품코드(S21766) · 상품명(하의-롱스커트) · 옵션([라이트베이지]) · 수량 · 메모(무시)
//   SKU 매칭은 상품코드(S코드)=sku_code 로 직접 수행. 옵션의 색상/사이즈는 보조 확인용.
// ============================================================
async function parsePackingList(file) {
  const XLSX = await loadXlsx();
  const ab = await file.arrayBuffer();
  const wb = XLSX.read(ab, { type: "array", cellDates: true });

  const allLines = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const hidden = wb.Workbook?.Sheets?.find(s => s.name === sheetName)?.Hidden;
    if (hidden && hidden !== 0) continue;

    const range = XLSX.utils.decode_range(ws["!ref"] || "A1:F1");
    const cellAt = (r, c) => {
      const ref = XLSX.utils.encode_cell({ r, c }); // 0-based
      return ws[ref] ? ws[ref].v : null;
    };

    // 헤더 행 탐색: '상품코드'(코드)와 '수량' 텍스트가 같은 행에 있으면 헤더로 인식
    let headerRow = -1;
    const col = {}; // role -> 0-based 컬럼 인덱스
    for (let r = range.s.r; r <= range.e.r; r++) {
      const map = {};
      for (let c = range.s.c; c <= range.e.c; c++) {
        const v = cellAt(r, c);
        if (v == null) continue;
        const t = String(v).replace(/\s/g, "");
        if (!t) continue;
        if (map.code === undefined && (t === "상품코드" || t === "코드" || t.includes("상품코드"))) map.code = c;
        else if (map.name === undefined && (t === "상품명" || t.includes("상품명") || t.includes("품명"))) map.name = c;
        else if (map.option === undefined && (t === "옵션" || t.includes("옵션"))) map.option = c;
        else if (map.qty === undefined && (t === "수량" || t.includes("수량") || t.toUpperCase() === "QTY" || t === "Q'TY")) map.qty = c;
        else if (map.memo === undefined && (t === "메모" || t.includes("메모") || t.includes("비고"))) map.memo = c;
      }
      if (map.code !== undefined && map.qty !== undefined) { headerRow = r; Object.assign(col, map); break; }
    }

    // 헤더를 못 찾으면 기본 양식(A=상품코드, B=상품명, C=옵션, D=수량, E=메모)으로 가정
    let startRow;
    if (headerRow === -1) {
      col.code = 0; col.name = 1; col.option = 2; col.qty = 3; col.memo = 4;
      // 1행이 헤더면 건너뛰기: A1이 S로 시작하는 코드면 데이터 행으로 간주
      const a1 = cellAt(range.s.r, 0);
      startRow = (a1 && /^S\d/i.test(String(a1).trim())) ? range.s.r : range.s.r + 1;
    } else {
      startRow = headerRow + 1;
    }

    for (let r = startRow; r <= range.e.r; r++) {
      const code = col.code !== undefined ? cellAt(r, col.code) : null;
      const name = col.name !== undefined ? cellAt(r, col.name) : null;
      const option = col.option !== undefined ? cellAt(r, col.option) : null;
      const qtyRaw = col.qty !== undefined ? cellAt(r, col.qty) : null;

      const codeStr = String(code || "").trim();
      const qty = typeof qtyRaw === "number" ? qtyRaw : Number(String(qtyRaw ?? "").replace(/[^\d.-]/g, ""));
      if (!codeStr || !qty || isNaN(qty) || qty <= 0) continue;

      // 옵션 파싱: [색상-사이즈] 또는 [색상] (사이즈 없는 색상-only 허용)
      let color = "", size = "";
      const inner = String(option || "").trim().replace(/^\[/, "").replace(/\]$/, "").trim();
      if (inner) {
        const dash = inner.indexOf("-");
        if (dash >= 0) {
          color = inner.slice(0, dash).trim();
          size = inner.slice(dash + 1).trim();
        } else {
          color = inner; // 색상-only
        }
      }

      allLines.push({
        sku_code: codeStr,
        product_name: String(name || "").trim(),
        color,
        size,
        qty: Math.round(qty),
      });
    }
  }
  
  // 상품명별 집계
  const byProduct = {};
  for (const line of allLines) {
    if (!byProduct[line.product_name]) byProduct[line.product_name] = { qty: 0, lines: [], sku_codes: new Set() };
    byProduct[line.product_name].qty += line.qty;
    byProduct[line.product_name].lines.push(line);
    byProduct[line.product_name].sku_codes.add(line.sku_code);
  }
  
  const productSummary = Object.entries(byProduct).map(([name, v]) => ({
    product_name: name,
    qty: v.qty,
    line_count: v.lines.length,
    sku_count: v.sku_codes.size,
    lines: v.lines,
  }));
  
  return {
    lines: allLines,
    total_qty: allLines.reduce((s, l) => s + l.qty, 0),
    line_count: allLines.length,
    product_summary: productSummary,
  };
}

// ============================================================
// 메인 컴포넌트
// ============================================================
export default function ProductionDashboard() {
  const [orders, setOrders] = useState([]);
  const [itemsByOrder, setItemsByOrder] = useState({});
  const [inboundsByOrder, setInboundsByOrder] = useState({});
  const [inboundLinesByOrder, setInboundLinesByOrder] = useState({}); // 옵션별 입고 라인
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const [showInbound, setShowInbound] = useState(null);
  const [showPacking, setShowPacking] = useState(false);
  const [imageMap, setImageMap] = useState({});            // { name_key: image_url }
  const [vendorFilter, setVendorFilter] = useState("all"); // 'all' | 업체명
  const [seasonFilter, setSeasonFilter] = useState("all"); // 'all' | 시즌(26SS 등)
  const [search, setSearch] = useState(""); // 상품명/스타일NO/오더NO 검색
  const [collapsedVendors, setCollapsedVendors] = useState({}); // { 업체명: true=접힘 }

  // 데이터 로드
  const reload = async () => {
    setLoading(true);
    try {
      const ordersData = await fetchOrders();
      const itemsData = await fetchAllItems();
      const inboundsData = await fetchAllInbounds();
      const linesData = await fetchAllInboundLines();
      const im = {}, ibm = {}, ilm = {};
      itemsData.forEach(it => { (im[it.order_id] = im[it.order_id] || []).push(it); });
      inboundsData.forEach(ib => { (ibm[ib.order_id] = ibm[ib.order_id] || []).push(ib); });
      linesData.forEach(ln => { (ilm[ln.order_id] = ilm[ln.order_id] || []).push(ln); });
      setOrders(ordersData || []);
      setItemsByOrder(im);
      setInboundsByOrder(ibm);
      setInboundLinesByOrder(ilm);
    } catch (e) {
      console.error(e);
      alert("데이터 로드 실패: " + e.message);
    }
    setLoading(false);
  };

  useEffect(() => { reload(); }, []);

  // 시즌 추출: season 컬럼 우선, 없으면 오더 NO에서 파싱(PO-26SS-024 → 26SS)
  const seasonOf = (o) => (o.season || String(o.order_no || "").split("-")[1] || "").trim() || "미지정";

  // 표시 번호 맵: { orderId: '26SS-N차' }. 시즌별로 업로드(created_at) 오름차순 순위(1부터), 동률은 id.
  // ★동적 계산(저장 X)★ — 삭제 시 자동으로 뒤 차수가 당겨짐. 내부 id/오더NO는 그대로 유지.
  const displayNoMap = useMemo(() => {
    const bySeason = {};
    orders.forEach(o => { (bySeason[seasonOf(o)] = bySeason[seasonOf(o)] || []).push(o); });
    const map = {};
    Object.entries(bySeason).forEach(([s, list]) => {
      [...list]
        .sort((a, b) => {
          if (a.created_at && b.created_at) { const d = new Date(a.created_at) - new Date(b.created_at); if (d) return d; }
          return (a.id || 0) - (b.id || 0);
        })
        .forEach((o, i) => { map[o.id] = `${s}-${i + 1}차`; });
    });
    return map;
  }, [orders]);

  // 집계
  const enriched = useMemo(() => {
    return orders.map(o => {
      const items = itemsByOrder[o.id] || [];
      const inbounds = inboundsByOrder[o.id] || [];
      const inboundLines = inboundLinesByOrder[o.id] || [];
      const calc = calcOrderTotals(o, items, inbounds);
      return { ...o, ...calc, items, inbounds, inboundLines, display_no: displayNoMap[o.id] || o.order_no };
    });
  }, [orders, itemsByOrder, inboundsByOrder, inboundLinesByOrder, displayNoMap]);

  // 표시되는 오더들의 상품명(공백제거) → 썸네일 일괄 조회
  useEffect(() => {
    const keys = [...new Set(
      enriched.map(o => stripSpaces(o.items[0]?.product_name)).filter(Boolean)
    )];
    if (keys.length === 0) { setImageMap({}); return; }
    let cancelled = false;
    lookupImagesByNames(keys).then(m => { if (!cancelled) setImageMap(m); });
    return () => { cancelled = true; };
  }, [enriched]);

  // 시즌 목록 (드롭다운 필터용)
  const seasonList = useMemo(
    () => [...new Set(enriched.map(seasonOf))].sort((a, b) => a.localeCompare(b, "ko")),
    [enriched]
  );

  // 시즌 스코프: 선택 시즌으로 전체 대시보드 데이터를 먼저 한정 → KPI/탭/업체목록/표가 모두 이 위에서 재계산
  const scoped = useMemo(
    () => seasonFilter === "all" ? enriched : enriched.filter(o => seasonOf(o) === seasonFilter),
    [enriched, seasonFilter]
  );

  // 업체 목록 (드롭다운 필터용) — 현재 시즌 스코프 기준
  const vendorList = useMemo(
    () => [...new Set(scoped.map(o => o.vendor_name || "미지정"))].sort((a, b) => a.localeCompare(b, "ko")),
    [scoped]
  );

  // 시즌 AND 상태 탭 AND 업체 AND 검색어 필터 적용
  const filtered = useMemo(() => {
    let list = scoped;
    if (tab !== "all" && tab !== "analytics") list = list.filter(o => o.status === tab);
    if (vendorFilter !== "all") list = list.filter(o => (o.vendor_name || "미지정") === vendorFilter);
    const q = String(search || "").replace(/\s/g, "").toLowerCase();
    if (q) {
      list = list.filter(o => {
        const hay = [o.items[0]?.product_name, o.items[0]?.style_no, o.order_no, o.display_no]
          .map(v => String(v || "").replace(/\s/g, "").toLowerCase()).join("|");
        return hay.includes(q);
      });
    }
    return list;
  }, [scoped, tab, vendorFilter, search]);

  // 등록 순(오름차순) 비교: created_at → 없으면 id → 없으면 오더 NO 끝 숫자(PO-26SS-NNN)
  const byRegistrationAsc = (a, b) => {
    if (a.created_at && b.created_at) return new Date(a.created_at) - new Date(b.created_at);
    if (a.id != null && b.id != null) return a.id - b.id;
    const tail = (no) => parseInt(String(no || "").match(/(\d+)\s*$/)?.[1] ?? "0", 10);
    return tail(a.order_no) - tail(b.order_no);
  };

  // 업체 그룹 내부 정렬: 같은 상품명끼리 묶되, 묶음 순서는 그 상품명의 최초 등록순, 묶음 안은 등록순.
  // 등록순 오름차순으로 먼저 정렬한 뒤 상품명별로 모으면(Map은 삽입순 유지) 자연히 충족된다.
  const clusterByProduct = (list) => {
    const sorted = [...list].sort(byRegistrationAsc);
    const clusters = new Map(); // 상품명 → 오더[] (최초 등장 순서 유지 = 최초 등록순)
    for (const o of sorted) {
      const name = o.items?.[0]?.product_name || "—";
      if (!clusters.has(name)) clusters.set(name, []);
      clusters.get(name).push(o);
    }
    return [...clusters.values()].flat();
  };

  // 업체별 그룹핑 (그룹 헤더용 합계 포함). 각 그룹 안에서는 상품명 묶음 + 등록 순.
  const grouped = useMemo(() => {
    const map = {};
    filtered.forEach(o => {
      const key = o.vendor_name || "미지정";
      (map[key] = map[key] || []).push(o);
    });
    return Object.entries(map)
      .map(([vendor, list]) => {
        const sortedList = clusterByProduct(list);
        const total = sortedList.reduce((s, o) => s + o.total_qty, 0);
        const received = sortedList.reduce((s, o) => s + o.received_qty, 0);
        return { vendor, list: sortedList, total, received, rate: total ? (received / total) * 100 : 0 };
      })
      .sort((a, b) => a.vendor.localeCompare(b.vendor, "ko"));
  }, [filtered]);

  const toggleVendor = (vendor) =>
    setCollapsedVendors(prev => ({ ...prev, [vendor]: !prev[vendor] }));

  const kpi = useMemo(() => {
    const total = scoped.reduce((s, o) => s + o.total_qty, 0);
    const received = scoped.reduce((s, o) => s + o.received_qty, 0);
    const remain = received - total;
    const unreceived = Math.max(0, total - received); // 미입고 수량(양수)
    const delayed = scoped.filter(o => o.status === "delayed").length;
    const partial = scoped.filter(o => o.status === "partial").length;
    const completed = scoped.filter(o => o.status === "completed").length;
    const inProgress = scoped.filter(o => o.status === "in_progress").length;
    const leadtimes = scoped.filter(o => o.leadtime_days != null).map(o => o.leadtime_days);
    const avgLeadtime = leadtimes.length ? Math.round(leadtimes.reduce((a, b) => a + b, 0) / leadtimes.length) : null;
    return { total, received, remain, unreceived, delayed, partial, completed, inProgress, avgLeadtime, rate: total ? (received / total) * 100 : 0 };
  }, [scoped]);

  const selected = enriched.find(o => o.id === selectedId);

  const handleAddInbound = async (orderId, inbound) => {
    try {
      const round = (inboundsByOrder[orderId]?.length || 0) + 1;
      const items = itemsByOrder[orderId] || [];
      const firstItem = items[0];
      if (!firstItem) { alert("아이템이 없어 입고를 등록할 수 없습니다"); return; }
      await insertInbound({
        order_id: orderId,
        item_id: firstItem.id,
        inbound_round: round,
        inbound_date: inbound.date,
        qty: inbound.qty,
        memo: inbound.memo,
      });
      setShowInbound(null);
      await reload();
    } catch (e) {
      alert("입고 등록 실패: " + e.message);
    }
  };

  const handleDelete = async (orderId) => {
    if (!confirm("이 오더를 삭제하시겠습니까? 관련 입고 이력도 함께 삭제됩니다.")) return;
    await deleteOrder(orderId);
    setSelectedId(null);
    await reload();
  };

  const handleResetAll = async () => {
    if (!confirm("⚠️ 모든 생산 오더와 입고 이력을 삭제합니다. 정말 진행하시겠습니까?")) return;
    if (!confirm("정말로 전체 초기화하시겠습니까? 되돌릴 수 없습니다.")) return;
    try {
      await deleteAllOrders();
      await reload();
      alert("전체 초기화 완료");
    } catch (e) {
      alert("초기화 실패: " + e.message);
    }
  };

  return (
    <div style={S.wrap}>
      <style>{CSS}</style>

      {/* 헤더 */}
      <header style={S.header}>
        <div>
          <div style={S.brandRow}>
            <div style={S.brandTitle}>📊 생산 오더 입고 관리</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={S.ghostBtnRed} onClick={handleResetAll} title="전체 초기화">
            ⚠ 전체 초기화
          </button>
          <button style={S.secondaryBtn} onClick={() => setShowPacking(true)} disabled={orders.length === 0} title={orders.length === 0 ? "먼저 작업지시서를 업로드하세요" : ""}>
            📦 패킹리스트 업로드
          </button>
          <button style={S.primaryBtn} onClick={() => setShowUpload(true)}>
            <span style={{ fontSize: 16, marginRight: 4 }}>＋</span> 작업지시서 업로드
          </button>
        </div>
      </header>

      {/* 시즌 필터 (대시보드 전체 데이터를 해당 시즌으로 한정) */}
      <div style={S.seasonBar}>
        <label style={S.filterLabel}>시즌</label>
        <select style={S.filterSelect} value={seasonFilter} onChange={(e) => setSeasonFilter(e.target.value)}>
          <option value="all">전체 시즌</option>
          {seasonList.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {seasonFilter !== "all" && (
          <button style={S.filterClear} onClick={() => setSeasonFilter("all")}>전체 시즌 ✕</button>
        )}
      </div>

      {/* KPI 영역: 상단 2열(입고율 hero + 상태 스택바) + 하단 4열 메트릭 */}
      <section style={S.kpiTop}>
        {/* 좌: 전체 입고율 hero */}
        <div style={S.kpiHeroCard}>
          <div style={S.kpiLabel}>전체 입고율</div>
          <div style={S.kpiHeroValue}>{pct(kpi.rate)}</div>
          <div style={S.kpiHeroBar}>
            <div style={{ ...S.kpiHeroFill, width: `${Math.min(100, kpi.rate)}%` }} />
          </div>
          <div style={S.kpiHeroSub}>총 발주 {fmt(kpi.total)}장 중 누적 입고 {fmt(kpi.received)}장</div>
        </div>

        {/* 우: 오더 상태 가로 스택 바 + 범례 */}
        <div style={S.kpiStatusCard}>
          <div style={S.kpiLabel}>오더 상태</div>
          <StatusStackBar completed={kpi.completed} partial={kpi.partial} delayed={kpi.delayed} inProgress={kpi.inProgress} />
        </div>
      </section>

      <section style={S.kpiMetricGrid}>
        <KpiCard label="총 발주" value={fmt(kpi.total)} unit="장" />
        <KpiCard label="누적 입고" value={fmt(kpi.received)} unit="장" accent="#0369A1" />
        <KpiCard label="미입고 수량" value={fmt(kpi.unreceived)} unit="장" />
        <KpiCard label="평균 리드타임" value={kpi.avgLeadtime ?? "—"} unit="일" />
      </section>

      {/* 탭 */}
      <nav style={S.tabBar}>
        {[
          { k: "all", label: "전체 오더", count: scoped.length },
          { k: "in_progress", label: "진행중", count: kpi.inProgress },
          { k: "partial", label: "부분 입고", count: kpi.partial },
          { k: "completed", label: "입고 완료", count: kpi.completed },
          { k: "delayed", label: "지연", count: kpi.delayed },
          { k: "analytics", label: "📊 리드타임 분석", count: null },
        ].map(t => (
          <button key={t.k} style={{ ...S.tab, ...(tab === t.k ? S.tabActive : {}) }} onClick={() => setTab(t.k)}>
            {t.label}
            {t.count !== null && <span style={S.tabCount}>{t.count}</span>}
          </button>
        ))}
      </nav>

      {/* 메인 */}
      {loading ? (
        <div style={S.loading}>
          <div style={S.spinner} />
          <div style={{ marginTop: 16, color: "#64748B", fontSize: 13 }}>데이터 로드 중...</div>
        </div>
      ) : tab === "analytics" ? (
        <AnalyticsPanel orders={scoped} kpi={kpi} />
      ) : (
        <>
          {/* 업체 드롭다운 + 상품명 검색 */}
          <div style={S.filterBar}>
            <label style={S.filterLabel}>업체</label>
            <select style={S.filterSelect} value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)}>
              <option value="all">전체 업체</option>
              {vendorList.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            {vendorFilter !== "all" && (
              <button style={S.filterClear} onClick={() => setVendorFilter("all")}>전체 보기 ✕</button>
            )}
            <input
              style={S.searchInput}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="상품명 검색 (예: 레글런)"
            />
            {search && <button style={S.filterClear} onClick={() => setSearch("")}>✕</button>}
          </div>

          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr style={S.theadRow}>
                  <th style={S.thThumb}></th>
                  <th style={S.th}>오더 NO</th>
                  <th style={S.th}>스타일 NO</th>
                  <th style={S.th}>상품명</th>
                  <th style={S.thR}>총 수량</th>
                  <th style={S.thR}>누적 입고</th>
                  <th style={S.thR}>잔여</th>
                  <th style={S.thC}>입고율</th>
                  <th style={S.th}>입고일</th>
                  <th style={S.thR}>리드타임</th>
                  <th style={S.thC}>상태</th>
                  <th style={S.thC}>액션</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map(g => {
                  const collapsed = !!collapsedVendors[g.vendor];
                  return (
                    <Fragment key={g.vendor}>
                      <tr style={S.groupRow} onClick={() => toggleVendor(g.vendor)}>
                        <td colSpan={12} style={S.groupCell}>
                          <div style={S.groupInner}>
                            <span style={S.groupCaret}>{collapsed ? "▶" : "▼"}</span>
                            <span style={S.groupName}>{g.vendor}</span>
                            <span style={S.groupCount}>{g.list.length}건</span>
                            <span style={S.groupMeta}>
                              발주 <b>{fmt(g.total)}</b> · 입고 <b style={{ color: "#0369A1" }}>{fmt(g.received)}</b> · 입고율 <b style={{ color: g.rate >= 100 ? "#15803D" : "#0F172A" }}>{pct(g.rate)}</b>
                            </span>
                          </div>
                        </td>
                      </tr>
                      {!collapsed && g.list.map((o, idx) => {
                        const imgUrl = imageMap[stripSpaces(o.items[0]?.product_name)];
                        // 상품명 묶음 경계: 직전 행과 상품명이 다르면 얇은 구분선(그룹 첫 행 제외)
                        const curName = o.items[0]?.product_name || "—";
                        const prevName = idx > 0 ? (g.list[idx - 1].items[0]?.product_name || "—") : null;
                        const isClusterStart = idx > 0 && curName !== prevName;
                        return (
                          <tr key={o.id} style={{ ...S.tr, ...(isClusterStart ? S.clusterStart : {}), ...(selectedId === o.id ? S.trSelected : {}) }} onClick={() => setSelectedId(o.id)}>
                            <td style={S.tdThumb}><ProductThumb url={imgUrl} /></td>
                            <td style={S.tdMono}>{o.display_no}</td>
                            <td style={S.tdMono}>{o.items[0]?.style_no || "—"}</td>
                            <td style={S.tdBold}>{o.items[0]?.product_name || "—"}</td>
                            <td style={S.tdR}>{fmt(o.total_qty)}</td>
                            <td style={{ ...S.tdR, color: "#0369A1" }}>{fmt(o.received_qty)}</td>
                            <td style={{ ...S.tdR, color: o.remain_qty > 0 ? "#1F2937" : "#9CA3AF" }}>{fmt(o.remain_qty)}</td>
                            <td style={S.tdC}>
                              <div style={S.progBar}>
                                <div style={{ ...S.progFill, width: `${o.receive_rate}%`, background: o.status === "delayed" ? "#B91C1C" : o.status === "completed" ? "#15803D" : "#0369A1" }} />
                              </div>
                              <div style={S.progLabel}>{pct(o.receive_rate)}</div>
                            </td>
                            <td style={S.td}>{o.actual_final_date ?? "—"}</td>
                            <td style={S.tdR}>{o.leadtime_days != null ? `${o.leadtime_days}일` : "—"}</td>
                            <td style={S.tdC}>
                              <span style={{ ...S.badge, color: STATUS_LABEL[o.status].color, background: STATUS_LABEL[o.status].bg }}>
                                {STATUS_LABEL[o.status].ko}
                              </span>
                            </td>
                            <td style={S.tdC}>
                              <button style={S.miniBtn} onClick={(e) => { e.stopPropagation(); setShowInbound(o.id); }}>입고 등록</button>
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={12} style={S.empty}>
                    {tab === "all" && vendorFilter === "all"
                      ? "아직 등록된 오더가 없습니다. 우측 상단 '+ 작업지시서 업로드' 버튼을 눌러주세요."
                      : "조건에 맞는 오더가 없습니다"}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {selected && tab !== "analytics" && (
        <OrderDrawer
          order={selected}
          onClose={() => setSelectedId(null)}
          onAddInbound={() => setShowInbound(selected.id)}
          onDelete={() => handleDelete(selected.id)}
          onUpdate={async (patch) => { await updateOrder(selected.id, patch); await reload(); }}
          onDeleteInbound={async (id) => {
            const rounds = (selected?.inbounds || []).filter(ib => ib.id === id).map(ib => ib.inbound_round);
            await deleteInbound(id);
            await deleteInboundLinesByRounds(selected?.id, rounds); // 같은 order_id+round 의 옵션별 라인도 정리
            await reload();
          }}
          onDeleteInbounds={async (ids) => {
            const rounds = (selected?.inbounds || []).filter(ib => ids.includes(ib.id)).map(ib => ib.inbound_round);
            const n = await deleteInbounds(ids);
            await deleteInboundLinesByRounds(selected?.id, rounds); // 삭제 차수의 옵션별 라인도 함께 제거
            await reload();
            return n;
          }}
        />
      )}

      {showUpload && (
        <UploadModal
          existingOrderNos={orders.map(o => o.order_no)}
          onClose={() => setShowUpload(false)}
          onComplete={async () => { setShowUpload(false); await reload(); }}
        />
      )}

      {showInbound !== null && (
        <InboundModal
          order={enriched.find(o => o.id === showInbound)}
          onClose={() => setShowInbound(null)}
          onSubmit={(ib) => handleAddInbound(showInbound, ib)}
        />
      )}

      {showPacking && (
        <PackingListModal
          orders={enriched}
          itemsByOrder={itemsByOrder}
          inboundsByOrder={inboundsByOrder}
          onClose={() => setShowPacking(false)}
          onComplete={async () => { setShowPacking(false); await reload(); }}
        />
      )}
    </div>
  );
}

// ============================================================
// 상품 썸네일 (URL 없거나 로드 실패 시 회색 placeholder)
// ============================================================
function ProductThumb({ url }) {
  const [error, setError] = useState(false);
  // url이 바뀌면 에러 상태 초기화
  useEffect(() => { setError(false); }, [url]);
  if (!url || error) {
    return <div style={S.thumbPlaceholder}>📷</div>;
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      style={S.thumbImg}
      onError={() => setError(true)}
    />
  );
}

// ============================================================
// 오더 상태 가로 스택 바 (완료/부분/지연/진행중 비율) + 범례
// ============================================================
function StatusStackBar({ completed, partial, delayed, inProgress }) {
  const segs = [
    { key: "completed", label: "완료", count: completed, color: "#15803D" },   // success
    { key: "partial", label: "부분", count: partial, color: "#0369A1" },       // info
    { key: "delayed", label: "지연", count: delayed, color: "#B91C1C" },        // danger
    { key: "in_progress", label: "진행중", count: inProgress, color: "#94A3B8" }, // 회색
  ];
  const total = segs.reduce((s, x) => s + x.count, 0);
  return (
    <>
      <div style={S.stackBar}>
        {total === 0 ? (
          <div style={{ ...S.stackSeg, width: "100%", background: "#E2E8F0" }} />
        ) : (
          segs.filter(s => s.count > 0).map(s => (
            <div key={s.key} title={`${s.label} ${s.count}건`} style={{ ...S.stackSeg, width: `${(s.count / total) * 100}%`, background: s.color }} />
          ))
        )}
      </div>
      <div style={S.stackLegend}>
        {segs.map(s => (
          <div key={s.key} style={S.stackLegendItem}>
            <span style={{ ...S.stackDot, background: s.color }} />
            <span style={S.stackLegendLabel}>{s.label}</span>
            <span style={S.stackLegendCount}>{s.count}</span>
          </div>
        ))}
      </div>
    </>
  );
}

// ============================================================
// KPI 카드
// ============================================================
function KpiCard({ label, value, unit, accent, progress }) {
  return (
    <div style={S.kpiCard}>
      <div style={S.kpiLabel}>{label}</div>
      <div style={{ ...S.kpiValue, color: accent || "#0F172A" }}>
        {value}{unit && <span style={S.kpiUnit}>{unit}</span>}
      </div>
      {progress !== undefined && (
        <div style={S.kpiProgBar}>
          <div style={{ ...S.kpiProgFill, width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}

// ============================================================
// Drawer
// ============================================================
function OrderDrawer({ order, onClose, onAddInbound, onDelete, onUpdate, onDeleteInbound, onDeleteInbounds }) {
  const [editing, setEditing] = useState(false);
  // 입고 이력 선택 삭제 모드
  const [selectMode, setSelectMode] = useState(false);
  const [selectedInbounds, setSelectedInbounds] = useState([]); // 체크된 입고 id 배열
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [contractDate, setContractDate] = useState(order.contract_date || "");
  const [expectedDate, setExpectedDate] = useState(order.expected_final_date || "");
  const [actualDate, setActualDate] = useState(order.actual_final_date || "");
  const contractInputRef = useRef(null);
  const [contractUploading, setContractUploading] = useState(false);

  // 최종 입고일 − 계약일 (편집 중 실시간 리드타임)
  const editLeadtime = actualDate && contractDate
    ? Math.round((new Date(actualDate) - new Date(contractDate)) / 86400000)
    : null;

  // 상태별 강조색 (진행바 채움 / 입고율)
  const barColor = order.status === "delayed" ? "#B91C1C" : order.status === "completed" ? "#15803D" : "#0369A1";
  // 납기 대비 지연 일수 (납기일 또는 최종입고일 없으면 null)
  const delay = dayDiff(order.expected_final_date, order.actual_final_date);

  const saveDate = async () => {
    await onUpdate({ contract_date: contractDate || null, expected_final_date: expectedDate || null, actual_final_date: actualDate || null });
    setEditing(false);
  };

  // 입고 이력: 차수(inbound_round) 오름차순 정렬. 라벨은 남은 레코드 기준 위치로 다시 매김.
  const sortedInbounds = [...order.inbounds].sort((a, b) => a.inbound_round - b.inbound_round);
  const toggleSelectInbound = (id) =>
    setSelectedInbounds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const exitSelectMode = () => { setSelectMode(false); setSelectedInbounds([]); };
  const handleBulkDeleteInbounds = async () => {
    if (selectedInbounds.length === 0) return;
    if (!confirm(`선택한 ${selectedInbounds.length}건의 입고 이력을 삭제할까요? 누적 입고/입고율이 다시 계산됩니다.`)) return;
    setBulkDeleting(true);
    try {
      await onDeleteInbounds(selectedInbounds);
      exitSelectMode();
    } catch (e) {
      alert("삭제 실패: " + e.message);
    } finally {
      setBulkDeleting(false);
    }
  };

  const uploadContract = async (file) => {
    if (!file) return;
    setContractUploading(true);
    try {
      // 파일명: order_id_타임스탬프_원본명
      const ext = file.name.split(".").pop();
      const safeName = `${order.id}_${Date.now()}.${ext}`;
      const uploadUrl = `${SUPABASE_URL}/storage/v1/object/contracts/${safeName}`;
      const r = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "apikey": SUPABASE_KEY,
          "Content-Type": file.type || "application/octet-stream",
          "x-upsert": "true",
        },
        body: file,
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(`Storage 업로드 실패: ${t}`);
      }
      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/contracts/${safeName}`;
      await onUpdate({
        contract_file_url: publicUrl,
        contract_file_name: file.name,
        contract_uploaded_at: new Date().toISOString(),
      });
    } catch (e) {
      alert("계약서 업로드 실패: " + e.message);
    }
    setContractUploading(false);
  };

  const downloadContract = async () => {
    if (!order.contract_file_url) return;
    try {
      // Private 버킷이라 signed URL 생성
      const path = order.contract_file_url.split("/contracts/")[1];
      const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/contracts/${path}`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "apikey": SUPABASE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expiresIn: 3600 }),
      });
      if (r.ok) {
        const data = await r.json();
        const fullUrl = `${SUPABASE_URL}/storage/v1${data.signedURL || data.signedUrl}`;
        window.open(fullUrl, "_blank");
      } else {
        // signed URL 실패 시 그냥 public URL로 시도
        window.open(order.contract_file_url, "_blank");
      }
    } catch (e) {
      window.open(order.contract_file_url, "_blank");
    }
  };

  return (
    <>
      <div style={S.drawerBackdrop} onClick={onClose} />
      <aside style={S.drawer}>
        <div style={S.drawerHeader}>
          <div>
            <div style={S.drawerStyleNo}>{order.display_no || order.order_no}</div>
            <div style={S.drawerTitle}>{order.items[0]?.product_name || "—"}</div>
            <div style={S.drawerVendor}>{order.vendor_name} · {order.season || "—"}</div>
          </div>
          <button style={S.iconBtn} onClick={onClose}>✕</button>
        </div>

        <div style={S.drawerBody}>
          <div style={S.detailCard}>
            {/* 현재 상태 (hero) */}
            <div style={S.detailSection}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={S.drawerCardHead}>현재 상태</div>
                <span style={{ ...S.badge, color: STATUS_LABEL[order.status].color, background: STATUS_LABEL[order.status].bg }}>
                  {STATUS_LABEL[order.status].ko}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", marginTop: 10 }}>
                <span style={S.heroNum}>{fmt(order.received_qty)}<span style={S.heroNumUnit}> / {fmt(order.total_qty)} 장</span></span>
                <span style={{ ...S.heroRate, marginLeft: "auto", color: barColor }}>{pct(order.receive_rate)}</span>
              </div>
              <div style={{ ...S.progBar, marginTop: 10, height: 8, width: "100%" }}>
                <div style={{ ...S.progFill, width: `${order.receive_rate}%`, background: barColor }} />
              </div>
            </div>

            {/* 일정 (가로 타임라인) */}
            <div style={{ ...S.detailSection, ...S.detailDivider }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={S.drawerCardHead}>⏱ 일정</div>
                  {!editing && delay != null && (
                    delay > 0
                      ? <span style={{ ...S.delayBadge, color: "#B91C1C", background: "#FEE2E2" }}>납기 대비 {delay}일 지연</span>
                      : <span style={{ ...S.delayBadge, color: "#15803D", background: "#DCFCE7" }}>납기 준수</span>
                  )}
                  {!editing && (
                    <span style={S.leadtimeInline}>리드타임 <strong style={{ color: "#0369A1" }}>{order.leadtime_days != null ? `${order.leadtime_days}일` : "미완료"}</strong></span>
                  )}
                </div>
                {!editing && <button style={S.miniBtnGhost} onClick={() => setEditing(true)}>편집</button>}
              </div>
              {editing ? (
                <div style={{ marginTop: 10 }}>
                  <div style={{ marginBottom: 8 }}>
                    <div style={S.dimLabel}>계약일</div>
                    <input type="date" value={contractDate} onChange={e => setContractDate(e.target.value)} style={S.formInput} />
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <div style={S.dimLabel}>납기일</div>
                    <input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} style={S.formInput} />
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <div style={S.dimLabel}>최종 입고일</div>
                    <input type="date" value={actualDate} onChange={e => setActualDate(e.target.value)} style={S.formInput} />
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <div style={S.dimLabel}>리드타임 (최종 입고일 − 계약일)</div>
                    <div style={{ ...S.dimValue, fontWeight: 700, color: "#0369A1" }}>{editLeadtime != null ? `${editLeadtime}일` : "미완료"}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button style={S.primaryBtn} onClick={saveDate}>저장</button>
                    <button style={S.ghostBtn} onClick={() => setEditing(false)}>취소</button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={S.htlWrap}>
                    {[
                      { label: "계약일", date: order.contract_date },
                      { label: "납기일", date: order.expected_final_date },
                      { label: "최종 입고일", date: order.actual_final_date },
                    ].flatMap((n, i) => {
                      const node = (
                        <div key={`n${i}`} style={S.htlNode}>
                          <div style={{ ...S.htlDot, borderColor: n.date ? "#0369A1" : "#CBD5E1", background: n.date ? "#0369A1" : "white" }} />
                          <div style={S.htlLabel}>{n.label}</div>
                          <div style={S.htlDate}>{n.date ?? "—"}</div>
                        </div>
                      );
                      return i === 0
                        ? [node]
                        : [<div key={`l${i}`} style={{ ...S.htlLine, background: n.date ? "#0369A1" : "#E2E8F0" }} />, node];
                    })}
                  </div>
                </>
              )}
            </div>

            {/* 계약서 */}
            <div style={{ ...S.detailSection, ...S.detailDivider }}>
              <div style={S.drawerCardHead}>📄 계약서</div>
              {contractUploading ? (
                <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ ...S.spinner, width: 18, height: 18, borderWidth: 2, margin: 0 }} />
                  <div style={{ fontSize: 12, color: "#64748B" }}>업로드 중...</div>
                </div>
              ) : order.contract_file_url ? (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, gap: 10 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, color: "#1F2937", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{order.contract_file_name || "계약서"}</div>
                    <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>
                      업로드: {order.contract_uploaded_at ? new Date(order.contract_uploaded_at).toISOString().slice(0, 10) : "—"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button style={S.iconBtnSm} title="다운로드" onClick={downloadContract}>⬇</button>
                    <button style={S.iconBtnSm} title="교체" onClick={() => contractInputRef.current?.click()}>🔄</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, gap: 10 }}>
                  <span style={{ fontSize: 13, color: "#94A3B8" }}>계약서 미첨부</span>
                  <button style={S.miniBtn} onClick={() => contractInputRef.current?.click()}>업로드</button>
                </div>
              )}
              <input
                ref={contractInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadContract(f);
                  e.target.value = "";
                }}
              />
            </div>

            {/* 입고 이력 */}
            <div style={{ ...S.detailSection, ...S.detailDivider }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={S.drawerCardHead}>📦 입고 이력 ({order.inbounds.length}회)</div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {selectMode ? (
                    <>
                      <button
                        style={{ ...S.miniBtn, color: "#B91C1C", borderColor: "#FCA5A5", background: "white" }}
                        disabled={selectedInbounds.length === 0 || bulkDeleting}
                        onClick={handleBulkDeleteInbounds}
                      >{bulkDeleting ? "삭제 중…" : `선택 삭제 (${selectedInbounds.length})`}</button>
                      <button style={S.miniBtnGhost} disabled={bulkDeleting} onClick={exitSelectMode}>취소</button>
                    </>
                  ) : (
                    <>
                      <button style={S.miniBtn} onClick={onAddInbound}>+ 입고 등록</button>
                      {order.inbounds.length > 0 && (
                        <button
                          style={S.inboundDeleteBtn}
                          title="입고 이력 선택 삭제"
                          onClick={() => { setSelectMode(true); setSelectedInbounds([]); }}
                        >🗑</button>
                      )}
                    </>
                  )}
                </div>
              </div>
              {order.inbounds.length === 0 ? (
                <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 8 }}>아직 입고가 없습니다</div>
              ) : (
                <div style={{ marginTop: 6 }}>
                  {sortedInbounds.map((ib, idx) => (
                    <label key={ib.id} style={{ ...S.inRow, cursor: selectMode ? "pointer" : "default" }}>
                      {selectMode && (
                        <input
                          type="checkbox"
                          style={S.inCheckbox}
                          checked={selectedInbounds.includes(ib.id)}
                          onChange={() => toggleSelectInbound(ib.id)}
                        />
                      )}
                      <span style={S.inRound}>{idx + 1}차</span>
                      <span style={S.inDate}>{ib.inbound_date}</span>
                      {ib.memo && <span style={S.inMemo}>{ib.memo}</span>}
                      <span style={S.inQty}>{fmt(ib.qty)} 장</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div style={S.drawerCard}>
            <div style={S.drawerCardHead}>🎨 색상 × 사이즈 ({order.items.length}개 SKU)</div>
            <SkuMatrix items={order.items} inboundLines={order.inboundLines} />
          </div>

          <div style={{ marginTop: 16, padding: "0 4px" }}>
            <button style={{ ...S.ghostBtnRed, width: "100%" }} onClick={onDelete}>이 오더 삭제</button>
          </div>
        </div>
      </aside>
    </>
  );
}

// ============================================================
// SKU 매트릭스 (색상 행 x 사이즈 열)
// ============================================================
function SkuMatrix({ items, inboundLines = [] }) {
  // 색상과 사이즈 유니크 추출 (등장 순서 유지). 발주(order)·입고(inbound) 두 맵을 각각 집계.
  const { colors, sizes, matrix, inMatrix, colorTotals, sizeTotals, grandTotal, inColorTotals, inSizeTotals, inGrandTotal } = useMemo(() => {
    const colorSet = [];
    const sizeSet = [];
    const cellMap = {};   // 발주수량
    const inCellMap = {}; // 입고수량
    // 발주: 색상/사이즈를 정규화(한글 색상·표준 사이즈)한 키로 집계. 표시도 정규화 값 사용.
    for (const it of items) {
      const c = normalizeColorKey(it.color);
      const s = normalizeSizeKey(it.size);
      if (!colorSet.includes(c)) colorSet.push(c);
      if (!sizeSet.includes(s)) sizeSet.push(s);
      const key = `${c}||${s}`;
      cellMap[key] = (cellMap[key] || 0) + (it.order_qty || 0);
    }
    // 입고: inbound_lines 를 동일하게 정규화한 (색상,사이즈) 키로 group by 합산 → 발주 키와 정확히 매칭.
    for (const ln of inboundLines) {
      const key = `${normalizeColorKey(ln.color)}||${normalizeSizeKey(ln.size)}`;
      inCellMap[key] = (inCellMap[key] || 0) + (ln.qty || 0);
    }

    // 사이즈 순서 정렬 (S, M, L, XL, 2XL, FREE 순)
    const sizeOrder = { "S": 1, "M": 2, "L": 3, "XL": 4, "2XL": 5, "3XL": 6, "FREE": 99, "OS": 99 };
    sizeSet.sort((a, b) => (sizeOrder[a] || 50) - (sizeOrder[b] || 50));

    // 행/열 합계 계산 (발주·입고 각각)
    const cTotals = {}, sTotals = {}, inCTotals = {}, inSTotals = {};
    let gTotal = 0, inGTotal = 0;
    for (const c of colorSet) {
      cTotals[c] = 0; inCTotals[c] = 0;
      for (const s of sizeSet) {
        const v = cellMap[`${c}||${s}`] || 0;
        const iv = inCellMap[`${c}||${s}`] || 0;
        cTotals[c] += v;
        sTotals[s] = (sTotals[s] || 0) + v;
        gTotal += v;
        inCTotals[c] += iv;
        inSTotals[s] = (inSTotals[s] || 0) + iv;
        inGTotal += iv;
      }
    }

    return {
      colors: colorSet,
      sizes: sizeSet,
      matrix: cellMap,
      inMatrix: inCellMap,
      colorTotals: cTotals,
      sizeTotals: sTotals,
      grandTotal: gTotal,
      inColorTotals: inCTotals,
      inSizeTotals: inSTotals,
      inGrandTotal: inGTotal,
    };
  }, [items, inboundLines]);

  // 한 칸/합계 셀의 발주·입고 2줄 렌더 (top: 발주 회색, bottom: 입고 파랑 굵게)
  const dual = (order, inb, dark = false) => (
    <>
      <div style={dark ? S.skuCellOrderDark : S.skuCellOrder}>{order > 0 ? fmt(order) : "—"}</div>
      <div style={inb > 0 ? (dark ? S.skuCellInboundDark : S.skuCellInbound) : S.skuCellInboundZero}>{inb > 0 ? fmt(inb) : "—"}</div>
    </>
  );

  return (
    <div>
      {/* 범례: 발주(회색) / 입고(파랑) */}
      <div style={S.skuLegend}>
        <span style={S.skuLegendItem}><span style={{ ...S.skuLegendDot, background: "#94A3B8" }} />발주</span>
        <span style={S.skuLegendItem}><span style={{ ...S.skuLegendDot, background: "#0369A1" }} />입고</span>
      </div>
      <div style={S.skuMatrixWrap}>
        <table style={S.skuMatrixTable}>
          <thead>
            <tr>
              <th style={S.skuMatrixCornerCell}>색상 \ 사이즈</th>
              {sizes.map(s => (
                <th key={s} style={S.skuMatrixSizeHeader}>{s}</th>
              ))}
              <th style={S.skuMatrixTotalHeader}>합계</th>
            </tr>
          </thead>
          <tbody>
            {colors.map(c => (
              <tr key={c}>
                <td style={S.skuMatrixColorCell}>{c}</td>
                {sizes.map(s => {
                  const v = matrix[`${c}||${s}`] || 0;
                  const iv = inMatrix[`${c}||${s}`] || 0;
                  return (
                    <td key={s} style={(v > 0 || iv > 0) ? S.skuMatrixCell : S.skuMatrixEmptyCell}>
                      {(v > 0 || iv > 0) ? dual(v, iv) : "—"}
                    </td>
                  );
                })}
                <td style={S.skuMatrixRowTotal}>{dual(colorTotals[c], inColorTotals[c])}</td>
              </tr>
            ))}
            <tr style={S.skuMatrixFooterRow}>
              <td style={S.skuMatrixFooterLabel}>합계</td>
              {sizes.map(s => (
                <td key={s} style={S.skuMatrixColTotal}>{dual(sizeTotals[s] || 0, inSizeTotals[s] || 0)}</td>
              ))}
              <td style={S.skuMatrixGrandTotal}>{dual(grandTotal, inGrandTotal, true)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// 업로드 모달 (실제 파싱)
// ============================================================
function UploadModal({ existingOrderNos, onClose, onComplete }) {
  const [step, setStep] = useState("select"); // select | parsing | matching | preview | uploading
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [matchResult, setMatchResult] = useState(null);
  const [error, setError] = useState(null);

  const [season, setSeason] = useState("26SS");
  const [contractDate, setContractDate] = useState(new Date().toISOString().slice(0,10));
  const [expectedDate, setExpectedDate] = useState("");
  const [orderNoBase, setOrderNoBase] = useState("");
  const [contractFile, setContractFile] = useState(null);
  const contractInputRef = useRef(null);

  // 자동 오더번호 제안
  useEffect(() => {
    const seasonOrders = existingOrderNos.filter(n => n.includes(season));
    const nextNum = String(seasonOrders.length + 1).padStart(3, "0");
    setOrderNoBase(`PO-${season}-${nextNum}`);
  }, [season, existingOrderNos]);

  const handleFile = async (f) => {
    setFile(f);
    setStep("parsing");
    setError(null);
    try {
      const result = await parseWorkorder(f);
      if (result.sheets_processed === 0) {
        setError("처리 가능한 시트를 찾지 못했습니다. 작업지시서 양식을 확인해주세요.");
        setStep("select");
        return;
      }
      
      // inventory 자동 매칭 (2단계 fallback)
      setStep("matching");
      console.log("[매칭] 시작 - 총 아이템:", result.items.length);
      
      const allBarcodes = [];
      for (const it of result.items) {
        const candidates = buildBarcodeCandidates(it.style_no, it.color, it.size);
        for (const bc of candidates) {
          allBarcodes.push(bc);
        }
      }
      console.log("[매칭] 바코드 후보 총:", allBarcodes.length);
      
      // 1단계: 바코드 패턴으로 일괄 조회
      const uniqueBarcodes = [...new Set(allBarcodes)];
      console.log("[매칭] 고유 바코드:", uniqueBarcodes.length, "예시:", uniqueBarcodes.slice(0, 3));
      
      const invMap = {};
      const batchSize = 50;
      for (let i = 0; i < uniqueBarcodes.length; i += batchSize) {
        const batch = uniqueBarcodes.slice(i, i + batchSize);
        const batchMap = await lookupInventoryBySkus(batch);
        Object.assign(invMap, batchMap);
      }
      console.log("[매칭] 바코드 조회 결과 - 매칭된 바코드:", Object.keys(invMap).length);
      console.log("[매칭] 첫 매칭 샘플:", Object.entries(invMap).slice(0, 3));
      
      // 매칭 결과 계산 (2단계 fallback 포함)
      let matched = 0, unmatched = 0;
      let methodCount = { barcode: 0, name_option: 0, none: 0 };
      const unmatchedItems = [];

      for (const it of result.items) {
        // 1단계: 바코드 패턴 매칭
        let found = findSkuFromInventoryMap(invMap, it.style_no, it.color, it.size);
        
        // 2단계: 한글 상품명+옵션 fallback
        if (!found) {
          found = await lookupInventoryByNameAndOption(it.product_name, it.color, it.size);
          if (found) {
            console.log("[매칭] name_option 성공:", it.style_no, it.color, it.size, "→", found.sku_code);
          }
        }
        
        if (found) {
          it.sku_code = found.sku_code;
          it.matched_barcode = found.matched_barcode || found.barcode || "";
          it.match_method = found.match_method;
          methodCount[found.match_method] = (methodCount[found.match_method] || 0) + 1;
          matched++;
        } else {
          it.sku_code = null;
          methodCount.none++;
          unmatched++;
          unmatchedItems.push({ product_name: it.product_name, color: it.color, size: it.size, style_no: it.style_no, qty: it.qty });
          if (unmatched <= 5) {
            console.log("[매칭] 실패:", it.style_no, it.color, it.size, "후보:", buildBarcodeCandidates(it.style_no, it.color, it.size));
          }
        }
      }
      console.log("[매칭] 완료 - 매칭:", matched, "/ 미매칭:", unmatched, "/ 방법별:", methodCount);
      
      setMatchResult({
        matched, unmatched,
        match_rate: result.items.length ? (matched / result.items.length) * 100 : 0,
        method_count: methodCount,
        unmatched_items: unmatchedItems,
      });
      setParsed(result);
      setStep("preview");
    } catch (e) {
      console.error(e);
      setError("파싱 실패: " + e.message);
      setStep("select");
    }
  };

  const handleUpload = async () => {
    if (!orderNoBase.trim()) { alert("오더 번호를 입력하세요"); return; }
    setStep("uploading");
    try {
      // 0) 계약서 먼저 업로드 (있으면)
      let contractUrl = null, contractName = null;
      if (contractFile) {
        const ext = contractFile.name.split(".").pop();
        const safeName = `${orderNoBase}_contract_${Date.now()}.${ext}`;
        const uploadUrl = `${SUPABASE_URL}/storage/v1/object/contracts/${safeName}`;
        const r = await fetch(uploadUrl, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${SUPABASE_KEY}`,
            "apikey": SUPABASE_KEY,
            "Content-Type": contractFile.type || "application/octet-stream",
            "x-upsert": "true",
          },
          body: contractFile,
        });
        if (!r.ok) {
          const t = await r.text();
          throw new Error(`계약서 업로드 실패: ${t}`);
        }
        contractUrl = `${SUPABASE_URL}/storage/v1/object/public/contracts/${safeName}`;
        contractName = contractFile.name;
      }
      
      // 스타일별로 그룹화 -> 스타일마다 별도 오더 생성
      const byStyle = {};
      parsed.items.forEach(it => {
        const key = it.style_no + "||" + it.factory;
        if (!byStyle[key]) {
          byStyle[key] = {
            style_no: it.style_no,
            product_name: it.product_name,
            factory: it.factory,
            sheet: it.sheet,
            items: [],
          };
        }
        byStyle[key].items.push(it);
      });

      const styleList = Object.values(byStyle);

      // 오더번호 자동 부여
      const baseMatch = orderNoBase.match(/^(.*?)(\d+)$/);
      const prefix = baseMatch ? baseMatch[1] : orderNoBase + "-";
      const startNum = baseMatch ? parseInt(baseMatch[2], 10) : 1;
      const padLen = baseMatch ? baseMatch[2].length : 3;

      for (let i = 0; i < styleList.length; i++) {
        const styleGroup = styleList[i];
        const orderNo = `${prefix}${String(startNum + i).padStart(padLen, "0")}`;

        // 1) 오더 생성 (스타일별) — 계약서 정보 포함
        const orderPayload = {
          order_no: orderNo,
          vendor_name: styleGroup.factory,
          season,
          order_date: new Date().toISOString().slice(0, 10),
          contract_date: contractDate || null,
          expected_final_date: expectedDate || null,
        };
        if (contractUrl) {
          orderPayload.contract_file_url = contractUrl;
          orderPayload.contract_file_name = contractName;
          orderPayload.contract_uploaded_at = new Date().toISOString();
        }
        const createdRows = await insertOrder(orderPayload);
        const orderId = createdRows[0].id;

        // 2) 아이템 일괄 생성 (sku_code 포함)
        const itemsPayload = styleGroup.items.map(it => ({
          order_id: orderId,
          style_no: it.style_no,
          product_name: it.product_name,
          color: it.color,
          size: it.size,
          order_qty: it.qty,
          sku_code: it.sku_code || null,
        }));
        await insertItems(itemsPayload);
      }
      onComplete();
    } catch (e) {
      setError("업로드 실패: " + e.message);
      setStep("preview");
    }
  };

  return (
    <>
      <div style={S.modalBackdrop} onClick={step !== "uploading" ? onClose : undefined} />
      <div style={S.modal}>
        <div style={S.modalHeader}>
          <div>
            <div style={S.modalTitle}>📂 작업지시서 업로드</div>
            <div style={S.modalSubtitle}>엑셀 파일을 자동 파싱하여 생산 오더로 등록</div>
          </div>
          <button style={S.iconBtn} onClick={onClose} disabled={step === "uploading"}>✕</button>
        </div>

        <div style={S.modalBody}>
          {error && <div style={S.errorBox}>{error}</div>}

          {step === "select" && (
            <div style={S.dropZone}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}>
              <div style={S.dropIcon}>📊</div>
              <div style={S.dropText}>엑셀 파일을 드래그하거나</div>
              <label style={S.uploadLabel}>
                파일 선택
                <input type="file" accept=".xlsx,.xls" style={{ display: "none" }}
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
              </label>
              <div style={S.dropHint}>지원: .xlsx · 숨김 시트 자동 제외 · COLOR/SIZE 매트릭스 자동 인식</div>
            </div>
          )}

          {step === "parsing" && (
            <div style={S.parsing}>
              <div style={S.spinner} />
              <div style={S.parsingText}>엑셀 파싱 중...</div>
              <div style={S.parsingSub}>{file?.name}</div>
            </div>
          )}

          {step === "uploading" && (
            <div style={S.parsing}>
              <div style={S.spinner} />
              <div style={S.parsingText}>Supabase에 저장 중...</div>
              <div style={S.parsingSub}>오더 생성 + 라인 아이템 일괄 INSERT</div>
            </div>
          )}

          {step === "matching" && (
            <div style={S.parsing}>
              <div style={S.spinner} />
              <div style={S.parsingText}>inventory 매칭 중...</div>
              <div style={S.parsingSub}>각 SKU의 상품코드를 자동 조회합니다</div>
            </div>
          )}

          {step === "preview" && parsed && (
            <div>
              <div style={S.previewKpi}>
                <div style={S.previewKpiBox}><div style={S.previewKpiLabel}>처리된 시트</div><div style={S.previewKpiVal}>{parsed.sheets_processed}</div></div>
                <div style={S.previewKpiBox}><div style={S.previewKpiLabel}>총 수량</div><div style={S.previewKpiVal}>{fmt(parsed.total_qty)}<span style={S.previewKpiUnit}>장</span></div></div>
                <div style={S.previewKpiBox}><div style={S.previewKpiLabel}>SKU</div><div style={S.previewKpiVal}>{parsed.sku_count}</div></div>
                <div style={S.previewKpiBox}><div style={S.previewKpiLabel}>작업처</div><div style={{ ...S.previewKpiVal, fontSize: 14 }}>{parsed.factories.join(", ") || "—"}</div></div>
              </div>

              <div style={S.previewSection}>
                <div style={S.previewSectionTitle}>📝 오더 정보</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div>
                    <div style={S.dimLabel}>오더 NO 시작 번호 <span style={{ color: "#94A3B8" }}>(스타일별로 자동 증가: -001, -002, ...)</span></div>
                    <input value={orderNoBase} onChange={e => setOrderNoBase(e.target.value)} style={S.formInput} />
                  </div>
                  <div>
                    <div style={S.dimLabel}>시즌</div>
                    <input value={season} onChange={e => setSeason(e.target.value)} style={S.formInput} />
                  </div>
                  <div>
                    <div style={S.dimLabel}>계약일</div>
                    <input type="date" value={contractDate} onChange={e => setContractDate(e.target.value)} style={S.formInput} />
                  </div>
                  <div>
                    <div style={S.dimLabel}>납기일 (선택)</div>
                    <input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} style={S.formInput} />
                  </div>
                </div>
              </div>

              {/* 계약서 첨부 영역 */}
              <div style={S.previewSection}>
                <div style={S.previewSectionTitle}>📄 계약서 첨부 (선택)</div>
                <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 6, padding: 12 }}>
                  {contractFile ? (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: "#0F172A" }}>{contractFile.name}</div>
                        <div style={{ fontSize: 11, color: "#64748B", marginTop: 3 }}>{(contractFile.size / 1024).toFixed(1)} KB · 모든 스타일 오더에 동일 적용</div>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button style={S.miniBtnGhost} onClick={() => contractInputRef.current?.click()}>교체</button>
                        <button style={S.miniBtnGhost} onClick={() => setContractFile(null)}>제거</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ textAlign: "center", padding: 8 }}>
                      <button style={S.ghostBtn} onClick={() => contractInputRef.current?.click()}>
                        📎 계약서 파일 선택 (PDF/이미지/엑셀)
                      </button>
                      <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 6 }}>
                        업로드한 계약서는 모든 스타일 오더에 동일하게 적용됩니다
                      </div>
                    </div>
                  )}
                  <input
                    ref={contractInputRef}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) setContractFile(f);
                      e.target.value = "";
                    }}
                  />
                </div>
              </div>

              <div style={S.previewSection}>
                <div style={S.previewSectionTitle}>✅ 등록 예정 ({parsed.sheets_summary.length}개 스타일)</div>
                <div style={S.previewList}>
                  {parsed.sheets_summary.map((s, i) => (
                    <div key={i} style={S.previewRow}>
                      <span style={S.previewSheet}>{s.product || s.name}</span>
                      <span style={S.previewStyle}>{s.style}</span>
                      <span style={S.previewQty}>{fmt(s.qty)} 장</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* inventory 매칭 결과 (모달 맨 아래, 등록 버튼 바로 위) */}
              {matchResult && (
                <div style={{ ...S.previewSection, background: matchResult.match_rate >= 80 ? "#DCFCE7" : matchResult.match_rate >= 50 ? "#FEF3C7" : "#FEE2E2", border: "1px solid #E2E8F0", padding: 12, borderRadius: 8, marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>
                    🔗 inventory 자동 매칭: {matchResult.matched} / {parsed.sku_count} SKU ({matchResult.match_rate.toFixed(1)}%)
                  </div>
                  {matchResult.method_count && (
                    <div style={{ fontSize: 11, color: "#475569", marginTop: 6, display: "flex", gap: 12 }}>
                      {matchResult.method_count.barcode > 0 && <span>📊 바코드 매칭: {matchResult.method_count.barcode}</span>}
                      {matchResult.method_count.name_option > 0 && <span>🔤 상품명+옵션 매칭: {matchResult.method_count.name_option}</span>}
                      {matchResult.method_count.none > 0 && <span style={{ color: "#B91C1C" }}>❌ 미매칭: {matchResult.method_count.none}</span>}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>
                    {matchResult.unmatched > 0 ? `${matchResult.unmatched}개 SKU는 inventory에 없어 패킹리스트 매칭이 안 될 수 있습니다.` : "모든 SKU가 inventory와 매칭되었습니다."}
                  </div>
                  {matchResult.unmatched_items && matchResult.unmatched_items.length > 0 && (
                    <div style={{ marginTop: 8, maxHeight: 160, overflowY: "auto", background: "rgba(255,255,255,0.6)", border: "1px solid #FCA5A5", borderRadius: 6, padding: 8 }}>
                      {matchResult.unmatched_items.map((u, i) => (
                        <div key={i} style={{ fontSize: 11, color: "#7F1D1D", padding: "2px 0", borderBottom: i < matchResult.unmatched_items.length - 1 ? "1px solid #FEE2E2" : "none" }}>
                          {(u.product_name || "—")} / {(u.color || "—")} / {(u.size || "—")} ({fmt(u.qty)}장)
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {step === "preview" && (
          <div style={S.modalFooter}>
            <button style={S.ghostBtn} onClick={onClose}>취소</button>
            <button style={S.primaryBtn} onClick={handleUpload}>Supabase에 등록</button>
          </div>
        )}
      </div>
    </>
  );
}

// ============================================================
// 입고 모달
// ============================================================
function InboundModal({ order, onClose, onSubmit }) {
  const round = order.inbounds.length + 1;
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [qty, setQty] = useState("");
  const [memo, setMemo] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const n = parseInt(qty, 10);
    if (!n || n <= 0) { alert("입고 수량을 입력하세요"); return; }
    if (n > order.remain_qty) {
      if (!confirm(`잔여 수량(${fmt(order.remain_qty)})을 초과합니다. 그래도 등록할까요?`)) return;
    }
    setSubmitting(true);
    await onSubmit({ date, qty: n, memo });
    setSubmitting(false);
  };

  return (
    <>
      <div style={S.modalBackdrop} onClick={onClose} />
      <div style={{ ...S.modal, maxWidth: 460 }}>
        <div style={S.modalHeader}>
          <div>
            <div style={S.modalTitle}>📦 {round}차 입고 등록</div>
            <div style={S.modalSubtitle}>{order.items[0]?.product_name} · {order.display_no || order.order_no}</div>
          </div>
          <button style={S.iconBtn} onClick={onClose}>✕</button>
        </div>

        <div style={S.modalBody}>
          <div style={S.formField}>
            <label style={S.formLabel}>입고 차수</label>
            <div style={S.formStatic}>{round}차 입고</div>
          </div>
          <div style={S.formField}>
            <label style={S.formLabel}>입고 날짜</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={S.formInput} />
          </div>
          <div style={S.formField}>
            <label style={S.formLabel}>입고 수량 <span style={S.remainHint}>(잔여 {fmt(order.remain_qty)}장)</span></label>
            <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" style={S.formInput} autoFocus />
          </div>
          <div style={S.formField}>
            <label style={S.formLabel}>메모 (선택)</label>
            <textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} placeholder="예: WHITE 컬러 먼저 출고" style={{ ...S.formInput, fontFamily: "inherit", resize: "vertical" }} />
          </div>
        </div>

        <div style={S.modalFooter}>
          <button style={S.ghostBtn} onClick={onClose} disabled={submitting}>취소</button>
          <button style={S.primaryBtn} onClick={submit} disabled={submitting}>{submitting ? "저장 중..." : "등록"}</button>
        </div>
      </div>
    </>
  );
}

// ============================================================
// 패킹리스트 자동 입고 등록 모달
// ============================================================
function PackingListModal({ orders, itemsByOrder, inboundsByOrder, onClose, onComplete }) {
  const [step, setStep] = useState("select"); // select | parsing | preview | uploading
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState(null);
  const [inboundDate, setInboundDate] = useState(""); // 실제 완료일(입고일). 미입력 시 등록 시점에 오늘로 fallback
  const [memo, setMemo] = useState("");
  const [seasonSel, setSeasonSel] = useState("all"); // 후보 오더 시즌 한정
  const [vendorSel, setVendorSel] = useState("all");  // 후보 오더 업체 한정
  const [lineAssign, setLineAssign] = useState({});   // lineIdx → order_id ("" = 미배정)

  const baseStyle = (s) => String(s || "").replace(/\s*-\s*\d+\s*$/, "").trim();
  const seasonOf = (o) => (o.season || String(o.order_no || "").split("-")[1] || "").trim() || "미지정";
  const inScope = (ord) =>
    (seasonSel === "all" || seasonOf(ord) === seasonSel) &&
    (vendorSel === "all" || (ord.vendor_name || "미지정") === vendorSel);

  // 시즌/업체 드롭다운 옵션 (전체 오더 기준)
  const seasonOptions = useMemo(() => [...new Set(orders.map(seasonOf))].sort((a, b) => a.localeCompare(b, "ko")), [orders]);
  const vendorOptions = useMemo(() => [...new Set(orders.map(o => o.vendor_name || "미지정"))].sort((a, b) => a.localeCompare(b, "ko")), [orders]);

  // sku_code → 후보 {order, item} 전체
  const skuToCands = useMemo(() => {
    const m = {};
    for (const ord of orders) {
      for (const it of (itemsByOrder[ord.id] || [])) {
        if (!it.sku_code) continue;
        (m[it.sku_code] = m[it.sku_code] || []).push({ order: ord, item: it });
      }
    }
    return m;
  }, [orders, itemsByOrder]);

  // 라인별: 시즌·업체 스코프 내 후보 오더 + 스타일 그룹키
  const lineInfos = useMemo(() => {
    if (!parsed) return [];
    return parsed.lines.map((line, idx) => {
      const cands = (skuToCands[line.sku_code] || []).filter(c => inScope(c.order));
      const groupKey = cands.length ? (baseStyle(cands[0].item.style_no) || `__sku_${line.sku_code}`) : `__none_${idx}`;
      return { idx, line, cands, groupKey };
    });
  }, [parsed, skuToCands, seasonSel, vendorSel]);

  // 기본 배정: 같은 스타일 그룹은 사이즈를 가장 많이 커버하는 단일 오더로(쪼개짐 방지). 스코프 바뀌면 재계산.
  useEffect(() => {
    if (!parsed) return;
    const byGroup = {};
    for (const li of lineInfos) (byGroup[li.groupKey] = byGroup[li.groupKey] || []).push(li);
    const assign = {};
    for (const [gkey, infos] of Object.entries(byGroup)) {
      const pool = {};
      for (const li of infos) for (const c of li.cands) pool[c.order.id] = c.order;
      const poolArr = Object.values(pool);
      if (poolArr.length === 0) { infos.forEach(li => { assign[li.idx] = ""; }); continue; }
      const scoreOf = (ord) => {
        const items = itemsByOrder[ord.id] || [];
        const skuSet = new Set(items.map(it => it.sku_code));
        const covered = infos.filter(li => skuSet.has(li.line.sku_code)).length;
        const styleQty = items.filter(it => baseStyle(it.style_no) === gkey).reduce((s, it) => s + (it.order_qty || 0), 0);
        return { covered, styleQty };
      };
      const chosen = poolArr.sort((a, b) => {
        const sa = scoreOf(a), sb = scoreOf(b);
        if (sb.covered !== sa.covered) return sb.covered - sa.covered;
        if (sb.styleQty !== sa.styleQty) return sb.styleQty - sa.styleQty;
        return String(a.order_no || "").localeCompare(String(b.order_no || ""));
      })[0];
      infos.forEach(li => {
        const ok = li.cands.some(c => c.order.id === chosen.id);
        assign[li.idx] = ok ? chosen.id : (li.cands[0]?.order.id ?? "");
      });
    }
    setLineAssign(assign);
  }, [lineInfos]);

  const handleFile = async (f) => {
    setFile(f);
    // 파일명 앞쪽 6자리(YYMMDD)에서 입고일/실제 완료일 자동 추출 (예: 260212_… → 2026-02-12)
    const dm = String(f.name).match(/(\d{6})/);
    if (dm) {
      const yy = dm[1].slice(0, 2), mm = dm[1].slice(2, 4), dd = dm[1].slice(4, 6);
      const mi = parseInt(mm, 10), di = parseInt(dd, 10);
      if (mi >= 1 && mi <= 12 && di >= 1 && di <= 31) setInboundDate(`20${yy}-${mm}-${dd}`);
    }
    setStep("parsing");
    setError(null);
    try {
      const result = await parsePackingList(f);
      if (result.line_count === 0) {
        setError("패킹리스트 데이터를 찾을 수 없습니다. 양식을 확인해주세요.");
        setStep("select");
        return;
      }
      setParsed(result);
      setStep("preview");
    } catch (e) {
      console.error(e);
      setError("파싱 실패: " + e.message);
      setStep("select");
    }
  };

  // 라인별 배정(lineAssign)을 오더 단위로 묶음 → 등록용 구조
  const buildTargets = () => {
    const byOrder = {}; // order_id → { order, lines, qty }
    for (const li of lineInfos) {
      const oid = lineAssign[li.idx];
      if (!oid) continue;
      const ord = (li.cands.find(c => String(c.order.id) === String(oid)) || {}).order || orders.find(o => String(o.id) === String(oid));
      if (!ord) continue;
      const items = itemsByOrder[ord.id] || [];
      const item = items.find(x => x.sku_code === li.line.sku_code)
        || items.find(x => baseStyle(x.style_no) === li.groupKey && normalizeSizeKey(x.size) === normalizeSizeKey(li.line.size))
        || items[0];
      if (!byOrder[ord.id]) byOrder[ord.id] = { order: ord, lines: [], qty: 0 };
      byOrder[ord.id].lines.push({ ...li.line, item_id: item?.id, item_color: item?.color, item_size: item?.size, first_item_id: items[0]?.id });
      byOrder[ord.id].qty += li.line.qty;
    }
    return Object.values(byOrder).map(t => ({ ...t, next_round: (inboundsByOrder[t.order.id] || []).length + 1 }));
  };

  const handleConfirm = async () => {
    const targets = buildTargets();
    if (targets.length === 0) { alert("배정된 라인이 없습니다. 라인별 대상 오더를 선택하세요."); return; }
    const finalDate = inboundDate || new Date().toISOString().slice(0, 10);
    setStep("uploading");
    try {
      // 1) 패킹리스트 파일 Storage 업로드
      let packingUrl = null;
      const ext = file.name.split(".").pop();
      const safeName = `PL_${Date.now()}.${ext}`;
      const upR = await fetch(`${SUPABASE_URL}/storage/v1/object/packing-lists/${safeName}`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${SUPABASE_KEY}`, "apikey": SUPABASE_KEY, "Content-Type": file.type || "application/octet-stream", "x-upsert": "true" },
        body: file,
      });
      if (upR.ok) packingUrl = `${SUPABASE_URL}/storage/v1/object/public/packing-lists/${safeName}`;

      // 2) 오더별 차수 총량 입고(inbound_history) + 옵션별 라인(inbound_lines)
      for (const t of targets) {
        await insertInbound({
          order_id: t.order.id,
          item_id: t.lines[0]?.first_item_id ?? t.lines[0]?.item_id,
          inbound_round: t.next_round,
          inbound_date: finalDate,
          qty: t.qty,
          memo: memo || `패킹리스트 등록 - ${file.name}`,
          packing_list_url: packingUrl,
          packing_list_name: file.name,
        });
        const lineRows = t.lines.map(l => ({
          order_id: t.order.id,
          round: t.next_round,
          inbound_date: finalDate,
          color: normalizeColorKey(l.item_color ?? l.color),
          size: normalizeSizeKey(l.item_size ?? l.size),
          qty: l.qty,
        }));
        try { await insertInboundLines(lineRows); }
        catch (e) { console.error("[입고 라인 적재 실패]", e); }
        await updateOrder(t.order.id, { actual_final_date: finalDate });
      }
      onComplete();
    } catch (e) {
      setError("입고 등록 실패: " + e.message);
      setStep("preview");
    }
  };

  // 미리보기 집계
  const assignedCount = lineInfos.filter(li => lineAssign[li.idx]).length;
  const noCandCount = lineInfos.filter(li => li.cands.length === 0).length;
  const targetOrderCount = new Set(lineInfos.map(li => lineAssign[li.idx]).filter(Boolean)).size;
  const assignedQty = lineInfos.filter(li => lineAssign[li.idx]).reduce((s, li) => s + li.line.qty, 0);

  return (
    <>
      <div style={S.modalBackdrop} onClick={step !== "uploading" ? onClose : undefined} />
      <div style={S.modal}>
        <div style={S.modalHeader}>
          <div>
            <div style={S.modalTitle}>📦 패킹리스트 업로드</div>
            <div style={S.modalSubtitle}>시즌·업체로 후보를 좁히고 라인별 대상 오더를 확정해 입고 등록</div>
          </div>
          <button style={S.iconBtn} onClick={onClose} disabled={step === "uploading"}>✕</button>
        </div>

        <div style={S.modalBody}>
          {error && <div style={S.errorBox}>{error}</div>}

          {step === "select" && (
            <div style={S.dropZone}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}>
              <div style={S.dropIcon}>📦</div>
              <div style={S.dropText}>패킹리스트 엑셀을 드래그하거나</div>
              <label style={S.uploadLabel}>
                파일 선택
                <input type="file" accept=".xlsx,.xls" style={{ display: "none" }}
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
              </label>
              <div style={S.dropHint}>양식: 상품코드(S21895) / 상품명 / 옵션[색상-사이즈] / 수량</div>
            </div>
          )}

          {step === "parsing" && (
            <div style={S.parsing}>
              <div style={S.spinner} />
              <div style={S.parsingText}>패킹리스트 파싱 중...</div>
              <div style={S.parsingSub}>{file?.name}</div>
            </div>
          )}

          {step === "uploading" && (
            <div style={S.parsing}>
              <div style={S.spinner} />
              <div style={S.parsingText}>입고 등록 중...</div>
              <div style={S.parsingSub}>{targetOrderCount}개 오더에 입고 추가</div>
            </div>
          )}

          {step === "preview" && parsed && (
            <div>
              {/* 시즌 · 업체 한정 */}
              <div style={S.previewSection}>
                <div style={S.previewSectionTitle}>🎯 후보 오더 범위</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div>
                    <div style={S.dimLabel}>시즌</div>
                    <select style={S.formInput} value={seasonSel} onChange={e => setSeasonSel(e.target.value)}>
                      <option value="all">전체 시즌</option>
                      {seasonOptions.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={S.dimLabel}>업체</div>
                    <select style={S.formInput} value={vendorSel} onChange={e => setVendorSel(e.target.value)}>
                      <option value="all">전체 업체</option>
                      {vendorOptions.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div style={S.previewKpi}>
                <div style={S.previewKpiBox}>
                  <div style={S.previewKpiLabel}>패킹리스트 라인</div>
                  <div style={S.previewKpiVal}>{parsed.line_count}</div>
                </div>
                <div style={S.previewKpiBox}>
                  <div style={S.previewKpiLabel}>배정 라인</div>
                  <div style={{ ...S.previewKpiVal, color: "#15803D" }}>{assignedCount}</div>
                </div>
                <div style={S.previewKpiBox}>
                  <div style={S.previewKpiLabel}>배정 수량</div>
                  <div style={S.previewKpiVal}>{fmt(assignedQty)}<span style={S.previewKpiUnit}>장</span></div>
                </div>
                <div style={S.previewKpiBox}>
                  <div style={S.previewKpiLabel}>후보 없음</div>
                  <div style={{ ...S.previewKpiVal, color: noCandCount > 0 ? "#B91C1C" : "#94A3B8" }}>{noCandCount}</div>
                </div>
              </div>

              {/* 입고 날짜 / 메모 */}
              <div style={S.previewSection}>
                <div style={S.previewSectionTitle}>📅 입고 정보</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
                  <div>
                    <div style={S.dimLabel}>최종 입고일</div>
                    <input type="date" value={inboundDate} onChange={e => setInboundDate(e.target.value)} style={S.formInput} />
                    <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 3 }}>미입력 시 오늘 날짜로 등록됩니다</div>
                  </div>
                  <div>
                    <div style={S.dimLabel}>공통 메모 (선택)</div>
                    <input value={memo} onChange={e => setMemo(e.target.value)} placeholder="예: 인도 1차 선적분" style={S.formInput} />
                  </div>
                </div>
              </div>

              {/* 라인별 대상 오더 선택 */}
              <div style={S.previewSection}>
                <div style={S.previewSectionTitle}>🔗 라인별 대상 오더 ({assignedCount}/{lineInfos.length} 배정 · {targetOrderCount}개 오더)</div>
                <div style={{ ...S.previewList, maxHeight: 280 }}>
                  {lineInfos.map(li => {
                    const ambiguous = li.cands.length > 1;
                    const none = li.cands.length === 0;
                    const opt = (li.line.color || "") + (li.line.size ? `-${li.line.size}` : "");
                    return (
                      <div key={li.idx} style={{ ...S.plLineRow, ...(none ? S.plLineNone : ambiguous ? S.plLineAmbiguous : {}) }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "#1F2937", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{li.line.product_name || "—"}</div>
                          <div style={{ fontSize: 11, color: "#64748B" }}>{li.line.sku_code} · {opt || "—"} · {fmt(li.line.qty)}장{ambiguous ? ` · 후보 ${li.cands.length}` : ""}</div>
                        </div>
                        {none ? (
                          <span style={{ fontSize: 11, color: "#B91C1C", fontWeight: 600, whiteSpace: "nowrap" }}>후보 없음</span>
                        ) : (
                          <select style={S.plSelect} value={lineAssign[li.idx] ?? ""} onChange={e => setLineAssign(prev => ({ ...prev, [li.idx]: e.target.value }))}>
                            <option value="">미등록</option>
                            {li.cands.map(c => (
                              <option key={c.order.id} value={c.order.id}>
                                {(c.order.display_no || c.order.order_no)} · {c.order.vendor_name || "—"}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>
                {noCandCount > 0 && (
                  <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 6 }}>
                    '후보 없음' 라인은 현재 시즌·업체 범위에 매칭 오더가 없습니다. 범위를 넓히거나 작업지시서 등록을 확인하세요.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {step === "preview" && (
          <div style={S.modalFooter}>
            <button style={S.ghostBtn} onClick={onClose}>취소</button>
            <button style={S.primaryBtn} onClick={handleConfirm} disabled={assignedCount === 0}>
              {targetOrderCount}개 오더에 입고 등록
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// ============================================================
// 리드타임 분석
// ============================================================
function AnalyticsPanel({ orders, kpi }) {
  const byVendor = useMemo(() => {
    const map = {};
    orders.forEach(o => {
      const key = o.vendor_name || "미지정";
      if (!map[key]) map[key] = { total: 0, count: 0, completed: 0, delayed: 0 };
      if (o.leadtime_days != null) { map[key].total += o.leadtime_days; map[key].count += 1; }
      if (o.status === "completed") map[key].completed += 1;
      if (o.status === "delayed") map[key].delayed += 1;
    });
    return Object.entries(map).map(([name, v]) => ({
      name, avg: v.count ? Math.round(v.total / v.count) : null,
      completed: v.completed, delayed: v.delayed,
    }));
  }, [orders]);

  const maxQty = Math.max(...orders.map(o => o.total_qty), 1);

  if (orders.length === 0) {
    return <div style={S.analyticsWrap}><div style={S.empty}>분석할 데이터가 없습니다. 먼저 작업지시서를 업로드하세요.</div></div>;
  }

  return (
    <div style={S.analyticsWrap}>
      <div style={S.analGrid}>
        <div style={S.analCard}>
          <div style={S.analTitle}>업체별 납기 평가</div>
          <div style={S.analSub}>계약일 → 실제 최종 입고일 평균</div>
          <div style={{ marginTop: 16 }}>
            {byVendor.map(v => (
              <div key={v.name} style={S.vendorRow}>
                <div style={S.vendorName}>{v.name}</div>
                <div style={S.vendorMeta}>
                  <span>완료 {v.completed}</span>
                  <span>지연 <span style={{ color: v.delayed > 0 ? "#B91C1C" : "#1F2937" }}>{v.delayed}</span></span>
                  <span style={S.vendorAvg}>평균 {v.avg ?? "—"}일</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={S.analCard}>
          <div style={S.analTitle}>오더별 진행률</div>
          <div style={S.analSub}>전체 오더의 입고 진행 상황</div>
          <div style={{ marginTop: 16, maxHeight: 320, overflowY: "auto" }}>
            {orders.map(o => (
              <div key={o.id} style={S.orderProgRow}>
                <div style={S.orderProgLabel}>
                  <span style={S.orderProgName}>{o.items[0]?.product_name || o.display_no || o.order_no}</span>
                  <span style={S.orderProgQty}>{fmt(o.received_qty)} / {fmt(o.total_qty)}</span>
                </div>
                <div style={{ ...S.progBar, width: "100%" }}>
                  <div style={{ ...S.progFill, width: `${o.receive_rate}%`, background: o.status === "delayed" ? "#B91C1C" : o.status === "completed" ? "#15803D" : "#0369A1" }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={S.analCard}>
          <div style={S.analTitle}>상태 분포</div>
          <div style={S.analSub}>전체 오더 {orders.length}건</div>
          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            {[
              { k: "in_progress", count: orders.filter(o => o.status === "in_progress").length },
              { k: "partial", count: kpi.partial },
              { k: "completed", count: kpi.completed },
              { k: "delayed", count: kpi.delayed },
            ].map(s => {
              const p = (s.count / orders.length) * 100;
              const lbl = STATUS_LABEL[s.k];
              return (
                <div key={s.k} style={{ flex: p || 0.5, minWidth: 60 }}>
                  <div style={{ height: 80, background: lbl.bg, borderRadius: 6, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 8 }}>
                    <span style={{ fontSize: 22, fontWeight: 700, color: lbl.color }}>{s.count}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#64748B", textAlign: "center", marginTop: 6 }}>{lbl.ko}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={S.analCard}>
          <div style={S.analTitle}>수량 TOP</div>
          <div style={S.analSub}>발주 수량 기준 상위</div>
          <div style={{ marginTop: 16 }}>
            {[...orders].sort((a, b) => b.total_qty - a.total_qty).slice(0, 5).map((o, i) => (
              <div key={o.id} style={S.topRow}>
                <span style={S.topRank}>{i + 1}</span>
                <span style={S.topName}>{o.items[0]?.product_name || o.display_no || o.order_no}</span>
                <span style={S.topQty}>{fmt(o.total_qty)}장</span>
                <div style={{ ...S.topBar, width: `${(o.total_qty / maxQty) * 100}%` }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 스타일
// ============================================================
const S = {
  wrap: { minHeight: "100vh", background: "#F8FAFC", color: "#0F172A", fontFamily: "'Pretendard', -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', sans-serif", padding: "24px 32px 80px" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, gap: 24 },
  brandRow: { display: "flex", alignItems: "center", gap: 12 },
  brandTitle: { fontSize: 19, fontWeight: 700, color: "#0F172A", letterSpacing: -0.2 },

  primaryBtn: { background: "#0F172A", color: "white", border: "none", padding: "10px 18px", borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center" },
  secondaryBtn: { background: "#0369A1", color: "white", border: "none", padding: "10px 16px", borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center" },
  ghostBtn: { background: "white", color: "#475569", border: "1px solid #E2E8F0", padding: "10px 18px", borderRadius: 6, fontSize: 14, fontWeight: 500, cursor: "pointer" },
  ghostBtnRed: { background: "white", color: "#B91C1C", border: "1px solid #FECACA", padding: "10px 16px", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  miniBtn: { background: "#F1F5F9", color: "#0F172A", border: "1px solid #E2E8F0", padding: "6px 11px", borderRadius: 5, fontSize: 13, fontWeight: 500, cursor: "pointer" },
  miniBtnGhost: { background: "white", color: "#64748B", border: "1px solid #E2E8F0", padding: "5px 10px", borderRadius: 5, fontSize: 12, fontWeight: 500, cursor: "pointer" },
  iconBtn: { background: "transparent", border: "none", fontSize: 20, color: "#94A3B8", cursor: "pointer", padding: 4 },

  kpiGrid: { display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 12, marginBottom: 20 },

  // 상단 KPI 2열 (입고율 hero + 상태 스택바)
  kpiTop: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 },
  kpiHeroCard: { background: "white", borderRadius: 10, padding: "16px 18px", border: "1px solid #E2E8F0" },
  kpiHeroValue: { fontSize: 30, fontWeight: 800, color: "#0F172A", letterSpacing: -0.8, marginTop: 4, fontVariantNumeric: "tabular-nums" },
  kpiHeroBar: { height: 8, background: "#E2E8F0", borderRadius: 4, marginTop: 10, overflow: "hidden" },
  kpiHeroFill: { height: "100%", background: "#0369A1", borderRadius: 4, transition: "width 0.3s" },
  kpiHeroSub: { fontSize: 12, color: "#64748B", marginTop: 8 },
  kpiStatusCard: { background: "white", borderRadius: 10, padding: "16px 18px", border: "1px solid #E2E8F0", display: "flex", flexDirection: "column" },
  stackBar: { display: "flex", height: 14, borderRadius: 7, overflow: "hidden", marginTop: 12, background: "#E2E8F0" },
  stackSeg: { height: "100%", transition: "width 0.3s" },
  stackLegend: { display: "flex", flexWrap: "wrap", gap: 16, marginTop: "auto", paddingTop: 12 },
  stackLegendItem: { display: "flex", alignItems: "center", gap: 6 },
  stackDot: { width: 9, height: 9, borderRadius: 3, flexShrink: 0 },
  stackLegendLabel: { fontSize: 12, color: "#64748B" },
  stackLegendCount: { fontSize: 13, fontWeight: 700, color: "#0F172A", fontVariantNumeric: "tabular-nums" },

  // 하단 KPI 4열 메트릭
  kpiMetricGrid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 },

  kpiCard: { background: "white", borderRadius: 10, padding: "14px 16px", border: "1px solid #E2E8F0" },
  kpiLabel: { fontSize: 12, color: "#64748B", fontWeight: 500, letterSpacing: 0.2 },
  kpiValue: { fontSize: 26, fontWeight: 700, marginTop: 4, letterSpacing: -0.5 },
  kpiUnit: { fontSize: 13, fontWeight: 400, color: "#94A3B8", marginLeft: 3 },
  kpiProgBar: { height: 3, background: "#E2E8F0", borderRadius: 2, marginTop: 8, overflow: "hidden" },
  kpiProgFill: { height: "100%", background: "#0369A1", transition: "width 0.3s" },

  tabBar: { display: "flex", gap: 4, background: "white", padding: 6, borderRadius: 10, border: "1px solid #E2E8F0", marginBottom: 16, width: "fit-content" },
  tab: { background: "transparent", border: "none", padding: "9px 18px", borderRadius: 6, fontSize: 14, fontWeight: 500, color: "#64748B", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 },
  tabActive: { background: "#0F172A", color: "white" },
  tabCount: { background: "rgba(0,0,0,0.08)", padding: "1px 7px", borderRadius: 8, fontSize: 12, fontWeight: 600 },

  // 시즌 필터 바 (KPI 위, 전체 대시보드 스코프)
  seasonBar: { display: "flex", alignItems: "center", gap: 10, marginBottom: 16 },
  // 업체 드롭다운 필터 바
  filterBar: { display: "flex", alignItems: "center", gap: 10, marginBottom: 12 },
  filterLabel: { fontSize: 12, fontWeight: 600, color: "#64748B", letterSpacing: 0.2 },
  filterSelect: { padding: "8px 12px", border: "1px solid #CBD5E1", borderRadius: 6, fontSize: 14, color: "#0F172A", background: "white", fontFamily: "inherit", cursor: "pointer", minWidth: 180 },
  filterClear: { background: "white", color: "#64748B", border: "1px solid #E2E8F0", padding: "7px 12px", borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: "pointer" },
  searchInput: { marginLeft: "auto", padding: "8px 12px", border: "1px solid #CBD5E1", borderRadius: 6, fontSize: 14, color: "#0F172A", background: "white", fontFamily: "inherit", minWidth: 240 },

  // 상품 썸네일
  thThumb: { padding: "12px 12px", width: 36, textAlign: "center", verticalAlign: "middle" },
  tdThumb: { padding: "12px 12px", width: 36, textAlign: "center", verticalAlign: "middle" },
  thumbImg: { width: 36, height: 36, borderRadius: 8, objectFit: "cover", display: "inline-block", verticalAlign: "middle", background: "#F1F5F9" },
  thumbPlaceholder: { width: 36, height: 36, borderRadius: 8, background: "#F1F5F9", display: "inline-flex", verticalAlign: "middle", alignItems: "center", justifyContent: "center", fontSize: 16, color: "#CBD5E1" },

  // 업체 그룹 헤더 행
  groupRow: { background: "#F1F5F9", borderBottom: "1px solid #E2E8F0", cursor: "pointer" },
  groupCell: { padding: 0 },
  groupInner: { display: "flex", alignItems: "center", gap: 10, padding: "10px 14px" },
  groupCaret: { fontSize: 10, color: "#94A3B8", width: 12, flexShrink: 0 },
  groupName: { fontSize: 14, fontWeight: 700, color: "#0F172A" },
  groupCount: { fontSize: 12, fontWeight: 600, color: "#64748B", background: "white", border: "1px solid #E2E8F0", borderRadius: 8, padding: "1px 8px" },
  groupMeta: { marginLeft: "auto", fontSize: 13, color: "#475569", fontVariantNumeric: "tabular-nums" },

  tableWrap: { background: "white", borderRadius: 10, border: "1px solid #E2E8F0", overflow: "hidden" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  theadRow: { background: "#F8FAFC", borderBottom: "1px solid #E2E8F0" },
  th: { padding: "12px 12px", textAlign: "left", verticalAlign: "middle", fontSize: 12, fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: 0.3 },
  thR: { padding: "12px 12px", textAlign: "right", verticalAlign: "middle", fontSize: 12, fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: 0.3 },
  thC: { padding: "12px 12px", textAlign: "center", verticalAlign: "middle", fontSize: 12, fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: 0.3 },
  tr: { borderBottom: "1px solid #F1F5F9", cursor: "pointer" },
  clusterStart: { borderTop: "1px solid #E2E8F0" }, // 같은 상품명 묶음 경계 구분선
  trSelected: { background: "#EFF6FF" },
  td: { padding: "12px 12px", color: "#1F2937", verticalAlign: "middle" },
  tdR: { padding: "12px 12px", color: "#1F2937", textAlign: "right", verticalAlign: "middle", fontVariantNumeric: "tabular-nums" },
  tdC: { padding: "12px 12px", color: "#1F2937", textAlign: "center", verticalAlign: "middle" },
  tdMono: { padding: "12px 12px", color: "#475569", verticalAlign: "middle", fontFamily: "'JetBrains Mono', monospace", fontSize: 13 },
  tdBold: { padding: "12px 12px", color: "#0F172A", verticalAlign: "middle", fontWeight: 600 },
  empty: { padding: 60, textAlign: "center", color: "#94A3B8", fontSize: 14 },

  badge: { display: "inline-block", padding: "4px 11px", borderRadius: 12, fontSize: 12, fontWeight: 600 },
  badgeBig: { padding: "6px 15px", fontSize: 14 },

  progBar: { width: 80, height: 5, background: "#E2E8F0", borderRadius: 3, overflow: "hidden", display: "inline-block", verticalAlign: "middle" },
  progFill: { height: "100%", background: "#0369A1", transition: "width 0.3s" },
  progLabel: { display: "inline-block", marginLeft: 8, fontSize: 13, color: "#475569", verticalAlign: "middle", fontVariantNumeric: "tabular-nums" },

  loading: { padding: 80, textAlign: "center" },

  drawerBackdrop: { position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.3)", zIndex: 50 },
  drawer: { position: "fixed", top: 0, right: 0, bottom: 0, width: 480, background: "white", boxShadow: "-12px 0 32px rgba(15,23,42,0.12)", zIndex: 51, display: "flex", flexDirection: "column" },
  drawerHeader: { padding: "20px 24px", borderBottom: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  drawerStyleNo: { fontSize: 12, color: "#94A3B8", fontFamily: "'JetBrains Mono', monospace", letterSpacing: 0.3 },
  drawerTitle: { fontSize: 20, fontWeight: 700, color: "#0F172A", marginTop: 4 },
  drawerVendor: { fontSize: 13, color: "#64748B", marginTop: 4 },
  drawerBody: { flex: 1, overflowY: "auto", padding: 16 },
  drawerCard: { background: "#F8FAFC", borderRadius: 8, padding: 14, marginBottom: 10, border: "1px solid #E2E8F0" },
  drawerCardHead: { fontSize: 13, fontWeight: 600, color: "#475569", letterSpacing: 0.2 },
  drawerStat: { fontSize: 14, color: "#1F2937", fontVariantNumeric: "tabular-nums" },
  drawerGrid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 },
  dimLabel: { fontSize: 11, color: "#94A3B8", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4 },
  dimValue: { fontSize: 14, color: "#1F2937", fontVariantNumeric: "tabular-nums" },

  // 오더 상세 통합 카드 (외곽 1개 + border-top 구분선)
  detailCard: { background: "white", border: "1px solid #E2E8F0", borderRadius: 10, marginBottom: 10, overflow: "hidden" },
  detailSection: { padding: 14 },
  detailDivider: { borderTop: "0.5px solid #E2E8F0" },
  heroNum: { fontSize: 22, fontWeight: 700, color: "#0F172A", fontVariantNumeric: "tabular-nums" },
  heroNumUnit: { fontSize: 14, fontWeight: 500, color: "#94A3B8" },
  heroRate: { fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums" },
  // 가로 타임라인
  htlWrap: { display: "flex", alignItems: "flex-start", marginTop: 14 },
  htlNode: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: "0 0 auto", minWidth: 72 },
  htlLine: { flex: 1, height: 2, marginTop: 5, borderRadius: 1 },
  htlDot: { width: 12, height: 12, borderRadius: 6, border: "2px solid", boxSizing: "border-box" },
  htlLabel: { fontSize: 11, color: "#94A3B8" },
  htlDate: { fontSize: 12, fontWeight: 600, color: "#1F2937", fontVariantNumeric: "tabular-nums" },
  delayBadge: { display: "inline-block", fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 999 },
  leadtimeLine: { fontSize: 12, color: "#475569", marginTop: 10 },
  leadtimeInline: { fontSize: 12, color: "#475569" },
  iconBtnSm: { width: 30, height: 30, borderRadius: 6, border: "1px solid #E2E8F0", background: "white", cursor: "pointer", fontSize: 14, lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#475569" },
  // 컴팩트 입고 차수 행
  inRow: { display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: "0.5px solid #F1F5F9" },
  inCheckbox: { width: 15, height: 15, accentColor: "#0F172A", cursor: "pointer", flexShrink: 0, margin: 0 },
  inRound: { fontSize: 11, fontWeight: 700, color: "#0369A1", background: "#E0F2FE", borderRadius: 4, padding: "2px 6px", flexShrink: 0 },
  inDate: { fontSize: 12, color: "#1F2937", fontVariantNumeric: "tabular-nums", flexShrink: 0 },
  inMemo: { fontSize: 11, color: "#94A3B8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 },
  inQty: { fontSize: 12, fontWeight: 700, color: "#0369A1", marginLeft: "auto", fontVariantNumeric: "tabular-nums", flexShrink: 0 },

  fileEmpty: { fontSize: 13, color: "#94A3B8", padding: "10px 0", textAlign: "center", background: "white", borderRadius: 6, border: "1px dashed #E2E8F0" },

  timeline: { listStyle: "none", padding: 0, margin: "12px 0 0" },
  timelineItem: { display: "flex", gap: 12, padding: "10px 0", borderBottom: "1px solid #E2E8F0" },
  inboundDeleteBtn: { alignSelf: "center", flexShrink: 0, background: "white", color: "#B91C1C", border: "1px solid #FCA5A5", width: 30, height: 30, borderRadius: 6, fontSize: 14, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" },
  timelineDot: { width: 38, height: 38, borderRadius: 19, background: "#0F172A", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 },
  timelineHeader: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  timelineDate: { fontSize: 14, color: "#1F2937", fontWeight: 600 },
  timelineQty: { fontSize: 14, color: "#0369A1", fontWeight: 700, fontVariantNumeric: "tabular-nums" },
  timelineMemo: { fontSize: 13, color: "#64748B", marginTop: 3 },

  skuGrid: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10, maxHeight: 200, overflowY: "auto" },
  skuPill: { display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 11px", background: "white", border: "1px solid #E2E8F0", borderRadius: 12, fontSize: 12 },
  skuColor: { color: "#475569", fontWeight: 600 },
  skuSize: { color: "#94A3B8" },
  skuQty: { color: "#0369A1", fontWeight: 700, fontVariantNumeric: "tabular-nums" },

  // 색상 × 사이즈 매트릭스 표
  skuLegend: { display: "flex", gap: 14, marginTop: 10, marginBottom: 2 },
  skuLegendItem: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "#64748B" },
  skuLegendDot: { width: 9, height: 9, borderRadius: 3, display: "inline-block" },
  // 한 칸 안 발주/입고 2줄
  skuCellOrder: { fontSize: 13, color: "#94A3B8", fontWeight: 500, lineHeight: 1.35, fontVariantNumeric: "tabular-nums" },
  skuCellInbound: { fontSize: 13, color: "#0369A1", fontWeight: 700, lineHeight: 1.35, fontVariantNumeric: "tabular-nums" },
  skuCellInboundZero: { fontSize: 13, color: "#CBD5E1", fontWeight: 500, lineHeight: 1.35, fontVariantNumeric: "tabular-nums" },
  skuCellOrderDark: { fontSize: 13, color: "#CBD5E1", fontWeight: 500, lineHeight: 1.35, fontVariantNumeric: "tabular-nums" },
  skuCellInboundDark: { fontSize: 14, color: "#7DD3FC", fontWeight: 800, lineHeight: 1.35, fontVariantNumeric: "tabular-nums" },
  skuMatrixWrap: { marginTop: 6, overflowX: "auto", borderRadius: 8, border: "1px solid #E2E8F0", background: "white" },
  skuMatrixTable: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  skuMatrixCornerCell: { padding: "8px 10px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#94A3B8", background: "#F8FAFC", borderRight: "1px solid #E2E8F0", borderBottom: "1px solid #E2E8F0", textTransform: "uppercase", letterSpacing: 0.3 },
  skuMatrixSizeHeader: { padding: "8px 12px", textAlign: "center", fontSize: 12, fontWeight: 700, color: "#0F172A", background: "#F1F5F9", borderBottom: "1px solid #E2E8F0", minWidth: 50 },
  skuMatrixTotalHeader: { padding: "8px 12px", textAlign: "center", fontSize: 11, fontWeight: 700, color: "#0F172A", background: "#0F172A", color: "white", borderBottom: "1px solid #E2E8F0", letterSpacing: 0.3 },
  skuMatrixColorCell: { padding: "10px 12px", textAlign: "left", fontSize: 13, fontWeight: 600, color: "#1F2937", background: "#F8FAFC", borderRight: "1px solid #E2E8F0", borderBottom: "1px solid #F1F5F9" },
  skuMatrixCell: { padding: "10px 12px", textAlign: "right", fontSize: 13, color: "#0369A1", fontWeight: 600, fontVariantNumeric: "tabular-nums", borderBottom: "1px solid #F1F5F9" },
  skuMatrixEmptyCell: { padding: "10px 12px", textAlign: "center", fontSize: 13, color: "#CBD5E1", borderBottom: "1px solid #F1F5F9" },
  skuMatrixRowTotal: { padding: "10px 12px", textAlign: "right", fontSize: 13, fontWeight: 700, color: "#0F172A", background: "#F8FAFC", fontVariantNumeric: "tabular-nums", borderBottom: "1px solid #F1F5F9", borderLeft: "1px solid #E2E8F0" },
  skuMatrixFooterRow: { background: "#F1F5F9" },
  skuMatrixFooterLabel: { padding: "10px 12px", textAlign: "left", fontSize: 12, fontWeight: 700, color: "#475569", background: "#F1F5F9", borderRight: "1px solid #E2E8F0", borderTop: "1px solid #E2E8F0", textTransform: "uppercase", letterSpacing: 0.3 },
  skuMatrixColTotal: { padding: "10px 12px", textAlign: "right", fontSize: 13, fontWeight: 700, color: "#0F172A", background: "#F1F5F9", fontVariantNumeric: "tabular-nums", borderTop: "1px solid #E2E8F0" },
  skuMatrixGrandTotal: { padding: "10px 12px", textAlign: "right", fontSize: 14, fontWeight: 800, color: "white", background: "#0F172A", fontVariantNumeric: "tabular-nums", borderTop: "1px solid #E2E8F0", borderLeft: "1px solid #0F172A" },

  modalBackdrop: { position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.5)", zIndex: 100 },
  modal: { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", background: "white", borderRadius: 12, width: "90%", maxWidth: 640, maxHeight: "85vh", overflow: "hidden", display: "flex", flexDirection: "column", zIndex: 101, boxShadow: "0 25px 50px rgba(0,0,0,0.25)" },
  modalHeader: { padding: "20px 24px", borderBottom: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  modalTitle: { fontSize: 20, fontWeight: 700, color: "#0F172A" },
  modalSubtitle: { fontSize: 13, color: "#64748B", marginTop: 4 },
  modalBody: { flex: 1, overflowY: "auto", padding: 24 },
  modalFooter: { padding: "16px 24px", borderTop: "1px solid #E2E8F0", display: "flex", justifyContent: "flex-end", gap: 8 },

  errorBox: { background: "#FEE2E2", border: "1px solid #FECACA", color: "#991B1B", padding: 12, borderRadius: 6, fontSize: 14, marginBottom: 16 },

  dropZone: { border: "2px dashed #CBD5E1", borderRadius: 12, padding: "48px 24px", textAlign: "center", background: "#F8FAFC", cursor: "pointer" },
  dropIcon: { fontSize: 52, marginBottom: 12 },
  dropText: { fontSize: 15, color: "#475569", marginBottom: 16 },
  uploadLabel: { display: "inline-block", background: "#0F172A", color: "white", padding: "11px 26px", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" },
  dropHint: { fontSize: 12, color: "#94A3B8", marginTop: 16 },

  parsing: { textAlign: "center", padding: "32px 0" },
  spinner: { width: 40, height: 40, border: "3px solid #E2E8F0", borderTopColor: "#0F172A", borderRadius: "50%", margin: "0 auto", animation: "spin 0.8s linear infinite" },
  parsingText: { fontSize: 15, color: "#1F2937", fontWeight: 600, marginTop: 16 },
  parsingSub: { fontSize: 13, color: "#94A3B8", marginTop: 4 },

  previewKpi: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 20 },
  previewKpiBox: { background: "#F8FAFC", padding: 12, borderRadius: 8, border: "1px solid #E2E8F0" },
  previewKpiLabel: { fontSize: 11, color: "#64748B", letterSpacing: 0.3, textTransform: "uppercase" },
  previewKpiVal: { fontSize: 24, fontWeight: 700, color: "#0F172A", marginTop: 4, fontVariantNumeric: "tabular-nums" },
  previewKpiUnit: { fontSize: 12, fontWeight: 400, color: "#94A3B8", marginLeft: 3 },

  previewSection: { marginTop: 16 },
  previewSectionTitle: { fontSize: 13, fontWeight: 600, color: "#475569", marginBottom: 8 },
  previewList: { background: "#F8FAFC", borderRadius: 8, border: "1px solid #E2E8F0", maxHeight: 200, overflowY: "auto" },
  previewRow: { display: "grid", gridTemplateColumns: "1.5fr 1.5fr 1fr", padding: "9px 14px", fontSize: 13, borderBottom: "1px solid #E2E8F0", alignItems: "center" },
  // 라인별 대상 오더 선택 행
  plLineRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "9px 14px", borderBottom: "1px solid #E2E8F0" },
  plLineAmbiguous: { background: "#FEF9C3" }, // 후보 여러 개(모호) 강조
  plLineNone: { background: "#FEE2E2" },      // 후보 없음
  plSelect: { padding: "6px 8px", border: "1px solid #CBD5E1", borderRadius: 6, fontSize: 12, color: "#0F172A", background: "white", fontFamily: "inherit", cursor: "pointer", maxWidth: 220, flexShrink: 0 },
  previewSheet: { color: "#1F2937", fontWeight: 500 },
  previewStyle: { color: "#64748B", fontFamily: "'JetBrains Mono', monospace", fontSize: 12 },
  previewQty: { textAlign: "right", color: "#0369A1", fontWeight: 600, fontVariantNumeric: "tabular-nums" },
  previewSkipped: { background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 6, padding: 10, fontSize: 12, color: "#9A3412", lineHeight: 1.6 },

  formField: { marginBottom: 16 },
  formLabel: { display: "block", fontSize: 13, color: "#475569", fontWeight: 600, marginBottom: 6 },
  formInput: { width: "100%", padding: "9px 11px", border: "1px solid #CBD5E1", borderRadius: 6, fontSize: 14, color: "#0F172A", boxSizing: "border-box", fontFamily: "inherit" },
  formStatic: { padding: "10px 12px", background: "#F1F5F9", borderRadius: 6, fontSize: 15, color: "#0F172A", fontWeight: 600 },
  remainHint: { color: "#94A3B8", fontWeight: 400, fontSize: 12 },

  analyticsWrap: { background: "white", borderRadius: 10, padding: 24, border: "1px solid #E2E8F0" },
  analGrid: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 },
  analCard: { background: "#F8FAFC", borderRadius: 10, padding: 20, border: "1px solid #E2E8F0" },
  analTitle: { fontSize: 15, fontWeight: 700, color: "#0F172A" },
  analSub: { fontSize: 12, color: "#94A3B8", marginTop: 3 },

  vendorRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #E2E8F0" },
  vendorName: { fontSize: 14, fontWeight: 600, color: "#1F2937" },
  vendorMeta: { display: "flex", gap: 16, fontSize: 12, color: "#64748B", alignItems: "center" },
  vendorAvg: { background: "#0F172A", color: "white", padding: "4px 11px", borderRadius: 4, fontSize: 13, fontWeight: 600 },

  orderProgRow: { marginBottom: 12 },
  orderProgLabel: { display: "flex", justifyContent: "space-between", marginBottom: 4 },
  orderProgName: { fontSize: 13, color: "#1F2937", fontWeight: 500 },
  orderProgQty: { fontSize: 12, color: "#64748B", fontVariantNumeric: "tabular-nums" },

  topRow: { display: "flex", alignItems: "center", gap: 10, padding: "8px 0", position: "relative" },
  topRank: { width: 24, height: 24, borderRadius: 12, background: "#0F172A", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 },
  topName: { fontSize: 14, color: "#1F2937", flex: 1, fontWeight: 500 },
  topQty: { fontSize: 13, color: "#0369A1", fontWeight: 700, fontVariantNumeric: "tabular-nums" },
  topBar: { position: "absolute", left: 32, bottom: 0, height: 3, background: "#0369A1", borderRadius: 2, opacity: 0.3 },
};

const CSS = `
@keyframes spin { to { transform: rotate(360deg); } }
button:hover { opacity: 0.92; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
input:focus, textarea:focus { outline: none; border-color: #0F172A; box-shadow: 0 0 0 3px rgba(15, 23, 42, 0.08); }
`;
