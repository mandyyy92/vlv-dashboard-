import { useState, useMemo, useRef, useEffect } from "react";
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
function calcOrderTotals(order, items, inbounds) {
  const total_qty = items.reduce((s, it) => s + (it.order_qty || 0), 0);
  const received_qty = inbounds.reduce((s, ib) => s + (ib.qty || 0), 0);
  const remain_qty = total_qty - received_qty;
  const today = new Date();
  const expDate = order.expected_final_date ? new Date(order.expected_final_date) : null;

  let status;
  if (total_qty === 0) status = "in_progress";
  else if (received_qty >= total_qty) status = "completed";
  else if (received_qty === 0) {
    status = expDate && expDate < today ? "delayed" : "in_progress";
  } else {
    status = expDate && expDate < today ? "delayed" : "partial";
  }

  let actual_final_date = order.actual_final_date;
  if (received_qty >= total_qty && total_qty > 0 && inbounds.length > 0) {
    const sortedDates = inbounds.map(ib => ib.inbound_date).filter(Boolean).sort();
    actual_final_date = sortedDates[sortedDates.length - 1];
  } else {
    actual_final_date = null;
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

    const styleNo = cell(5, 2);
    const productName = cell(5, 3);
    const factory = cell(5, 4);
    if (!styleNo || !String(styleNo).trim()) continue;

    // COLOR 헤더 위치 탐색
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1:Z40");
    let colorRow = 0, colorCol = 0;
    outer: for (let r = 1; r <= range.e.r + 1; r++) {
      for (let c = 1; c <= range.e.c + 1; c++) {
        const v = cell(r, c);
        if (v && String(v).trim() === "COLOR") {
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
      for (const sz of sizes) {
        const qty = cell(dr, sz.col);
        if (typeof qty === "number" && qty > 0) {
          allItems.push({
            sheet: sheetName,
            style_no: String(styleNo).trim(),
            product_name: String(productName || "").trim(),
            factory: String(factory || "").trim(),
            color: String(color).trim(),
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
// 메인 컴포넌트
// ============================================================
export default function ProductionDashboard() {
  const [orders, setOrders] = useState([]);
  const [itemsByOrder, setItemsByOrder] = useState({});
  const [inboundsByOrder, setInboundsByOrder] = useState({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const [showInbound, setShowInbound] = useState(null);

  // 데이터 로드
  const reload = async () => {
    setLoading(true);
    try {
      const ordersData = await fetchOrders();
      const itemsData = await fetchAllItems();
      const inboundsData = await fetchAllInbounds();
      const im = {}, ibm = {};
      itemsData.forEach(it => { (im[it.order_id] = im[it.order_id] || []).push(it); });
      inboundsData.forEach(ib => { (ibm[ib.order_id] = ibm[ib.order_id] || []).push(ib); });
      setOrders(ordersData || []);
      setItemsByOrder(im);
      setInboundsByOrder(ibm);
    } catch (e) {
      console.error(e);
      alert("데이터 로드 실패: " + e.message);
    }
    setLoading(false);
  };

  useEffect(() => { reload(); }, []);

  // 집계
  const enriched = useMemo(() => {
    return orders.map(o => {
      const items = itemsByOrder[o.id] || [];
      const inbounds = inboundsByOrder[o.id] || [];
      const calc = calcOrderTotals(o, items, inbounds);
      return { ...o, ...calc, items, inbounds };
    });
  }, [orders, itemsByOrder, inboundsByOrder]);

  const filtered = useMemo(() => {
    if (tab === "all" || tab === "analytics") return enriched;
    return enriched.filter(o => o.status === tab);
  }, [enriched, tab]);

  const kpi = useMemo(() => {
    const total = enriched.reduce((s, o) => s + o.total_qty, 0);
    const received = enriched.reduce((s, o) => s + o.received_qty, 0);
    const remain = total - received;
    const delayed = enriched.filter(o => o.status === "delayed").length;
    const partial = enriched.filter(o => o.status === "partial").length;
    const completed = enriched.filter(o => o.status === "completed").length;
    const leadtimes = enriched.filter(o => o.leadtime_days != null).map(o => o.leadtime_days);
    const avgLeadtime = leadtimes.length ? Math.round(leadtimes.reduce((a, b) => a + b, 0) / leadtimes.length) : null;
    return { total, received, remain, delayed, partial, completed, avgLeadtime, rate: total ? (received / total) * 100 : 0 };
  }, [enriched]);

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
            <div style={S.brandTitle}>생산 오더 입고 관리 시스템</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={S.ghostBtnRed} onClick={handleResetAll} title="전체 초기화">
            ⚠ 전체 초기화
          </button>
          <button style={S.primaryBtn} onClick={() => setShowUpload(true)}>
            <span style={{ fontSize: 16, marginRight: 4 }}>＋</span> 작업지시서 업로드
          </button>
        </div>
      </header>

      {/* KPI 카드 */}
      <section style={S.kpiGrid}>
        <KpiCard label="총 오더 수량" value={fmt(kpi.total)} unit="장" />
        <KpiCard label="누적 입고" value={fmt(kpi.received)} unit="장" accent="#0369A1" />
        <KpiCard label="잔여 수량" value={fmt(kpi.remain)} unit="장" />
        <KpiCard label="전체 입고율" value={pct(kpi.rate)} progress={kpi.rate} />
        <KpiCard label="평균 리드타임" value={kpi.avgLeadtime ?? "—"} unit="일" />
        <KpiCard label="지연 오더" value={kpi.delayed} unit="건" accent="#B91C1C" />
        <KpiCard label="부분 입고" value={kpi.partial} unit="건" accent="#0369A1" />
        <KpiCard label="입고 완료" value={kpi.completed} unit="건" accent="#15803D" />
      </section>

      {/* 탭 */}
      <nav style={S.tabBar}>
        {[
          { k: "all", label: "전체 오더", count: enriched.length },
          { k: "in_progress", label: "진행중", count: enriched.filter(o => o.status === "in_progress").length },
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
        <AnalyticsPanel orders={enriched} kpi={kpi} />
      ) : (
        <div style={S.tableWrap}>
          <table style={S.table}>
            <thead>
              <tr style={S.theadRow}>
                <th style={S.th}>오더 NO</th>
                <th style={S.th}>스타일 NO</th>
                <th style={S.th}>상품명</th>
                <th style={S.th}>업체</th>
                <th style={S.thR}>총 수량</th>
                <th style={S.thR}>누적 입고</th>
                <th style={S.thR}>잔여</th>
                <th style={S.th}>입고율</th>
                <th style={S.th}>계약일</th>
                <th style={S.th}>예상 완료</th>
                <th style={S.th}>실제 완료</th>
                <th style={S.thR}>리드타임</th>
                <th style={S.th}>상태</th>
                <th style={S.thR}>액션</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(o => (
                <tr key={o.id} style={{ ...S.tr, ...(selectedId === o.id ? S.trSelected : {}) }} onClick={() => setSelectedId(o.id)}>
                  <td style={S.tdMono}>{o.order_no}</td>
                  <td style={S.tdMono}>{o.items[0]?.style_no || "—"}</td>
                  <td style={S.tdBold}>{o.items[0]?.product_name || "—"}</td>
                  <td style={S.td}>{o.vendor_name || "—"}</td>
                  <td style={S.tdR}>{fmt(o.total_qty)}</td>
                  <td style={{ ...S.tdR, color: "#0369A1" }}>{fmt(o.received_qty)}</td>
                  <td style={{ ...S.tdR, color: o.remain_qty > 0 ? "#1F2937" : "#9CA3AF" }}>{fmt(o.remain_qty)}</td>
                  <td style={S.td}>
                    <div style={S.progBar}>
                      <div style={{ ...S.progFill, width: `${o.receive_rate}%`, background: o.status === "delayed" ? "#B91C1C" : o.status === "completed" ? "#15803D" : "#0369A1" }} />
                    </div>
                    <div style={S.progLabel}>{pct(o.receive_rate)}</div>
                  </td>
                  <td style={S.td}>{o.contract_date ?? "—"}</td>
                  <td style={S.td}>{o.expected_final_date ?? "—"}</td>
                  <td style={S.td}>{o.actual_final_date ?? "—"}</td>
                  <td style={S.tdR}>{o.leadtime_days != null ? `${o.leadtime_days}일` : "—"}</td>
                  <td style={S.td}>
                    <span style={{ ...S.badge, color: STATUS_LABEL[o.status].color, background: STATUS_LABEL[o.status].bg }}>
                      {STATUS_LABEL[o.status].ko}
                    </span>
                  </td>
                  <td style={S.tdR}>
                    <button style={S.miniBtn} onClick={(e) => { e.stopPropagation(); setShowInbound(o.id); }}>입고 등록</button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={14} style={S.empty}>
                  {tab === "all" ? "아직 등록된 오더가 없습니다. 우측 상단 '+ 작업지시서 업로드' 버튼을 눌러주세요." : "해당 상태의 오더가 없습니다"}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {selected && tab !== "analytics" && (
        <OrderDrawer
          order={selected}
          onClose={() => setSelectedId(null)}
          onAddInbound={() => setShowInbound(selected.id)}
          onDelete={() => handleDelete(selected.id)}
          onUpdate={async (patch) => { await updateOrder(selected.id, patch); await reload(); }}
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
    </div>
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
function OrderDrawer({ order, onClose, onAddInbound, onDelete, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [contractDate, setContractDate] = useState(order.contract_date || "");
  const [expectedDate, setExpectedDate] = useState(order.expected_final_date || "");

  const saveDate = async () => {
    await onUpdate({ contract_date: contractDate || null, expected_final_date: expectedDate || null });
    setEditing(false);
  };

  return (
    <>
      <div style={S.drawerBackdrop} onClick={onClose} />
      <aside style={S.drawer}>
        <div style={S.drawerHeader}>
          <div>
            <div style={S.drawerStyleNo}>{order.order_no}</div>
            <div style={S.drawerTitle}>{order.items[0]?.product_name || "—"}</div>
            <div style={S.drawerVendor}>{order.vendor_name} · {order.season || "—"}</div>
          </div>
          <button style={S.iconBtn} onClick={onClose}>✕</button>
        </div>

        <div style={S.drawerBody}>
          <div style={S.drawerCard}>
            <div style={S.drawerCardHead}>현재 상태</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 8 }}>
              <span style={{ ...S.badge, ...S.badgeBig, color: STATUS_LABEL[order.status].color, background: STATUS_LABEL[order.status].bg }}>
                {STATUS_LABEL[order.status].ko}
              </span>
              <div style={S.drawerStat}>{fmt(order.received_qty)} / {fmt(order.total_qty)} 장 ({pct(order.receive_rate)})</div>
            </div>
            <div style={{ ...S.progBar, marginTop: 12, height: 8, width: "100%" }}>
              <div style={{ ...S.progFill, width: `${order.receive_rate}%`, background: order.status === "delayed" ? "#B91C1C" : order.status === "completed" ? "#15803D" : "#0369A1" }} />
            </div>
          </div>

          <div style={S.drawerCard}>
            <div style={{ ...S.drawerCardHead, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>⏱ 리드타임 / 날짜</span>
              {!editing && <button style={S.miniBtnGhost} onClick={() => setEditing(true)}>편집</button>}
            </div>
            {editing ? (
              <div style={{ marginTop: 10 }}>
                <div style={{ marginBottom: 8 }}>
                  <div style={S.dimLabel}>계약일</div>
                  <input type="date" value={contractDate} onChange={e => setContractDate(e.target.value)} style={S.formInput} />
                </div>
                <div style={{ marginBottom: 8 }}>
                  <div style={S.dimLabel}>예상 완료일</div>
                  <input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} style={S.formInput} />
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button style={S.primaryBtn} onClick={saveDate}>저장</button>
                  <button style={S.ghostBtn} onClick={() => setEditing(false)}>취소</button>
                </div>
              </div>
            ) : (
              <div style={S.drawerGrid2}>
                <div><div style={S.dimLabel}>계약일</div><div style={S.dimValue}>{order.contract_date ?? "—"}</div></div>
                <div><div style={S.dimLabel}>예상 완료일</div><div style={S.dimValue}>{order.expected_final_date ?? "—"}</div></div>
                <div><div style={S.dimLabel}>실제 완료일</div><div style={S.dimValue}>{order.actual_final_date ?? "—"}</div></div>
                <div><div style={S.dimLabel}>리드타임</div><div style={{ ...S.dimValue, fontWeight: 700, color: "#0369A1" }}>{order.leadtime_days != null ? `${order.leadtime_days}일` : "미완료"}</div></div>
              </div>
            )}
          </div>

          <div style={S.drawerCard}>
            <div style={{ ...S.drawerCardHead, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>📦 입고 이력 ({order.inbounds.length}회)</span>
              <button style={S.miniBtn} onClick={onAddInbound}>+ 입고 등록</button>
            </div>
            {order.inbounds.length === 0 ? (
              <div style={{ ...S.fileEmpty, marginTop: 10 }}>아직 입고가 없습니다</div>
            ) : (
              <ol style={S.timeline}>
                {[...order.inbounds].sort((a,b)=>a.inbound_round-b.inbound_round).map((ib) => (
                  <li key={ib.id} style={S.timelineItem}>
                    <div style={S.timelineDot}>{ib.inbound_round}차</div>
                    <div style={{ flex: 1 }}>
                      <div style={S.timelineHeader}>
                        <span style={S.timelineDate}>{ib.inbound_date}</span>
                        <span style={S.timelineQty}>{fmt(ib.qty)} 장</span>
                      </div>
                      <div style={S.timelineMemo}>{ib.memo || "—"}</div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div style={S.drawerCard}>
            <div style={S.drawerCardHead}>🎨 색상 × 사이즈 ({order.items.length}개 SKU)</div>
            <div style={S.skuGrid}>
              {order.items.map((it) => (
                <div key={it.id} style={S.skuPill}>
                  <span style={S.skuColor}>{it.color}</span>
                  <span style={S.skuSize}>{it.size}</span>
                  <span style={S.skuQty}>{fmt(it.order_qty)}</span>
                </div>
              ))}
            </div>
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
// 업로드 모달 (실제 파싱)
// ============================================================
function UploadModal({ existingOrderNos, onClose, onComplete }) {
  const [step, setStep] = useState("select"); // select | parsing | preview | uploading
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState(null);

  const [season, setSeason] = useState("26SS");
  const [contractDate, setContractDate] = useState(new Date().toISOString().slice(0,10));
  const [expectedDate, setExpectedDate] = useState("");
  const [orderNoBase, setOrderNoBase] = useState("");

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
      // 작업처별로 그룹화 -> 작업처마다 별도 오더 생성
      const byFactory = {};
      parsed.items.forEach(it => {
        if (!byFactory[it.factory]) byFactory[it.factory] = [];
        byFactory[it.factory].push(it);
      });
      const factoryList = Object.keys(byFactory);

      for (let i = 0; i < factoryList.length; i++) {
        const factory = factoryList[i];
        const items = byFactory[factory];
        const subOrderNo = factoryList.length > 1 
          ? `${orderNoBase}-${String.fromCharCode(65+i)}` 
          : orderNoBase;
        
        // 1) 오더 생성
        const orderPayload = {
          order_no: subOrderNo,
          vendor_name: factory,
          season,
          order_date: new Date().toISOString().slice(0,10),
          contract_date: contractDate || null,
          expected_final_date: expectedDate || null,
        };
        const createdRows = await insertOrder(orderPayload);
        const orderId = createdRows[0].id;

        // 2) 아이템 일괄 생성
        const itemsPayload = items.map(it => ({
          order_id: orderId,
          style_no: it.style_no,
          product_name: it.product_name,
          color: it.color,
          size: it.size,
          order_qty: it.qty,
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
                    <div style={S.dimLabel}>오더 NO {parsed.factories.length > 1 && <span style={{ color: "#94A3B8" }}>(작업처별 -A, -B 자동 부여)</span>}</div>
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
                    <div style={S.dimLabel}>예상 완료일 (선택)</div>
                    <input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} style={S.formInput} />
                  </div>
                </div>
              </div>

              <div style={S.previewSection}>
                <div style={S.previewSectionTitle}>✅ 등록 예정 ({parsed.sheets_summary.length}개 스타일)</div>
                <div style={S.previewList}>
                  {parsed.sheets_summary.map((s, i) => (
                    <div key={i} style={S.previewRow}>
                      <span style={S.previewSheet}>{s.name}</span>
                      <span style={S.previewStyle}>{s.style}</span>
                      <span style={S.previewQty}>{fmt(s.qty)} 장</span>
                    </div>
                  ))}
                </div>
              </div>

              {parsed.skipped_sheets.length > 0 && (
                <div style={S.previewSection}>
                  <div style={S.previewSectionTitle}>⊘ 자동 제외 (숨김 시트 {parsed.skipped_sheets.length}개)</div>
                  <div style={S.previewSkipped}>{parsed.skipped_sheets.join(" · ")}</div>
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
            <div style={S.modalSubtitle}>{order.items[0]?.product_name} · {order.order_no}</div>
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
                  <span style={S.orderProgName}>{o.items[0]?.product_name || o.order_no}</span>
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
                <span style={S.topName}>{o.items[0]?.product_name || o.order_no}</span>
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
  brandTitle: { fontSize: 16, fontWeight: 600, color: "#0F172A", letterSpacing: -0.2 },

  primaryBtn: { background: "#0F172A", color: "white", border: "none", padding: "9px 16px", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center" },
  ghostBtn: { background: "white", color: "#475569", border: "1px solid #E2E8F0", padding: "9px 16px", borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: "pointer" },
  ghostBtnRed: { background: "white", color: "#B91C1C", border: "1px solid #FECACA", padding: "9px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" },
  miniBtn: { background: "#F1F5F9", color: "#0F172A", border: "1px solid #E2E8F0", padding: "5px 10px", borderRadius: 5, fontSize: 12, fontWeight: 500, cursor: "pointer" },
  miniBtnGhost: { background: "white", color: "#64748B", border: "1px solid #E2E8F0", padding: "4px 9px", borderRadius: 5, fontSize: 11, fontWeight: 500, cursor: "pointer" },
  iconBtn: { background: "transparent", border: "none", fontSize: 18, color: "#94A3B8", cursor: "pointer", padding: 4 },

  kpiGrid: { display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 12, marginBottom: 20 },
  kpiCard: { background: "white", borderRadius: 10, padding: "14px 16px", border: "1px solid #E2E8F0" },
  kpiLabel: { fontSize: 11, color: "#64748B", fontWeight: 500, letterSpacing: 0.2 },
  kpiValue: { fontSize: 24, fontWeight: 700, marginTop: 4, letterSpacing: -0.5 },
  kpiUnit: { fontSize: 12, fontWeight: 400, color: "#94A3B8", marginLeft: 3 },
  kpiProgBar: { height: 3, background: "#E2E8F0", borderRadius: 2, marginTop: 8, overflow: "hidden" },
  kpiProgFill: { height: "100%", background: "#0369A1", transition: "width 0.3s" },

  tabBar: { display: "flex", gap: 4, background: "white", padding: 6, borderRadius: 10, border: "1px solid #E2E8F0", marginBottom: 16, width: "fit-content" },
  tab: { background: "transparent", border: "none", padding: "8px 16px", borderRadius: 6, fontSize: 13, fontWeight: 500, color: "#64748B", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 },
  tabActive: { background: "#0F172A", color: "white" },
  tabCount: { background: "rgba(0,0,0,0.08)", padding: "1px 7px", borderRadius: 8, fontSize: 11, fontWeight: 600 },

  tableWrap: { background: "white", borderRadius: 10, border: "1px solid #E2E8F0", overflow: "hidden" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  theadRow: { background: "#F8FAFC", borderBottom: "1px solid #E2E8F0" },
  th: { padding: "11px 12px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: 0.3 },
  thR: { padding: "11px 12px", textAlign: "right", fontSize: 11, fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: 0.3 },
  tr: { borderBottom: "1px solid #F1F5F9", cursor: "pointer" },
  trSelected: { background: "#EFF6FF" },
  td: { padding: "11px 12px", color: "#1F2937" },
  tdR: { padding: "11px 12px", color: "#1F2937", textAlign: "right", fontVariantNumeric: "tabular-nums" },
  tdMono: { padding: "11px 12px", color: "#475569", fontFamily: "'JetBrains Mono', monospace", fontSize: 12 },
  tdBold: { padding: "11px 12px", color: "#0F172A", fontWeight: 600 },
  empty: { padding: 60, textAlign: "center", color: "#94A3B8" },

  badge: { display: "inline-block", padding: "3px 10px", borderRadius: 12, fontSize: 11, fontWeight: 600 },
  badgeBig: { padding: "5px 14px", fontSize: 13 },

  progBar: { width: 80, height: 5, background: "#E2E8F0", borderRadius: 3, overflow: "hidden", display: "inline-block", verticalAlign: "middle" },
  progFill: { height: "100%", background: "#0369A1", transition: "width 0.3s" },
  progLabel: { display: "inline-block", marginLeft: 8, fontSize: 12, color: "#475569", verticalAlign: "middle", fontVariantNumeric: "tabular-nums" },

  loading: { padding: 80, textAlign: "center" },

  drawerBackdrop: { position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.3)", zIndex: 50 },
  drawer: { position: "fixed", top: 0, right: 0, bottom: 0, width: 480, background: "white", boxShadow: "-12px 0 32px rgba(15,23,42,0.12)", zIndex: 51, display: "flex", flexDirection: "column" },
  drawerHeader: { padding: "20px 24px", borderBottom: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  drawerStyleNo: { fontSize: 11, color: "#94A3B8", fontFamily: "'JetBrains Mono', monospace", letterSpacing: 0.3 },
  drawerTitle: { fontSize: 18, fontWeight: 700, color: "#0F172A", marginTop: 4 },
  drawerVendor: { fontSize: 12, color: "#64748B", marginTop: 4 },
  drawerBody: { flex: 1, overflowY: "auto", padding: 16 },
  drawerCard: { background: "#F8FAFC", borderRadius: 8, padding: 14, marginBottom: 10, border: "1px solid #E2E8F0" },
  drawerCardHead: { fontSize: 12, fontWeight: 600, color: "#475569", letterSpacing: 0.2 },
  drawerStat: { fontSize: 13, color: "#1F2937", fontVariantNumeric: "tabular-nums" },
  drawerGrid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 },
  dimLabel: { fontSize: 10, color: "#94A3B8", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4 },
  dimValue: { fontSize: 13, color: "#1F2937", fontVariantNumeric: "tabular-nums" },

  fileEmpty: { fontSize: 12, color: "#94A3B8", padding: "10px 0", textAlign: "center", background: "white", borderRadius: 6, border: "1px dashed #E2E8F0" },

  timeline: { listStyle: "none", padding: 0, margin: "12px 0 0" },
  timelineItem: { display: "flex", gap: 12, padding: "10px 0", borderBottom: "1px solid #E2E8F0" },
  timelineDot: { width: 36, height: 36, borderRadius: 18, background: "#0F172A", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 },
  timelineHeader: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  timelineDate: { fontSize: 13, color: "#1F2937", fontWeight: 600 },
  timelineQty: { fontSize: 13, color: "#0369A1", fontWeight: 700, fontVariantNumeric: "tabular-nums" },
  timelineMemo: { fontSize: 12, color: "#64748B", marginTop: 3 },

  skuGrid: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10, maxHeight: 200, overflowY: "auto" },
  skuPill: { display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", background: "white", border: "1px solid #E2E8F0", borderRadius: 12, fontSize: 11 },
  skuColor: { color: "#475569", fontWeight: 600 },
  skuSize: { color: "#94A3B8" },
  skuQty: { color: "#0369A1", fontWeight: 700, fontVariantNumeric: "tabular-nums" },

  modalBackdrop: { position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.5)", zIndex: 100 },
  modal: { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", background: "white", borderRadius: 12, width: "90%", maxWidth: 640, maxHeight: "85vh", overflow: "hidden", display: "flex", flexDirection: "column", zIndex: 101, boxShadow: "0 25px 50px rgba(0,0,0,0.25)" },
  modalHeader: { padding: "20px 24px", borderBottom: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  modalTitle: { fontSize: 18, fontWeight: 700, color: "#0F172A" },
  modalSubtitle: { fontSize: 12, color: "#64748B", marginTop: 4 },
  modalBody: { flex: 1, overflowY: "auto", padding: 24 },
  modalFooter: { padding: "16px 24px", borderTop: "1px solid #E2E8F0", display: "flex", justifyContent: "flex-end", gap: 8 },

  errorBox: { background: "#FEE2E2", border: "1px solid #FECACA", color: "#991B1B", padding: 12, borderRadius: 6, fontSize: 13, marginBottom: 16 },

  dropZone: { border: "2px dashed #CBD5E1", borderRadius: 12, padding: "48px 24px", textAlign: "center", background: "#F8FAFC", cursor: "pointer" },
  dropIcon: { fontSize: 48, marginBottom: 12 },
  dropText: { fontSize: 14, color: "#475569", marginBottom: 16 },
  uploadLabel: { display: "inline-block", background: "#0F172A", color: "white", padding: "10px 24px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  dropHint: { fontSize: 11, color: "#94A3B8", marginTop: 16 },

  parsing: { textAlign: "center", padding: "32px 0" },
  spinner: { width: 40, height: 40, border: "3px solid #E2E8F0", borderTopColor: "#0F172A", borderRadius: "50%", margin: "0 auto", animation: "spin 0.8s linear infinite" },
  parsingText: { fontSize: 14, color: "#1F2937", fontWeight: 600, marginTop: 16 },
  parsingSub: { fontSize: 12, color: "#94A3B8", marginTop: 4 },

  previewKpi: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 20 },
  previewKpiBox: { background: "#F8FAFC", padding: 12, borderRadius: 8, border: "1px solid #E2E8F0" },
  previewKpiLabel: { fontSize: 10, color: "#64748B", letterSpacing: 0.3, textTransform: "uppercase" },
  previewKpiVal: { fontSize: 22, fontWeight: 700, color: "#0F172A", marginTop: 4, fontVariantNumeric: "tabular-nums" },
  previewKpiUnit: { fontSize: 11, fontWeight: 400, color: "#94A3B8", marginLeft: 3 },

  previewSection: { marginTop: 16 },
  previewSectionTitle: { fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 8 },
  previewList: { background: "#F8FAFC", borderRadius: 8, border: "1px solid #E2E8F0", maxHeight: 200, overflowY: "auto" },
  previewRow: { display: "grid", gridTemplateColumns: "1.5fr 1.5fr 1fr", padding: "8px 14px", fontSize: 12, borderBottom: "1px solid #E2E8F0", alignItems: "center" },
  previewSheet: { color: "#1F2937", fontWeight: 500 },
  previewStyle: { color: "#64748B", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 },
  previewQty: { textAlign: "right", color: "#0369A1", fontWeight: 600, fontVariantNumeric: "tabular-nums" },
  previewSkipped: { background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 6, padding: 10, fontSize: 11, color: "#9A3412", lineHeight: 1.6 },

  formField: { marginBottom: 16 },
  formLabel: { display: "block", fontSize: 12, color: "#475569", fontWeight: 600, marginBottom: 6 },
  formInput: { width: "100%", padding: "8px 10px", border: "1px solid #CBD5E1", borderRadius: 6, fontSize: 13, color: "#0F172A", boxSizing: "border-box", fontFamily: "inherit" },
  formStatic: { padding: "10px 12px", background: "#F1F5F9", borderRadius: 6, fontSize: 14, color: "#0F172A", fontWeight: 600 },
  remainHint: { color: "#94A3B8", fontWeight: 400, fontSize: 11 },

  analyticsWrap: { background: "white", borderRadius: 10, padding: 24, border: "1px solid #E2E8F0" },
  analGrid: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 },
  analCard: { background: "#F8FAFC", borderRadius: 10, padding: 20, border: "1px solid #E2E8F0" },
  analTitle: { fontSize: 14, fontWeight: 700, color: "#0F172A" },
  analSub: { fontSize: 11, color: "#94A3B8", marginTop: 3 },

  vendorRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #E2E8F0" },
  vendorName: { fontSize: 13, fontWeight: 600, color: "#1F2937" },
  vendorMeta: { display: "flex", gap: 16, fontSize: 11, color: "#64748B", alignItems: "center" },
  vendorAvg: { background: "#0F172A", color: "white", padding: "3px 10px", borderRadius: 4, fontSize: 12, fontWeight: 600 },

  orderProgRow: { marginBottom: 12 },
  orderProgLabel: { display: "flex", justifyContent: "space-between", marginBottom: 4 },
  orderProgName: { fontSize: 12, color: "#1F2937", fontWeight: 500 },
  orderProgQty: { fontSize: 11, color: "#64748B", fontVariantNumeric: "tabular-nums" },

  topRow: { display: "flex", alignItems: "center", gap: 10, padding: "8px 0", position: "relative" },
  topRank: { width: 22, height: 22, borderRadius: 11, background: "#0F172A", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 },
  topName: { fontSize: 13, color: "#1F2937", flex: 1, fontWeight: 500 },
  topQty: { fontSize: 12, color: "#0369A1", fontWeight: 700, fontVariantNumeric: "tabular-nums" },
  topBar: { position: "absolute", left: 32, bottom: 0, height: 3, background: "#0369A1", borderRadius: 2, opacity: 0.3 },
};

const CSS = `
@keyframes spin { to { transform: rotate(360deg); } }
button:hover { opacity: 0.92; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
input:focus, textarea:focus { outline: none; border-color: #0F172A; box-shadow: 0 0 0 3px rgba(15, 23, 42, 0.08); }
`;
