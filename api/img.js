// Vercel Serverless — 상품 이미지 프록시 (발주서 작성 엑셀에 이미지 첨부용)
// cafe24 / 이지어드민 이미지 서버는 CORS 헤더가 없어 브라우저에서 직접 읽을 수 없다.
// 허용한 이미지 호스트만 중계한다(열린 프록시 방지).
const ALLOWED = [/(^|\.)cafe24img\.com$/, /(^|\.)cafe24\.com$/, /(^|\.)ezadmin\.co\.kr$/];

export default async function handler(req, res) {
  const raw = String(req.query.u || '');
  let url;
  try {
    url = new URL(raw);
  } catch (e) {
    res.status(400).send('bad url');
    return;
  }
  if (!/^https?:$/.test(url.protocol) || !ALLOWED.some((re) => re.test(url.hostname))) {
    res.status(403).send('host not allowed');
    return;
  }
  try {
    const r = await fetch(url.toString());
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !type.startsWith('image/')) {
      res.status(502).send('upstream error');
      return;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.status(200).send(buf);
  } catch (e) {
    res.status(502).send('fetch failed');
  }
}
