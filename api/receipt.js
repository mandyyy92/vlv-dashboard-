// Vercel Serverless — 나염 업체 작업내역 이미지(PNG/JPG)에서 입고 수량·불량 읽기 (프린팅 외주 › 발주서 작성 › 4) 베이스 재고 추가 조정)
// 브라우저가 '업체전달' 이미지(축소 JPEG)를 보내면 Claude 가 표를 읽어 상품코드별 실제 입고 수량·불량을 JSON 으로 돌려준다.
// 결과는 화면의 비교표에서 사람이 확인한다.
// 환경변수: ANTHROPIC_API_KEY (Vercel 프로젝트 설정에서 등록 — 코드·저장소에는 넣지 않는다)
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

const Result = z.object({
  items: z.array(z.object({
    code: z.string(),   // 이미지에 적힌 상품코드 그대로 (예: S32532)
    name: z.string(),   // 상품명
    option: z.string(), // 옵션 (예: [네이비-M])
    qty: z.number(),    // 실제로 센터에 보낸(입고) 수량
    bad: z.number(),    // 불량 수량 (없으면 0)
  })),
  unreadable: z.boolean(), // 작업내역 표가 아니거나 읽을 수 없으면 true
});

const PROMPT = `다음 이미지는 나염(프린팅) 외주 업체가 보낸 작업내역입니다(엑셀 캡처, 카카오톡 캡처, 박스 라벨 등).
표의 각 줄(상품코드·상품명·옵션)마다 실제로 작업해서 센터로 보낸 수량과 불량 수량을 읽어 주세요.

- code: 이미지에 적힌 상품코드를 그대로 (영문 1자 + 숫자, 예: S32532). 상품코드가 없는 줄은 넣지 마세요
- name / option: 그 줄의 상품명·옵션. 병합 칸이면 위의 상품명을 씁니다
- qty: 실제로 보낸 수량. '작업수량' 열이 있으면 작업수량, 없으면 '조정', 그것도 없으면 '입고'·'수량'.
  의뢰수량은 쓰지 마세요. 합계 줄·박스수·단가·금액 표는 넣지 마세요
- bad: 불량, 원단불량, 인쇄불량, 오염, 파손 등으로 적힌 수량 (부족·미작업·잔량은 불량이 아닙니다). 없으면 0
- 같은 상품코드가 여러 장에 나오면 한 번만 (같은 표를 다시 찍은 것이면 중복으로 더하지 마세요)
- 작업내역 표가 아니거나 글자를 읽을 수 없으면 unreadable 을 true 로`;

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  if (!process.env.ANTHROPIC_API_KEY) { res.status(500).json({ error: 'ANTHROPIC_API_KEY 미설정 — Vercel 환경변수에 등록해주세요' }); return; }
  const { images } = req.body || {};
  const imgs = (Array.isArray(images) ? images : []).filter((x) => x && /^image\/(png|jpeg|webp|gif)$/.test(x.media_type) && typeof x.data === 'string').slice(0, 8);
  if (!imgs.length) { res.status(400).json({ error: '이미지가 필요합니다' }); return; }

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
          { type: 'text', text: PROMPT },
        ],
      }],
    });
    if (response.stop_reason === 'refusal') { res.status(422).json({ error: '이미지를 읽지 못했습니다 — 엑셀 파일로 올려주세요' }); return; }
    const out = response.parsed_output;
    if (!out) { res.status(502).json({ error: '결과를 해석하지 못했습니다 — 다시 시도해주세요' }); return; }
    const seen = new Map();
    out.items.forEach((x) => {
      const code = String(x.code || '').trim().toUpperCase();
      if (!/^[A-Z]\d{3,}$/.test(code) || seen.has(code)) return;
      seen.set(code, {
        code, name: String(x.name || '').slice(0, 80), option: String(x.option || '').slice(0, 40),
        qty: Math.max(0, Math.round(Number(x.qty) || 0)), bad: Math.max(0, Math.round(Number(x.bad) || 0)),
      });
    });
    res.status(200).json({ items: [...seen.values()], unreadable: !!out.unreadable });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) res.status(500).json({ error: 'API 키가 올바르지 않습니다 — Vercel 환경변수를 확인해주세요' });
    else if (e instanceof Anthropic.RateLimitError) res.status(429).json({ error: '요청이 많습니다 — 잠시 후 다시 시도해주세요' });
    else if (e instanceof Anthropic.APIError) res.status(502).json({ error: `이미지 읽기 실패 (${e.status})` });
    else res.status(502).json({ error: '이미지 읽기 실패' });
  }
}
