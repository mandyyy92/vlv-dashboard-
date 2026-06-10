const NOTION_TOKEN = Deno.env.get("NOTION_TOKEN")!;
const DB_ID = "25bc081d-6cc9-80b1-a1b0-d324f10ebc00";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const events:any[] = [];
    let cursor: string | undefined;
    do {
      const r = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 }),
      });
      const data = await r.json();
      if (!r.ok) return new Response(JSON.stringify({ error: data }), { status: r.status, headers: { ...cors, "Content-Type": "application/json" } });
      for (const p of data.results ?? []) {
        const pr = p.properties ?? {};
        const date = pr["입고일(예정)"]?.date?.start;
        if (!date) continue;
        events.push({
          source: "notion",
          id: p.id,
          date,
          orderDate: pr["발주일"]?.date?.start ?? null,
          title: (pr["제품명"]?.title ?? []).map((t:any)=>t.plain_text).join(""),
          round: (pr["발주차수"]?.multi_select ?? []).map((o:any)=>o.name).join(","),
          qty: pr["발주수량"]?.number ?? null,
          received: pr["실입고수량"]?.number ?? null,
          vendor: pr["생산공장"]?.select?.name ?? "",
          status: pr["진행상태"]?.status?.name ?? "",
          code: (pr["상품코드"]?.rich_text ?? []).map((t:any)=>t.plain_text).join(""),
        });
      }
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);
    return new Response(JSON.stringify(events), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
