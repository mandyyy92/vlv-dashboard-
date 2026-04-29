import { useState, useEffect, useCallback } from "react";
import { sb } from "../lib/supabaseClient";

// Supabase JS SDK 가 설치되어 있지 않아 realtime 채널은 사용하지 않고
// 각 mutation 후 setItems 로 낙관적 업데이트만 적용합니다.
// 다른 클라이언트가 동시에 수정해도 다음 마운트 시 fetchItems 가 동기화합니다.
export function useReferenceItems() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const data = await sb.get("reference_items");
      setItems(data || []);
      setError(null);
    } catch (e) {
      setError(e);
      console.error("Reference items fetch error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const addItem = async (item) => {
    const r = await sb.insert("reference_items", item);
    if (!r || !r[0]) throw new Error("insert failed");
    const inserted = r[0];
    setItems(prev => [inserted, ...prev]);
    return inserted;
  };

  const updateItem = async (id, updates) => {
    const r = await sb.update("reference_items", id, updates);
    if (!r || !r[0]) throw new Error("update failed");
    const updated = r[0];
    setItems(prev => prev.map(i => i.id === id ? updated : i));
    return updated;
  };

  const deleteItem = async (id) => {
    const ok = await sb.remove("reference_items", id);
    if (!ok) throw new Error("delete failed");
    setItems(prev => prev.filter(i => i.id !== id));
  };

  return { items, loading, error, addItem, updateItem, deleteItem, refetch: fetchItems };
}
