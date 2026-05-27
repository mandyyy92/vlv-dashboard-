import { useState, useMemo, useRef } from "react";

// ============================================================
// 26SS 작업지시서 실제 데이터 (Mock)
// ============================================================
const SEED_ORDERS = [
  {
    id: 1,
    order_no: "PO-26SS-001",
    style_no: "V24ST01UB400",
    product_name: "Essential",
    vendor_name: "MERITUM KNITS",
    season: "26SS",
    contract_date: "2025-11-13",
    expected_final_date: "2026-02-28",
    actual_final_date: null,
    contract_file: { name: "MERITUM_26SS_계약서.pdf", uploaded_at: "2025-11-13" },
    items: [
      { color: "NAVY", size: "S", qty: 700 }, { color: "NAVY", size: "M", qty: 600 },
      { color: "NAVY", size: "L", qty: 500 }, { color: "NAVY", size: "XL", qty: 500 },
      { color: "MELANGE", size: "S", qty: 500 }, { color: "MELANGE", size: "M", qty: 400 },
      { color: "MELANGE", size: "L", qty: 400 }, { color: "MELANGE", size: "XL", qty: 400 },
      { color: "WHITE MELANGE", size: "S", qty: 700 }, { color: "WHITE MELANGE", size: "M", qty: 600 },
      { color: "WHITE MELANGE", size: "L", qty: 500 }, { color: "WHITE MELANGE", size: "XL", qty: 500 },
      { color: "BLACK", size: "S", qty: 500 }, { color: "BLACK", size: "M", qty: 500 },
      { color: "CHARCOAL", size: "S", qty: 500 }, { color: "CHARCOAL", size: "M", qty: 500 },
      { color: "CHARCOAL", size: "L", qty: 400 }, { color: "CHARCOAL", size: "XL", qty: 400 },
      { color: "WHITE", size: "S", qty: 1500 }, { color: "WHITE", size: "M", qty: 1500 },
    ],
    inbounds: [
      { round: 1, date: "2026-01-20", qty: 4500, memo: "1차 입고 - WHITE/NAVY 우선 출고" },
      { round: 2, date: "2026-02-10", qty: 3800, memo: "2차 입고 - CHARCOAL/MELANGE" },
    ],
  },
  {
    id: 2,
    order_no: "PO-26SS-002",
    style_no: "V24ST01UA501",
    product_name: "Restchill",
    vendor_name: "MERITUM KNITS",
    season: "26SS",
    contract_date: "2025-11-13",
    expected_final_date: "2026-02-15",
    actual_final_date: "2026-02-12",
    contract_file: { name: "MERITUM_26SS_계약서.pdf", uploaded_at: "2025-11-13" },
    items: [
      { color: "WHITE", size: "S", qty: 500 }, { color: "WHITE", size: "M", qty: 1100 },
      { color: "WHITE", size: "L", qty: 1100 }, { color: "WHITE", size: "XL", qty: 500 },
      { color: "NAVY", size: "S", qty: 300 }, { color: "NAVY", size: "M", qty: 300 },
      { color: "NAVY", size: "L", qty: 300 }, { color: "NAVY", size: "XL", qty: 200 },
      { color: "BLACK", size: "S", qty: 300 }, { color: "BLACK", size: "M", qty: 300 },
      { color: "BLACK", size: "L", qty: 300 }, { color: "BLACK", size: "XL", qty: 200 },
      { color: "WHITE MELANGE", size: "S", qty: 300 }, { color: "WHITE MELANGE", size: "M", qty: 300 },
      { color: "WHITE MELANGE", size: "L", qty: 300 }, { color: "WHITE MELANGE", size: "XL", qty: 200 },
    ],
    inbounds: [
      { round: 1, date: "2026-01-15", qty: 3000, memo: "1차 입고 - WHITE 메인 컬러" },
      { round: 2, date: "2026-02-05", qty: 2500, memo: "2차 입고 - 잔여 전 컬러" },
      { round: 3, date: "2026-02-12", qty: 1000, memo: "3차 입고 - 최종 마감" },
    ],
  },
  {
    id: 3,
    order_no: "PO-26SS-003",
    style_no: "V26ST01UB600",
    product_name: "Unisex Ringer T-shirt",
    vendor_name: "MERITUM KNITS",
    season: "26SS",
    contract_date: "2025-11-13",
    expected_final_date: "2026-02-20",
    actual_final_date: null,
    contract_file: { name: "MERITUM_26SS_계약서.pdf", uploaded_at: "2025-11-13" },
    items: [
      { color: "CREAM", size: "M", qty: 400 }, { color: "CREAM", size: "L", qty: 300 }, { color: "CREAM", size: "XL", qty: 300 },
      { color: "MELANGE", size: "M", qty: 400 }, { color: "MELANGE", size: "L", qty: 300 }, { color: "MELANGE", size: "XL", qty: 300 },
      { color: "NAVY", size: "M", qty: 400 }, { color: "NAVY", size: "L", qty: 300 }, { color: "NAVY", size: "XL", qty: 300 },
      { color: "BURGUNDY", size: "M", qty: 400 }, { color: "BURGUNDY", size: "L", qty: 300 }, { color: "BURGUNDY", size: "XL", qty: 300 },
      { color: "CHARCOAL", size: "M", qty: 400 }, { color: "CHARCOAL", size: "L", qty: 300 }, { color: "CHARCOAL", size: "XL", qty: 300 },
    ],
    inbounds: [
      { round: 1, date: "2026-01-25", qty: 2000, memo: "1차 입고 - CREAM/NAVY" },
    ],
  },
  {
    id: 4,
    order_no: "PO-26SS-004",
    style_no: "V26PT02WB600",
    product_name: "Women's Long Sleeve T-shirt",
    vendor_name: "MERITUM KNITS",
    season: "26SS",
    contract_date: "2025-11-13",
    expected_final_date: "2026-02-10",
    actual_final_date: null,
    contract_file: { name: "MERITUM_26SS_계약서.pdf", uploaded_at: "2025-11-13" },
    items: [
      { color: "WHITE", size: "S", qty: 500 }, { color: "WHITE", size: "M", qty: 500 }, { color: "WHITE", size: "L", qty: 500 },
      { color: "BLACK", size: "S", qty: 500 }, { color: "BLACK", size: "M", qty: 500 }, { color: "BLACK", size: "L", qty: 500 },
    ],
    inbounds: [],
  },
  {
    id: 5,
    order_no: "PO-26SS-005",
    style_no: "V25ST02WB500",
    product_name: "W.Slim",
    vendor_name: "MERITUM KNITS",
    season: "26SS",
    contract_date: "2025-11-13",
    expected_final_date: "2026-02-25",
    actual_final_date: null,
    contract_file: null,
    items: [
      { color: "NAVY", size: "FREE", qty: 500 }, { color: "MELANGE", size: "FREE", qty: 400 },
      { color: "WHITE MELANGE", size: "FREE", qty: 300 }, { color: "BLACK", size: "FREE", qty: 300 },
      { color: "CHARCOAL", size: "FREE", qty: 500 }, { color: "WHITE", size: "FREE", qty: 1000 },
    ],
    inbounds: [
      { round: 1, date: "2026-01-30", qty: 1500, memo: "1차 입고" },
    ],
  },
  {
    id: 6,
    order_no: "PO-26SS-006",
    style_no: "V26ST02WB600",
    product_name: "Women's Ringer T-shirt",
    vendor_name: "MERITUM KNITS",
    season: "26SS",
    contract_date: "2025-11-13",
    expected_final_date: "2026-02-18",
    actual_final_date: "2026-02-08",
    contract_file: { name: "MERITUM_26SS_계약서.pdf", uploaded_at: "2025-11-13" },
    items: [
      { color: "CREAM", size: "FREE", qty: 350 }, { color: "MELANGE", size: "FREE", qty: 350 },
      { color: "NAVY", size: "FREE", qty: 350 }, { color: "BURGUNDY", size: "FREE", qty: 350 },
      { color: "CHARCOAL", size: "FREE", qty: 350 },
    ],
    inbounds: [
      { round: 1, date: "2026-01-28", qty: 1000, memo: "1차 입고" },
      { round: 2, date: "2026-02-08", qty: 750, memo: "2차 입고 - 완료" },
    ],
  },
  {
    id: 7,
    order_no: "PO-26SS-007",
    style_no: "V26ST01MB600",
    product_name: "Men's Crop T-shirt",
    vendor_name: "MERITUM KNITS",
    season: "26SS",
    contract_date: "2025-11-13",
    expected_final_date: "2026-02-22",
    actual_final_date: null,
    contract_file: { name: "MERITUM_26SS_계약서.pdf", uploaded_at: "2025-11-13" },
    items: [
      { color: "WHITE", size: "M", qty: 100 }, { color: "WHITE", size: "L", qty: 120 }, { color: "WHITE", size: "XL", qty: 120 },
      { color: "MELANGE", size: "M", qty: 100 }, { color: "MELANGE", size: "L", qty: 120 }, { color: "MELANGE", size: "XL", qty: 120 },
      { color: "BLACK", size: "M", qty: 100 }, { color: "BLACK", size: "L", qty: 120 }, { color: "BLACK", size: "XL", qty: 120 },
    ],
    inbounds: [],
  },
  {
    id: 8,
    order_no: "PO-26SS-008",
    style_no: "V25ST01UA501",
    product_name: "Graychill",
    vendor_name: "MERITUM KNITS",
    season: "26SS",
    contract_date: "2025-11-13",
    expected_final_date: "2026-01-31",
    actual_final_date: null,
    contract_file: null,
    items: [
      { color: "CHARCOAL", size: "M", qty: 400 }, { color: "CHARCOAL", size: "L", qty: 500 },
      { color: "CHARCOAL", size: "XL", qty: 400 }, { color: "CHARCOAL", size: "2XL", qty: 300 },
    ],
    inbounds: [
      { round: 1, date: "2026-01-25", qty: 600, memo: "1차 입고 - 일부만" },
    ],
  },
];

// ============================================================
// 유틸리티 함수
// ============================================================
function calcOrderTotals(order) {
  const total_qty = order.items.reduce((s, it) => s + it.qty, 0);
  const received_qty = order.inbounds.reduce((s, ib) => s + ib.qty, 0);
  const remain_qty = total_qty - received_qty;
  const today = new Date("2026-02-15"); // Demo: 가상의 오늘 날짜
  const expDate = order.expected_final_date ? new Date(order.expected_final_date) : null;

  let status;
  if (received_qty >= total_qty && total_qty > 0) status = "completed";
  else if (received_qty === 0) {
    status = expDate && expDate < today ? "delayed" : "in_progress";
  } else {
    status = expDate && expDate < today && received_qty < total_qty ? "delayed" : "partial";
  }

  const leadtime_days = order.actual_final_date && order.contract_date
    ? Math.round((new Date(order.actual_final_date) - new Date(order.contract_date)) / 86400000)
    : null;

  return { total_qty, received_qty, remain_qty, status, leadtime_days, receive_rate: total_qty ? Math.round((received_qty / total_qty) * 1000) / 10 : 0 };
}

const STATUS_LABEL = {
  in_progress: { ko: "진행중", color: "#64748B", bg: "#F1F5F9" },
  partial: { ko: "부분입고", color: "#0369A1", bg: "#E0F2FE" },
  completed: { ko: "입고완료", color: "#15803D", bg: "#DCFCE7" },
  delayed: { ko: "지연", color: "#B91C1C", bg: "#FEE2E2" },
};

function fmt(n) { return n?.toLocaleString() ?? "0"; }
function pct(n) { return `${n.toFixed(1)}%`; }

// ============================================================
// 메인 컴포넌트
// ============================================================
export default function ProductionDashboard() {
  const [orders, setOrders] = useState(SEED_ORDERS);
  const [tab, setTab] = useState("all"); // all | in_progress | partial | completed | delayed | analytics
  const [selectedId, setSelectedId] = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const [showInbound, setShowInbound] = useState(null); // orderId or null

  // 집계 계산
  const enriched = useMemo(
    () => orders.map(o => ({ ...o, ...calcOrderTotals(o) })),
    [orders]
  );

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

  const handleUploadComplete = (newOrders) => {
    setOrders(prev => [...prev, ...newOrders]);
    setShowUpload(false);
  };

  const handleAddInbound = (orderId, inbound) => {
    setOrders(prev => prev.map(o => {
      if (o.id !== orderId) return o;
      const round = (o.inbounds.length || 0) + 1;
      return { ...o, inbounds: [...o.inbounds, { ...inbound, round }] };
    }));
    setShowInbound(null);
  };

  const handleUploadContract = (orderId, fileName) => {
    setOrders(prev => prev.map(o => o.id === orderId ? {
      ...o,
      contract_file: { name: fileName, uploaded_at: new Date().toISOString().slice(0, 10) }
    } : o));
  };

  return (
    <div style={S.wrap}>
      <style>{CSS}</style>

      {/* 헤더 */}
      <header style={S.header}>
        <div>
          <div style={S.brandRow}>
            <div style={S.brandLogo}>VLVD</div>
            <div style={S.brandTitle}>생산 오더 입고 관리 시스템</div>
          </div>
          <div style={S.subtitle}>VIVA LA VIDA · Production Order Lifecycle Management</div>
        </div>
        <button style={S.primaryBtn} onClick={() => setShowUpload(true)}>
          <span style={{ fontSize: 18, marginRight: 6 }}>＋</span> 작업지시서 업로드
        </button>
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
          <button
            key={t.k}
            style={{ ...S.tab, ...(tab === t.k ? S.tabActive : {}) }}
            onClick={() => setTab(t.k)}
          >
            {t.label}
            {t.count !== null && <span style={S.tabCount}>{t.count}</span>}
          </button>
        ))}
      </nav>

      {/* 메인 영역 */}
      {tab === "analytics" ? (
        <AnalyticsPanel orders={enriched} kpi={kpi} />
      ) : (
        <div style={S.tableWrap}>
          <table style={S.table}>
            <thead>
              <tr style={S.theadRow}>
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
                <tr key={o.id}
                  style={{ ...S.tr, ...(selectedId === o.id ? S.trSelected : {}) }}
                  onClick={() => setSelectedId(o.id)}
                >
                  <td style={S.tdMono}>{o.style_no}</td>
                  <td style={S.tdBold}>{o.product_name}</td>
                  <td style={S.td}>{o.vendor_name}</td>
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
                    <button
                      style={S.miniBtn}
                      onClick={(e) => { e.stopPropagation(); setShowInbound(o.id); }}
                    >
                      입고 등록
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={13} style={S.empty}>해당 상태의 오더가 없습니다</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Drawer: 오더 상세 */}
      {selected && tab !== "analytics" && (
        <OrderDrawer
          order={selected}
          onClose={() => setSelectedId(null)}
          onUploadContract={(name) => handleUploadContract(selected.id, name)}
          onAddInbound={() => setShowInbound(selected.id)}
        />
      )}

      {/* Modal: 엑셀 업로드 */}
      {showUpload && (
        <UploadModal
          existingOrderNos={orders.map(o => o.order_no)}
          onClose={() => setShowUpload(false)}
          onComplete={handleUploadComplete}
        />
      )}

      {/* Modal: 입고 등록 */}
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
// Drawer: 오더 상세
// ============================================================
function OrderDrawer({ order, onClose, onUploadContract, onAddInbound }) {
  const contractInputRef = useRef(null);
  return (
    <>
      <div style={S.drawerBackdrop} onClick={onClose} />
      <aside style={S.drawer}>
        <div style={S.drawerHeader}>
          <div>
            <div style={S.drawerStyleNo}>{order.style_no}</div>
            <div style={S.drawerTitle}>{order.product_name}</div>
            <div style={S.drawerVendor}>{order.vendor_name} · {order.season}</div>
          </div>
          <button style={S.iconBtn} onClick={onClose}>✕</button>
        </div>

        <div style={S.drawerBody}>
          {/* 상태 카드 */}
          <div style={S.drawerCard}>
            <div style={S.drawerCardHead}>현재 상태</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 8 }}>
              <span style={{ ...S.badge, ...S.badgeBig, color: STATUS_LABEL[order.status].color, background: STATUS_LABEL[order.status].bg }}>
                {STATUS_LABEL[order.status].ko}
              </span>
              <div style={S.drawerStat}>{fmt(order.received_qty)} / {fmt(order.total_qty)} 장 ({pct(order.receive_rate)})</div>
            </div>
            <div style={{ ...S.progBar, marginTop: 12, height: 8 }}>
              <div style={{ ...S.progFill, width: `${order.receive_rate}%`, background: order.status === "delayed" ? "#B91C1C" : order.status === "completed" ? "#15803D" : "#0369A1" }} />
            </div>
          </div>

          {/* 계약서 */}
          <div style={S.drawerCard}>
            <div style={S.drawerCardHead}>📄 계약서</div>
            {order.contract_file ? (
              <div style={{ marginTop: 10 }}>
                <div style={S.fileRow}>
                  <div>
                    <div style={S.fileName}>{order.contract_file.name}</div>
                    <div style={S.fileMeta}>업로드: {order.contract_file.uploaded_at}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button style={S.miniBtn} onClick={() => alert(`데모: ${order.contract_file.name} 다운로드`)}>다운로드</button>
                    <button style={S.miniBtnGhost} onClick={() => contractInputRef.current?.click()}>교체</button>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 10 }}>
                <div style={S.fileEmpty}>계약서 미첨부</div>
                <button style={{ ...S.primaryBtn, marginTop: 8, width: "100%" }} onClick={() => contractInputRef.current?.click()}>
                  계약서 업로드
                </button>
              </div>
            )}
            <input
              ref={contractInputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUploadContract(f.name);
              }}
            />
          </div>

          {/* 리드타임 */}
          <div style={S.drawerCard}>
            <div style={S.drawerCardHead}>⏱ 리드타임</div>
            <div style={S.drawerGrid2}>
              <div><div style={S.dimLabel}>계약일</div><div style={S.dimValue}>{order.contract_date ?? "—"}</div></div>
              <div><div style={S.dimLabel}>예상 완료일</div><div style={S.dimValue}>{order.expected_final_date ?? "—"}</div></div>
              <div><div style={S.dimLabel}>실제 완료일</div><div style={S.dimValue}>{order.actual_final_date ?? "—"}</div></div>
              <div><div style={S.dimLabel}>리드타임</div><div style={{ ...S.dimValue, fontWeight: 700, color: "#0369A1" }}>{order.leadtime_days != null ? `${order.leadtime_days}일` : "미완료"}</div></div>
            </div>
          </div>

          {/* 입고 이력 */}
          <div style={S.drawerCard}>
            <div style={{ ...S.drawerCardHead, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>📦 입고 이력 ({order.inbounds.length}회)</span>
              <button style={S.miniBtn} onClick={onAddInbound}>+ 입고 등록</button>
            </div>
            {order.inbounds.length === 0 ? (
              <div style={{ ...S.fileEmpty, marginTop: 10 }}>아직 입고가 없습니다</div>
            ) : (
              <ol style={S.timeline}>
                {order.inbounds.map((ib) => (
                  <li key={ib.round} style={S.timelineItem}>
                    <div style={S.timelineDot}>{ib.round}차</div>
                    <div style={{ flex: 1 }}>
                      <div style={S.timelineHeader}>
                        <span style={S.timelineDate}>{ib.date}</span>
                        <span style={S.timelineQty}>{fmt(ib.qty)} 장</span>
                      </div>
                      <div style={S.timelineMemo}>{ib.memo || "—"}</div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* 라인 아이템 */}
          <div style={S.drawerCard}>
            <div style={S.drawerCardHead}>🎨 색상 × 사이즈 ({order.items.length}개 SKU)</div>
            <div style={S.skuGrid}>
              {order.items.map((it, i) => (
                <div key={i} style={S.skuPill}>
                  <span style={S.skuColor}>{it.color}</span>
                  <span style={S.skuSize}>{it.size}</span>
                  <span style={S.skuQty}>{fmt(it.qty)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

// ============================================================
// Modal: 엑셀 업로드
// ============================================================
function UploadModal({ existingOrderNos, onClose, onComplete }) {
  const [step, setStep] = useState("select"); // select | parsing | preview
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);

  const handleFile = (f) => {
    setFile(f);
    setStep("parsing");
    // Mock 파싱: 1.5초 후 26SS 데이터 보여줌
    setTimeout(() => {
      setParsed({
        sheets_processed: 8,
        sheets_skipped: 6,
        total_qty: 33970,
        sku_count: 81,
        factory: "MERITUM KNITS",
        sheets: [
          { name: "U_Essential", style: "V24ST01UB400", qty: 12100 },
          { name: "U_Restchill", style: "V24ST01UA501", qty: 6500 },
          { name: "U_Ringer Tee", style: "V26ST01UB600", qty: 5000 },
          { name: "W_Long Sleeve", style: "V26PT02WB600", qty: 3000 },
          { name: "W_Slim Tee", style: "V25ST02WB500", qty: 3000 },
          { name: "W_Ringer Tee", style: "V26ST02WB600", qty: 1750 },
          { name: "U_Graychill", style: "V25ST01UA501", qty: 1600 },
          { name: "M_Crop Tee", style: "V26ST01MB600", qty: 1020 },
        ],
        skipped: ["나일론팬츠(중국)", "와이드데님팬츠(중국)", "커브드진", "코튼와이드팬츠(중국)", "탱크탑", "M_Crop Ringer Tee"],
      });
      setStep("preview");
    }, 1500);
  };

  const handleConfirm = () => {
    alert(`데모: ${parsed.sheets_processed}개 스타일 / ${fmt(parsed.total_qty)}장 / ${parsed.sku_count}개 SKU 가 시스템에 추가되었습니다.\n\n실제 운영 시에는 Supabase로 INSERT됩니다.`);
    onClose();
  };

  return (
    <>
      <div style={S.modalBackdrop} onClick={onClose} />
      <div style={S.modal}>
        <div style={S.modalHeader}>
          <div>
            <div style={S.modalTitle}>📂 작업지시서 업로드</div>
            <div style={S.modalSubtitle}>엑셀 파일을 자동 파싱하여 생산 오더로 등록</div>
          </div>
          <button style={S.iconBtn} onClick={onClose}>✕</button>
        </div>

        <div style={S.modalBody}>
          {step === "select" && (
            <div
              style={S.dropZone}
              onDragOver={(e) => { e.preventDefault(); }}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) handleFile(f);
              }}
            >
              <div style={S.dropIcon}>📊</div>
              <div style={S.dropText}>엑셀 파일을 여기에 드래그하거나</div>
              <label style={S.uploadLabel}>
                파일 선택
                <input type="file" accept=".xlsx,.xls" style={{ display: "none" }}
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
              </label>
              <div style={S.dropHint}>지원: .xlsx · 숨김 시트는 자동 제외</div>
            </div>
          )}

          {step === "parsing" && (
            <div style={S.parsing}>
              <div style={S.spinner} />
              <div style={S.parsingText}>엑셀 파싱 중...</div>
              <div style={S.parsingSub}>{file?.name}</div>
              <div style={S.parsingSteps}>
                <div>✓ 숨김 시트 감지 및 제외</div>
                <div>✓ COLOR / SIZE 헤더 자동 탐색</div>
                <div>✓ 색상 × 사이즈 매트릭스 추출</div>
                <div>✓ 수량 합산 및 SKU 카운트</div>
              </div>
            </div>
          )}

          {step === "preview" && parsed && (
            <div>
              <div style={S.previewKpi}>
                <div style={S.previewKpiBox}>
                  <div style={S.previewKpiLabel}>처리된 시트</div>
                  <div style={S.previewKpiVal}>{parsed.sheets_processed}</div>
                </div>
                <div style={S.previewKpiBox}>
                  <div style={S.previewKpiLabel}>총 수량</div>
                  <div style={S.previewKpiVal}>{fmt(parsed.total_qty)}<span style={S.previewKpiUnit}>장</span></div>
                </div>
                <div style={S.previewKpiBox}>
                  <div style={S.previewKpiLabel}>SKU</div>
                  <div style={S.previewKpiVal}>{parsed.sku_count}</div>
                </div>
                <div style={S.previewKpiBox}>
                  <div style={S.previewKpiLabel}>작업처</div>
                  <div style={{ ...S.previewKpiVal, fontSize: 16 }}>{parsed.factory}</div>
                </div>
              </div>

              <div style={S.previewSection}>
                <div style={S.previewSectionTitle}>✅ 등록 예정 ({parsed.sheets.length}개 스타일)</div>
                <div style={S.previewList}>
                  {parsed.sheets.map((s, i) => (
                    <div key={i} style={S.previewRow}>
                      <span style={S.previewSheet}>{s.name}</span>
                      <span style={S.previewStyle}>{s.style}</span>
                      <span style={S.previewQty}>{fmt(s.qty)} 장</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={S.previewSection}>
                <div style={S.previewSectionTitle}>⊘ 자동 제외 (숨김 시트 {parsed.skipped.length}개)</div>
                <div style={S.previewSkipped}>{parsed.skipped.join(" · ")}</div>
              </div>
            </div>
          )}
        </div>

        {step === "preview" && (
          <div style={S.modalFooter}>
            <button style={S.ghostBtn} onClick={onClose}>취소</button>
            <button style={S.primaryBtn} onClick={handleConfirm}>등록 확정</button>
          </div>
        )}
      </div>
    </>
  );
}

// ============================================================
// Modal: 입고 등록
// ============================================================
function InboundModal({ order, onClose, onSubmit }) {
  const round = order.inbounds.length + 1;
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [qty, setQty] = useState("");
  const [memo, setMemo] = useState("");

  const submit = () => {
    const n = parseInt(qty, 10);
    if (!n || n <= 0) { alert("입고 수량을 입력하세요"); return; }
    if (n > order.remain_qty) {
      if (!confirm(`잔여 수량(${fmt(order.remain_qty)})을 초과합니다. 그래도 등록할까요?`)) return;
    }
    onSubmit({ date, qty: n, memo });
  };

  return (
    <>
      <div style={S.modalBackdrop} onClick={onClose} />
      <div style={{ ...S.modal, maxWidth: 460 }}>
        <div style={S.modalHeader}>
          <div>
            <div style={S.modalTitle}>📦 {round}차 입고 등록</div>
            <div style={S.modalSubtitle}>{order.product_name} · {order.style_no}</div>
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
          <button style={S.ghostBtn} onClick={onClose}>취소</button>
          <button style={S.primaryBtn} onClick={submit}>등록</button>
        </div>
      </div>
    </>
  );
}

// ============================================================
// 리드타임 분석 패널
// ============================================================
function AnalyticsPanel({ orders, kpi }) {
  // 업체별 평균 리드타임
  const byVendor = useMemo(() => {
    const map = {};
    orders.forEach(o => {
      if (o.leadtime_days == null) return;
      if (!map[o.vendor_name]) map[o.vendor_name] = { total: 0, count: 0, completed: 0, delayed: 0 };
      map[o.vendor_name].total += o.leadtime_days;
      map[o.vendor_name].count += 1;
    });
    orders.forEach(o => {
      if (!map[o.vendor_name]) map[o.vendor_name] = { total: 0, count: 0, completed: 0, delayed: 0 };
      if (o.status === "completed") map[o.vendor_name].completed += 1;
      if (o.status === "delayed") map[o.vendor_name].delayed += 1;
    });
    return Object.entries(map).map(([name, v]) => ({
      name, avg: v.count ? Math.round(v.total / v.count) : null,
      completed: v.completed, delayed: v.delayed,
    }));
  }, [orders]);

  const maxQty = Math.max(...orders.map(o => o.total_qty), 1);

  return (
    <div style={S.analyticsWrap}>
      <div style={S.analGrid}>
        {/* 업체별 평균 리드타임 */}
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

        {/* 오더별 진행률 */}
        <div style={S.analCard}>
          <div style={S.analTitle}>오더별 진행률</div>
          <div style={S.analSub}>전체 오더의 입고 진행 상황</div>
          <div style={{ marginTop: 16 }}>
            {orders.map(o => (
              <div key={o.id} style={S.orderProgRow}>
                <div style={S.orderProgLabel}>
                  <span style={S.orderProgName}>{o.product_name}</span>
                  <span style={S.orderProgQty}>{fmt(o.received_qty)} / {fmt(o.total_qty)}</span>
                </div>
                <div style={S.progBar}>
                  <div style={{ ...S.progFill, width: `${o.receive_rate}%`, background: o.status === "delayed" ? "#B91C1C" : o.status === "completed" ? "#15803D" : "#0369A1" }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 상태 분포 */}
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
              const pct = (s.count / orders.length) * 100;
              const lbl = STATUS_LABEL[s.k];
              return (
                <div key={s.k} style={{ flex: pct || 0.5, minWidth: 60 }}>
                  <div style={{ height: 80, background: lbl.bg, borderRadius: 6, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 8 }}>
                    <span style={{ fontSize: 22, fontWeight: 700, color: lbl.color }}>{s.count}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#64748B", textAlign: "center", marginTop: 6 }}>{lbl.ko}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 수량 TOP */}
        <div style={S.analCard}>
          <div style={S.analTitle}>수량 TOP</div>
          <div style={S.analSub}>발주 수량 기준 상위</div>
          <div style={{ marginTop: 16 }}>
            {[...orders].sort((a, b) => b.total_qty - a.total_qty).slice(0, 5).map((o, i) => (
              <div key={o.id} style={S.topRow}>
                <span style={S.topRank}>{i + 1}</span>
                <span style={S.topName}>{o.product_name}</span>
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
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, gap: 24 },
  brandRow: { display: "flex", alignItems: "center", gap: 12 },
  brandLogo: { background: "#0F172A", color: "#E8A87C", fontWeight: 700, fontSize: 12, padding: "4px 8px", borderRadius: 4, letterSpacing: 0.3 },
  brandTitle: { fontSize: 16, fontWeight: 600, color: "#0F172A", letterSpacing: -0.2 },
  subtitle: { fontSize: 12, color: "#64748B", marginTop: 6, marginLeft: 2, letterSpacing: 0.2 },

  primaryBtn: { background: "#0F172A", color: "white", border: "none", padding: "10px 18px", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", transition: "all 0.15s" },
  ghostBtn: { background: "white", color: "#475569", border: "1px solid #E2E8F0", padding: "10px 18px", borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: "pointer" },
  miniBtn: { background: "#F1F5F9", color: "#0F172A", border: "1px solid #E2E8F0", padding: "5px 10px", borderRadius: 5, fontSize: 12, fontWeight: 500, cursor: "pointer" },
  miniBtnGhost: { background: "white", color: "#64748B", border: "1px solid #E2E8F0", padding: "5px 10px", borderRadius: 5, fontSize: 12, fontWeight: 500, cursor: "pointer" },
  iconBtn: { background: "transparent", border: "none", fontSize: 18, color: "#94A3B8", cursor: "pointer", padding: 4 },

  kpiGrid: { display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 12, marginBottom: 20 },
  kpiCard: { background: "white", borderRadius: 10, padding: "14px 16px", border: "1px solid #E2E8F0" },
  kpiLabel: { fontSize: 11, color: "#64748B", fontWeight: 500, letterSpacing: 0.2 },
  kpiValue: { fontSize: 24, fontWeight: 700, marginTop: 4, letterSpacing: -0.5 },
  kpiUnit: { fontSize: 12, fontWeight: 400, color: "#94A3B8", marginLeft: 3 },
  kpiProgBar: { height: 3, background: "#E2E8F0", borderRadius: 2, marginTop: 8, overflow: "hidden" },
  kpiProgFill: { height: "100%", background: "#0369A1", transition: "width 0.3s" },

  tabBar: { display: "flex", gap: 4, background: "white", padding: 6, borderRadius: 10, border: "1px solid #E2E8F0", marginBottom: 16, width: "fit-content" },
  tab: { background: "transparent", border: "none", padding: "8px 16px", borderRadius: 6, fontSize: 13, fontWeight: 500, color: "#64748B", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, transition: "all 0.15s" },
  tabActive: { background: "#0F172A", color: "white" },
  tabCount: { background: "rgba(0,0,0,0.08)", padding: "1px 7px", borderRadius: 8, fontSize: 11, fontWeight: 600 },

  tableWrap: { background: "white", borderRadius: 10, border: "1px solid #E2E8F0", overflow: "hidden" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  theadRow: { background: "#F8FAFC", borderBottom: "1px solid #E2E8F0" },
  th: { padding: "11px 12px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: 0.3 },
  thR: { padding: "11px 12px", textAlign: "right", fontSize: 11, fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: 0.3 },
  tr: { borderBottom: "1px solid #F1F5F9", cursor: "pointer", transition: "background 0.1s" },
  trSelected: { background: "#EFF6FF" },
  td: { padding: "11px 12px", color: "#1F2937" },
  tdR: { padding: "11px 12px", color: "#1F2937", textAlign: "right", fontVariantNumeric: "tabular-nums" },
  tdMono: { padding: "11px 12px", color: "#475569", fontFamily: "'JetBrains Mono', 'Menlo', monospace", fontSize: 12 },
  tdBold: { padding: "11px 12px", color: "#0F172A", fontWeight: 600 },
  empty: { padding: 60, textAlign: "center", color: "#94A3B8" },

  badge: { display: "inline-block", padding: "3px 10px", borderRadius: 12, fontSize: 11, fontWeight: 600 },
  badgeBig: { padding: "5px 14px", fontSize: 13 },

  progBar: { width: 80, height: 5, background: "#E2E8F0", borderRadius: 3, overflow: "hidden", display: "inline-block", verticalAlign: "middle" },
  progFill: { height: "100%", background: "#0369A1", transition: "width 0.3s" },
  progLabel: { display: "inline-block", marginLeft: 8, fontSize: 12, color: "#475569", verticalAlign: "middle", fontVariantNumeric: "tabular-nums" },

  // Drawer
  drawerBackdrop: { position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.3)", zIndex: 50 },
  drawer: { position: "fixed", top: 0, right: 0, bottom: 0, width: 480, background: "white", boxShadow: "-12px 0 32px rgba(15,23,42,0.12)", zIndex: 51, display: "flex", flexDirection: "column", animation: "slideIn 0.2s ease-out" },
  drawerHeader: { padding: "20px 24px", borderBottom: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  drawerStyleNo: { fontSize: 11, color: "#94A3B8", fontFamily: "'JetBrains Mono', 'Menlo', monospace", letterSpacing: 0.3 },
  drawerTitle: { fontSize: 18, fontWeight: 700, color: "#0F172A", marginTop: 4 },
  drawerVendor: { fontSize: 12, color: "#64748B", marginTop: 4 },
  drawerBody: { flex: 1, overflowY: "auto", padding: 16 },
  drawerCard: { background: "#F8FAFC", borderRadius: 8, padding: 14, marginBottom: 10, border: "1px solid #E2E8F0" },
  drawerCardHead: { fontSize: 12, fontWeight: 600, color: "#475569", letterSpacing: 0.2 },
  drawerStat: { fontSize: 13, color: "#1F2937", fontVariantNumeric: "tabular-nums" },
  drawerGrid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 },
  dimLabel: { fontSize: 10, color: "#94A3B8", textTransform: "uppercase", letterSpacing: 0.3 },
  dimValue: { fontSize: 13, color: "#1F2937", marginTop: 3, fontVariantNumeric: "tabular-nums" },

  fileRow: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "white", padding: "10px 12px", borderRadius: 6, border: "1px solid #E2E8F0" },
  fileName: { fontSize: 13, color: "#1F2937", fontWeight: 500 },
  fileMeta: { fontSize: 11, color: "#94A3B8", marginTop: 3 },
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

  // Modal
  modalBackdrop: { position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.5)", zIndex: 100, animation: "fadeIn 0.15s" },
  modal: { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", background: "white", borderRadius: 12, width: "90%", maxWidth: 640, maxHeight: "85vh", overflow: "hidden", display: "flex", flexDirection: "column", zIndex: 101, boxShadow: "0 25px 50px rgba(0,0,0,0.25)", animation: "scaleIn 0.2s ease-out" },
  modalHeader: { padding: "20px 24px", borderBottom: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  modalTitle: { fontSize: 18, fontWeight: 700, color: "#0F172A" },
  modalSubtitle: { fontSize: 12, color: "#64748B", marginTop: 4 },
  modalBody: { flex: 1, overflowY: "auto", padding: 24 },
  modalFooter: { padding: "16px 24px", borderTop: "1px solid #E2E8F0", display: "flex", justifyContent: "flex-end", gap: 8 },

  dropZone: { border: "2px dashed #CBD5E1", borderRadius: 12, padding: "48px 24px", textAlign: "center", background: "#F8FAFC", cursor: "pointer", transition: "all 0.2s" },
  dropIcon: { fontSize: 48, marginBottom: 12 },
  dropText: { fontSize: 14, color: "#475569", marginBottom: 16 },
  uploadLabel: { display: "inline-block", background: "#0F172A", color: "white", padding: "10px 24px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  dropHint: { fontSize: 11, color: "#94A3B8", marginTop: 16 },

  parsing: { textAlign: "center", padding: "32px 0" },
  spinner: { width: 40, height: 40, border: "3px solid #E2E8F0", borderTopColor: "#0F172A", borderRadius: "50%", margin: "0 auto", animation: "spin 0.8s linear infinite" },
  parsingText: { fontSize: 14, color: "#1F2937", fontWeight: 600, marginTop: 16 },
  parsingSub: { fontSize: 12, color: "#94A3B8", marginTop: 4 },
  parsingSteps: { marginTop: 24, fontSize: 12, color: "#64748B", textAlign: "left", maxWidth: 280, margin: "24px auto 0", lineHeight: 1.9 },

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
  previewStyle: { color: "#64748B", fontFamily: "'JetBrains Mono', 'Menlo', monospace", fontSize: 11 },
  previewQty: { textAlign: "right", color: "#0369A1", fontWeight: 600, fontVariantNumeric: "tabular-nums" },
  previewSkipped: { background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 6, padding: 10, fontSize: 11, color: "#9A3412", lineHeight: 1.6 },

  formField: { marginBottom: 16 },
  formLabel: { display: "block", fontSize: 12, color: "#475569", fontWeight: 600, marginBottom: 6 },
  formInput: { width: "100%", padding: "10px 12px", border: "1px solid #CBD5E1", borderRadius: 6, fontSize: 14, color: "#0F172A", boxSizing: "border-box", fontFamily: "inherit" },
  formStatic: { padding: "10px 12px", background: "#F1F5F9", borderRadius: 6, fontSize: 14, color: "#0F172A", fontWeight: 600 },
  remainHint: { color: "#94A3B8", fontWeight: 400, fontSize: 11 },

  // Analytics
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
@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes scaleIn { from { opacity: 0; transform: translate(-50%, -50%) scale(0.96); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
@keyframes spin { to { transform: rotate(360deg); } }
button:hover { opacity: 0.92; }
button:active { transform: scale(0.98); }
input:focus, textarea:focus { outline: none; border-color: #0F172A; box-shadow: 0 0 0 3px rgba(15, 23, 42, 0.08); }
`;
