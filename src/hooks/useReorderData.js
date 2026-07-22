import { useState, useEffect, useCallback } from "react";
import { SUPABASE_URL, sbHeaders } from "../lib/supabaseClient";

// 기존 supabaseClient 의 sb.get 은 select=*&order=created_at.desc 로 고정되어 있어
// 필터/페이지네이션/컬럼선택이 불가합니다. 같은 모듈의 SUPABASE_URL, sbHeaders 만
// 가져와 PostgREST REST 호출을 직접 구성합니다.

const INVENTORY_TABLE = "inventory";
const ORDER_TABLE     = "MUSINSA Detailed Order";
const PAGE_SIZE       = 1000;
const MAX_ORDERS      = 50000;
const WINDOW_DAYS     = 30;

const INVENTORY_COLS = [
  "바코드","상품명","옵션","가용재고","입고대기",
  "카테고리","대표상품코드","상품코드","판매가","원가","이미지URL"
];
const ORDER_COLS = ["바코드","상품수량","주문번호","상태"];

function buildUrl(table, params){
  return `${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}?${params.toString()}`;
}

async function fetchJSON(url){
  const r = await fetch(url, { headers: sbHeaders });
  if(!r.ok){
    const body = await r.text().catch(()=> "");
    console.error("[inv에러본문]", r.status, r.statusText, "::", body, "::", url); // DEBUG(임시)
    throw new Error(`${r.status} ${r.statusText} :: ${body.slice(0,300)} :: ${url}`);
  }
  return r.json();
}

async function fetchLatestCollectionDate(){
  // 1차: 정렬 조회(수집일자.desc, 1건). 500/timeout이면 2차로 정렬 없이 받아 클라이언트에서 max 계산.
  try{
    const params = new URLSearchParams();
    params.set("select", "수집일자");
    params.set("order",  "수집일자.desc");
    params.set("limit",  "1");
    const url = buildUrl(INVENTORY_TABLE, params);
    console.log("[useReorderData] fetchLatestCollectionDate URL:", url); // DEBUG(임시)
    const rows = await fetchJSON(url);
    return rows[0]?.수집일자 ?? null;
  }catch(e){
    console.warn("[useReorderData] 정렬 조회 실패 → 우회(클라이언트 max 계산)", e);
    const params = new URLSearchParams();
    params.set("select", "수집일자");         // 정렬 제거
    params.set("limit",  String(PAGE_SIZE*10)); // 최대 1만행에서 max 계산
    const url = buildUrl(INVENTORY_TABLE, params);
    console.log("[useReorderData] fetchLatestCollectionDate(우회) URL:", url); // DEBUG(임시)
    const rows = await fetchJSON(url);
    let max = null;
    for(const r of rows){ const v = r.수집일자; if(v && (max===null || String(v) > String(max))) max = v; }
    return max;
  }
}

async function fetchInventoryByDate(date){
  const out = [];
  let offset = 0;
  // eslint-disable-next-line no-constant-condition
  while(true){
    const params = new URLSearchParams();
    params.set("select", INVENTORY_COLS.join(","));
    params.set("수집일자", `eq.${date}`);
    params.set("limit",  String(PAGE_SIZE));
    params.set("offset", String(offset));
    const url = buildUrl(INVENTORY_TABLE, params);
    console.log("[useReorderData] fetchInventoryByDate URL:", url); // DEBUG(임시)
    const rows = await fetchJSON(url);
    out.push(...rows);
    if(rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return out;
}

async function fetchRecentDeliveredOrders(){
  const out = [];
  let offset = 0;
  while(offset < MAX_ORDERS){
    const params = new URLSearchParams();
    params.set("select", ORDER_COLS.join(","));
    params.set("상태",   "eq.배송");
    params.set("order",  "id.desc");
    params.set("limit",  String(PAGE_SIZE));
    params.set("offset", String(offset));
    const rows = await fetchJSON(buildUrl(ORDER_TABLE, params));
    out.push(...rows);
    if(rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return out;
}

function parseOrderDate(orderNo){
  if(!orderNo) return null;
  const m = String(orderNo).match(/(\d{8})/);
  if(!m) return null;
  const s = m[1];
  return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
}

function aggregateSales(orders){
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - WINDOW_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0,10);
  const map = new Map();
  for(const o of orders){
    const date = parseOrderDate(o.주문번호);
    if(!date || date < cutoffStr) continue;
    const bc = o.바코드;
    if(!bc) continue;
    const qty = Number(o.상품수량) || 0;
    map.set(bc, (map.get(bc) || 0) + qty);
  }
  return map;
}

function merge(inventory, salesMap){
  return inventory.map(inv => {
    const sold30   = salesMap.get(inv.바코드) || 0;
    const dailyAvg = sold30 / WINDOW_DAYS;
    const avail    = Number(inv.가용재고) || 0;
    const pending  = Number(inv.입고대기) || 0;
    const daysLeft = dailyAvg === 0 ? null : avail / dailyAvg;
    const need = (days) => Math.max(0, Math.ceil(dailyAvg * days - avail - pending));
    return {
      ...inv,
      sold30,
      dailyAvg,
      daysLeft,
      need30: need(30),
      need60: need(60),
      need90: need(90),
    };
  });
}

export function useReorderData(){
  const [data, setData]               = useState([]);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try{
      const latestDate = await fetchLatestCollectionDate();
      if(!latestDate){
        setData([]);
        setLastUpdated(null);
        return;
      }
      const [inventory, orders] = await Promise.all([
        fetchInventoryByDate(latestDate),
        fetchRecentDeliveredOrders(),
      ]);
      const salesMap = aggregateSales(orders);
      setData(merge(inventory, salesMap));
      setLastUpdated(latestDate);
    }catch(e){
      console.error("[useReorderData]", e);
      setError(e);
    }finally{
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, lastUpdated, refetch: load };
}

// musinsa Supabase row → 기존 리오더 UI의 "기본상품_발주" 스키마로 변환.
// 결정사항:
//   1) code = 상품코드 (옵션 단위)
//   2) basic 탭에만 매핑, artwork 탭은 빈 상태
//   3) requiredQty = need30
//   4) shortage30/60/90 = -need30/60/90 (음수 = 부족)
//   5) daysLeft === null(판매 0건) → exhaustDays = 9999 → "재고충분" 분류
export function adaptToBasic(rows){
  if(!Array.isArray(rows)) return [];
  return rows.map(row => {
    const dailyAvg = Number(row.dailyAvg) || 0;
    const stock    = Number(row.가용재고)  || 0;
    const pending  = Number(row.입고대기)  || 0;
    const daysLeft = row.daysLeft;
    const exhaust   = daysLeft == null ? 9999 : Math.max(0, daysLeft);
    const exhaustWP = dailyAvg === 0 ? 9999 : (stock + pending) / dailyAvg;
    const need30 = Number(row.need30) || 0;
    const need60 = Number(row.need60) || 0;
    const need90 = Number(row.need90) || 0;
    return {
      code: row.상품코드 || row.바코드 || "",
      name: row.상품명 || "",
      option: row.옵션 || "",
      season: "",
      classification: row.카테고리 || "",
      avgDailySales: dailyAvg,
      exhaustDays: exhaust,
      exhaustDaysWithPending: exhaustWP,
      stock,
      processing: 0,
      requiredQty: need30,
      pendingTotal: pending,
      pending1: 0,
      pending2: 0,
      est30Sales: dailyAvg * 30,
      shortage30: -need30,
      est60Sales: dailyAvg * 60,
      shortage60: -need60,
      rec90: 0,
      shortage90: -need90,
      avg30: dailyAvg,
      sales30: Number(row.sold30) || 0,
      avg7: 0,
    };
  });
}
