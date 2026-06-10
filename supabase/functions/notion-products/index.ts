const NOTION_TOKEN = Deno.env.get("NOTION_TOKEN")!;
const DB_ID = "a09bd8b2711948388a6c02094a48f43d";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const txt = (rt:any[]) => (rt ?? []).map((t:any)=>t.plain_text).join("");
const ms = (arr:any[]) => (arr ?? []).map((o:any)=>o.name);
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const products:any[] = [];
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
        const img = pr["대표이미지"]?.files?.[0];
        products.push({
          id: p.id,
          name: txt(pr["제품명"]?.title),
          adminName: txt(pr["어드민상품명"]?.rich_text),
          barcode: txt(pr["대표바코드"]?.rich_text),
          image: img?.file?.url ?? img?.external?.url ?? null,
          category: ms(pr["카테고리"]?.multi_select),
          color: ms(pr["컬러"]?.multi_select),
          size: ms(pr["사이즈"]?.multi_select),
          target: pr["대상"]?.select?.name ?? "",
          season: ms(pr["시즌"]?.multi_select),
          year: ms(pr["판매년도"]?.multi_select),
          factory: ms(pr["생산처"]?.multi_select),
          origin: ms(pr["원산지"]?.multi_select),
          status: pr["진행상태"]?.status?.name ?? "",
          cost: pr["생산원가"]?.number ?? null,
          price: pr["판매가"]?.number ?? null,
          inboundQty: pr["입고수량"]?.number ?? null,
          inboundDate: pr["입고일"]?.date?.start ?? null,
          shopRegDate: pr["자사몰등록일"]?.date?.start ?? null,
          sampleLink: pr["샘플링크"]?.url ?? null,
        });
      }
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);
    return new Response(JSON.stringify(products), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
