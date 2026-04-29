import { useState, useEffect } from "react";

const CATEGORIES = ["상의", "하의", "아우터", "모자", "가방", "기타"];

const initialState = {
  name: "",
  category: "상의",
  reference_url: "",
  image_url: "",
  expected_price: "",
  expected_cost: "",
  material: "",
  color: "",
  memo: "",
  source: "manual",
};

export default function ReferenceItemForm({ onSubmit, onCancel, initialData = null }) {
  const [form, setForm] = useState(initialState);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (initialData) {
      setForm({
        ...initialState,
        ...initialData,
        expected_price: initialData.expected_price ?? "",
        expected_cost: initialData.expected_cost ?? "",
      });
    } else {
      setForm(initialState);
    }
  }, [initialData]);

  const handleChange = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      alert("상품명을 입력해주세요");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        ...form,
        expected_price: form.expected_price ? Number(form.expected_price) : null,
        expected_cost: form.expected_cost ? Number(form.expected_cost) : null,
      });
      setForm(initialState);
    } catch (err) {
      alert("저장 실패: " + (err?.message || err));
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle = {
    padding: "8px 12px", fontSize: "13px",
    border: "1px solid #ddd", borderRadius: "6px", outline: "none",
  };

  return (
    <form onSubmit={handleSubmit} style={{
      background: "#f9f9f9", borderRadius: "12px", padding: "20px", marginBottom: "24px",
    }}>
      <div style={{ marginBottom: "12px", fontSize: "13px", fontWeight: 500, color: "#666" }}>
        {initialData ? "레퍼런스 수정" : "새 레퍼런스 등록"}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "10px", marginBottom: "10px" }}>
        <input type="text" placeholder="상품명 (예: 오버사이즈 피그먼트 후디)"
          value={form.name} onChange={handleChange("name")} style={inputStyle} required />
        <select value={form.category} onChange={handleChange("category")} style={inputStyle}>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input type="text" placeholder="컬러 (멜란지, 블랙)"
          value={form.color} onChange={handleChange("color")} style={inputStyle} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
        <input type="url" placeholder="참고 URL (musinsa.com/...)"
          value={form.reference_url} onChange={handleChange("reference_url")} style={inputStyle} />
        <input type="url" placeholder="이미지 URL"
          value={form.image_url} onChange={handleChange("image_url")} style={inputStyle} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr", gap: "10px", marginBottom: "10px" }}>
        <input type="number" placeholder="예상 판매가"
          value={form.expected_price} onChange={handleChange("expected_price")} style={inputStyle} />
        <input type="number" placeholder="예상 원가"
          value={form.expected_cost} onChange={handleChange("expected_cost")} style={inputStyle} />
        <input type="text" placeholder="소재 (코튼 100%, 헤비웨이트)"
          value={form.material} onChange={handleChange("material")} style={inputStyle} />
      </div>

      <input type="text" placeholder="메모 — 추천 이유, 참고사항"
        value={form.memo} onChange={handleChange("memo")}
        style={{ ...inputStyle, width: "100%", marginBottom: "12px", boxSizing: "border-box" }} />

      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
        {onCancel && (
          <button type="button" onClick={onCancel} style={{
            padding: "8px 16px", fontSize: "13px", background: "#fff",
            color: "#333", border: "1px solid #ddd", borderRadius: "6px", cursor: "pointer",
          }}>취소</button>
        )}
        <button type="submit" disabled={submitting} style={{
          padding: "8px 16px", fontSize: "13px", background: "#000",
          color: "#fff", border: "none", borderRadius: "6px",
          cursor: "pointer", fontWeight: 500,
        }}>
          {submitting ? "저장 중..." : (initialData ? "수정" : "등록")}
        </button>
      </div>
    </form>
  );
}
