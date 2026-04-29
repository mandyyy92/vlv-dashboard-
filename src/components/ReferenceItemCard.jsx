const CATEGORY_COLORS = {
  "상의":   { bg: "#EEEDFE", fg: "#3C3489" },
  "하의":   { bg: "#E1F5EE", fg: "#085041" },
  "아우터": { bg: "#FAECE7", fg: "#712B13" },
  "모자":   { bg: "#FBEAF0", fg: "#72243E" },
  "가방":   { bg: "#FAEEDA", fg: "#633806" },
  "기타":   { bg: "#F1EFE8", fg: "#444441" },
};

export default function ReferenceItemCard({ item, onEdit, onDelete }) {
  const cat = CATEGORY_COLORS[item.category] || CATEGORY_COLORS["기타"];
  const margin = (item.expected_price ?? 0) - (item.expected_cost ?? 0);
  const hasMargin = item.expected_price && item.expected_cost;

  const cardBtn = {
    flex: 1, padding: "6px", fontSize: "11px",
    background: "#f5f5f5", border: "none",
    borderRadius: "6px", cursor: "pointer",
  };

  return (
    <div style={{
      background: "#fff", border: "1px solid #eee",
      borderRadius: "12px", overflow: "hidden",
    }}>
      <div style={{ aspectRatio: "1", background: "#f5f5f5", position: "relative" }}>
        {item.image_url ? (
          <img src={item.image_url} alt={item.name}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            onError={(e) => { e.target.style.display = "none"; }} />
        ) : (
          <div style={{
            width: "100%", height: "100%", display: "flex",
            alignItems: "center", justifyContent: "center",
            color: "#bbb", fontSize: "12px"
          }}>이미지 없음</div>
        )}
        {item.source === "musinsa_trend" && (
          <span style={{
            position: "absolute", top: "8px", left: "8px",
            background: "rgba(0,0,0,0.7)", color: "#fff",
            padding: "2px 8px", borderRadius: "999px", fontSize: "10px",
          }}>무신사 트렌드</span>
        )}
      </div>

      <div style={{ padding: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
          <span style={{
            fontSize: "11px", padding: "2px 8px", borderRadius: "999px",
            background: cat.bg, color: cat.fg,
          }}>{item.category}</span>
          {item.color && <span style={{ fontSize: "11px", color: "#999" }}>{item.color}</span>}
        </div>

        <p style={{ margin: "0 0 6px", fontSize: "14px", fontWeight: 500 }}>{item.name}</p>

        {item.material && (
          <p style={{ margin: "0 0 8px", fontSize: "12px", color: "#666" }}>{item.material}</p>
        )}

        {hasMargin && (
          <div style={{
            display: "flex", justifyContent: "space-between",
            fontSize: "12px", padding: "8px 0", borderTop: "1px solid #f0f0f0",
          }}>
            <span style={{ color: "#666" }}>판매가 {item.expected_price.toLocaleString()}</span>
            <span style={{ color: "#0F6E56", fontWeight: 500 }}>
              마진 {margin.toLocaleString()}
            </span>
          </div>
        )}

        {item.memo && (
          <p style={{
            margin: "8px 0 0", fontSize: "11px", color: "#888",
            paddingTop: "8px", borderTop: "1px solid #f0f0f0",
          }}>{item.memo}</p>
        )}

        <div style={{ display: "flex", gap: "6px", marginTop: "10px" }}>
          {item.reference_url && (
            <a href={item.reference_url} target="_blank" rel="noopener noreferrer"
              style={{
                flex: 1, padding: "6px", textAlign: "center",
                fontSize: "11px", background: "#f5f5f5",
                borderRadius: "6px", textDecoration: "none", color: "#333",
              }}>링크</a>
          )}
          <button onClick={() => onEdit(item)} style={cardBtn}>수정</button>
          <button onClick={() => {
            if (window.confirm(`'${item.name}' 삭제하시겠습니까?`)) onDelete(item.id);
          }} style={{ ...cardBtn, color: "#c00" }}>삭제</button>
        </div>
      </div>
    </div>
  );
}
