// Vercel Serverless — 나염 업체 보고 이미지(PNG)에서 불량 수량 읽기 (프린팅 외주 › 베이스 추가 출고)
// 브라우저가 차수 폴더의 '업체전달' 이미지(축소 JPEG)와 그 차수 정상입고 상품 목록을 보내면
// Claude 가 이미지를 읽어 상품코드별 불량 수량을 JSON 으로 돌려준다. 결과는 화면에서 사람이 확인·수정한다.
// 환경변수: ANTHROPIC_API_KEY (Vercel 프로젝트 설정에서 등록 — 코드·저장소에는 넣지 않는다)
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

const Result = z.object({
  items: z.array(z.object({
    code: z.string(),   // 목록의 상품코드(입고 상품) 그대로
    bad: z.number(),    // 불량 수량(장)
    note: z.string(),   // 이미지에 적힌 근거 문구(예: "인쇄불량 1(번짐)")
  })),
  unreadable: z.boolean(), // 이미지가 불량 보고가 아니거나 읽을 수 없으면 true
});

const PROMPT = `다음 이미지는 나염(프린팅) 외주 업체가 보낸 작업 결과 보고입니다(카카오톡 캡처, 엑셀 캡처, 박스 사진 등).
아래 "상품 목록"은 이 차수에 센터로 입고된 상품입니다(상품코드 | 상품명 | 옵션).

이미지에서 '불량'으로 보고된 수량만 찾아 상품 목록의 상품코드에 연결해 주세요.
- 불량으로 셉니다: 불량, 원단불량, 인쇄불량, 나염불량, 번짐, 오염, 찢어짐, 파손 등 상품이 못 쓰게 된 것
- 불량이 아닙니다: 부족, 미작업, 남은 수량, 잔량, 박스 수량, 작업 수량, 다른 사이즈가 섞임 — 이런 것은 넣지 마세요
- 상품명·컬러·사이즈로 목록에서 가장 맞는 상품코드 하나를 고르세요. 목록에 없는 상품이면 넣지 마세요
- 같은 상품에 불량이 여러 번 적혀 있으면 합쳐서 하나로
- note 에는 이미지에 적힌 근거 문구를 짧게 그대로 옮겨 주세요
- 불량이 하나도 없으면 items 는 빈 배열
- 이미지가 불량 보고가 아니거나 글자를 읽을 수 없으면 unreadable 을 true 로`;

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  if (!process.env.ANTHROPIC_API_KEY) { res.status(500).json({ error: 'ANTHROPIC_API_KEY 미설정 — Vercel 환경변수에 등록해주세요' }); return; }
  const { images, products } = req.body || {};
  const imgs = (Array.isArray(images) ? images : []).filter((x) => x && /^image\/(png|jpeg|webp|gif)$/.test(x.media_type) && typeof x.data === 'string').slice(0, 8);
  const prods = (Array.isArray(products) ? products : []).slice(0, 500);
  if (!imgs.length || !prods.length) { res.status(400).json({ error: '이미지와 상품 목록이 필요합니다' }); return; }

  const list = prods.map((p) => `${String(p.code || '')} | ${String(p.name || '')} | ${String(p.option || '')}`).join('\n');
  const client = new Anthropic();
  try {
    const response = await client.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      output_config: { effort: 'medium', format: zodOutputFormat(Result) },
      messages: [{
        role: 'user',
        content: [
          ...imgs.map((x) => ({ type: 'image', source: { type: 'base64', media_type: x.media_type, data: x.data } })),
          { type: 'text', text: `${PROMPT}\n\n상품 목록:\n${list}` },
        ],
      }],
    });
    if (response.stop_reason === 'refusal') { res.status(422).json({ error: '이미지를 읽지 못했습니다 — 직접 입력해주세요' }); return; }
    const out = response.parsed_output;
    if (!out) { res.status(502).json({ error: '결과를 해석하지 못했습니다 — 다시 시도해주세요' }); return; }
    const known = new Set(prods.map((p) => String(p.code || '').toUpperCase()));
    const items = out.items
      .map((x) => ({ code: String(x.code).trim().toUpperCase(), bad: Math.max(0, Math.round(Number(x.bad) || 0)), note: String(x.note || '').slice(0, 80) }))
      .filter((x) => x.bad > 0 && known.has(x.code));
    res.status(200).json({ items, unreadable: !!out.unreadable });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) res.status(500).json({ error: 'API 키가 올바르지 않습니다 — Vercel 환경변수를 확인해주세요' });
    else if (e instanceof Anthropic.RateLimitError) res.status(429).json({ error: '요청이 많습니다 — 잠시 후 다시 시도해주세요' });
    else if (e instanceof Anthropic.APIError) res.status(502).json({ error: `이미지 읽기 실패 (${e.status})` });
    else res.status(502).json({ error: '이미지 읽기 실패' });
  }
}
