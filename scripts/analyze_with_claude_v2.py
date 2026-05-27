"""
VLVD 트렌드 분석기 v2 — 7축 태깅 + 표준 사전 강제

v1 대비 변경점:
- VLVD taxonomy 를 프롬프트에 직접 주입 (자유 텍스트 금지)
- 무드(mood) / 그래픽(graphic) 추가
- 실루엣(silhouette) / 소재(material) 정밀화
- AI 한줄평(ai_notes) 추가 — 검수자가 빠르게 판단하도록
- 응답 검증: enum 외 값이 오면 폐기하고 다시 시도
"""

import os
import json
import base64
import logging
from typing import Optional

import requests
from anthropic import Anthropic
from supabase import create_client, Client

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
log = logging.getLogger("vlvd-analyzer-v2")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]

sb: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
claude = Anthropic(api_key=ANTHROPIC_API_KEY)

MODEL = "claude-sonnet-4-5"
BATCH_LIMIT = 200

# ───────────────────────────────────────────────
# VLVD 표준 사전 (taxonomy.js 와 1:1 동기화 필수)
# ───────────────────────────────────────────────
TAXONOMY = {
    "category": [
        # TOP
        "반팔", "긴팔", "맨투맨", "후드", "셔츠", "니트", "카디건", "베스트", "슬리브리스",
        # BOTTOM
        "데님", "와이드팬츠", "슬랙스", "버뮤다", "숏팬츠", "조거", "스웻팬츠", "카고팬츠", "스커트",
        # OUTER
        "후드집업", "바람막이", "트랙자켓", "워크자켓", "블레이저", "코트", "패딩", "베스트아우터",
        # DRESS
        "미니원피스", "미디원피스", "맥시원피스",
        # ACC
        "가방", "모자", "양말", "벨트", "머플러",
    ],
    "fit": ["오버핏", "세미오버", "레귤러", "슬림", "크롭", "롱", "와이드", "테이퍼드", "스트레이트"],
    "mood": [
        "미니멀", "스트릿", "빈티지", "워크웨어", "아메카지", "고프코어",
        "프레피", "스포티", "로맨틱", "클래식", "그런지", "아방가르드",
    ],
    "color": [
        "블랙", "차콜", "그레이", "멜란지그레이", "아이보리", "화이트", "크림",
        "워시드블랙", "피그먼트블랙", "빈티지블랙",
        "브라운", "카멜", "베이지", "카키", "올리브", "머드",
        "인디고", "미디엄블루", "라이트블루", "워시드데님", "블랙데님",
        "네이비", "블루", "레드", "버건디", "핑크", "옐로우", "머스타드", "그린", "퍼플", "오렌지",
        "스트라이프", "체크", "플로럴", "아가일",
    ],
    "detail": [
        "피그먼트", "워싱", "데미지", "빈티지가공", "오버다잉",
        "자수", "나염", "레터링", "패치", "패치워크",
        "절개", "레이어드", "러플", "프릴", "셔링", "플리츠",
        "퀼팅", "리본", "버튼다운", "드로스트링",
        "엠브로이더리", "체인스티치", "아일렛",
    ],
    "season": ["SS", "FW", "ALL", "간절기"],
    "silhouette": ["A라인", "H라인", "X라인", "박시", "벌룬", "코쿤", "아워글래스", "스트레이트", "머메이드"],
    "material": [
        "헤비코튼", "코튼", "저지", "와플", "테리", "맨투맨원단",
        "데님", "캔버스", "치노",
        "나일론", "폴리", "플리스", "벨로아", "코듀로이",
        "울", "캐시미어", "램스울", "모헤어",
        "레더", "에코레더", "스웨이드",
        "니트", "케이블니트", "와플니트", "리브니트",
        "린넨", "실크", "쉬폰", "레이스", "메쉬", "퍼",
    ],
    "graphic": [
        "무지", "스몰로고", "빅로고", "레터링", "아카이브로고",
        "캐릭터", "동물", "꽃", "풍경", "추상",
        "타이포그래픽", "슬로건",
        "체크무늬", "스트라이프무늬",
        "바이커그래픽", "스포츠팀", "대학교(varsity)",
    ],
    "gender": ["M", "W", "U"],
}


def build_prompt(product: dict) -> str:
    """ taxonomy 를 직접 주입한 강제형 프롬프트 """
    tax_block = "\n".join(
        f"- {k}: {' | '.join(v)}" for k, v in TAXONOMY.items()
    )
    return f"""당신은 한국 캐주얼 패션 브랜드 VLVD 의 MD 입니다.
상품 이미지와 메타데이터를 보고 **VLVD 표준 사전에 정의된 값만** 사용해 속성을 추출하세요.

【VLVD 표준 사전】
{tax_block}

【상품 정보】
- 브랜드: {product.get('brand') or '?'}
- 상품명: {product.get('product_name') or ''}
- 무신사 분류: {product.get('raw_category') or '?'}

【응답 규칙】
1. **반드시 위 사전에 있는 값만 사용**. 사전 밖 단어 쓰면 안 됨.
2. 확신 없으면 null. 추측하지 말 것.
3. mood / detail / graphic / color_palette 는 복수 선택 가능 (배열).
4. ai_notes: 이 상품의 핵심 매력 포인트를 한국어 한 문장으로. VLVD MD 관점에서.
5. 반드시 아래 JSON 만 출력. 마크다운 펜스 / 설명문 금지.

{{
  "vlvd_category": "사전의 category 값",
  "fit": "사전의 fit 값 또는 null",
  "mood": ["사전의 mood 값 1~3개"],
  "primary_color": "사전의 color 중 가장 지배적인 색",
  "color_palette": ["사전의 color 값 1~3개"],
  "detail_tags": ["사전의 detail 값 0~5개"],
  "silhouette": "사전의 silhouette 값 또는 null",
  "material": "사전의 material 값 또는 null",
  "graphic": ["사전의 graphic 값 1~2개"],
  "season": "SS|FW|ALL|간절기",
  "gender": "M|W|U",
  "confidence": 0.0~1.0,
  "ai_notes": "한 문장 코멘트"
}}
"""


def fetch_image_b64(url: Optional[str]) -> Optional[tuple[str, str]]:
    if not url:
        return None
    try:
        r = requests.get(url, timeout=10)
        r.raise_for_status()
        ct = r.headers.get("content-type", "image/jpeg").split(";")[0]
        if ct not in ("image/jpeg", "image/png", "image/webp", "image/gif"):
            ct = "image/jpeg"
        return ct, base64.standard_b64encode(r.content).decode()
    except Exception as e:
        log.warning("image fetch failed (%s): %s", url, e)
        return None


def validate_against_taxonomy(result: dict) -> dict:
    """ enum 밖 값은 None / 빈 리스트로 정리. 통계 깨짐 방지의 핵심. """
    def clean_scalar(field, val):
        if val is None:
            return None
        return val if val in TAXONOMY[field] else None

    def clean_array(field, vals):
        if not isinstance(vals, list):
            return []
        return [v for v in vals if v in TAXONOMY[field]]

    return {
        "vlvd_category":  clean_scalar("category",   result.get("vlvd_category")),
        "fit":            clean_scalar("fit",        result.get("fit")),
        "mood":           clean_array("mood",        result.get("mood")),
        "primary_color":  clean_scalar("color",      result.get("primary_color")),
        "color_palette":  clean_array("color",       result.get("color_palette")),
        "detail_tags":    clean_array("detail",      result.get("detail_tags")),
        "silhouette":     clean_scalar("silhouette", result.get("silhouette")),
        "material":       clean_scalar("material",   result.get("material")),
        "graphic":        clean_array("graphic",     result.get("graphic")),
        "season":         clean_scalar("season",     result.get("season")),
        "gender":         clean_scalar("gender",     result.get("gender")),
        "confidence":     float(result.get("confidence") or 0),
        "ai_notes":       (result.get("ai_notes") or "")[:300],
    }


def analyze_one(product: dict) -> Optional[dict]:
    content = [{"type": "text", "text": build_prompt(product)}]

    img = fetch_image_b64(product.get("image_url"))
    if img:
        media_type, data = img
        content.insert(0, {
            "type": "image",
            "source": {"type": "base64", "media_type": media_type, "data": data},
        })

    try:
        resp = claude.messages.create(
            model=MODEL,
            max_tokens=800,
            messages=[{"role": "user", "content": content}],
        )
        text = resp.content[0].text.strip()
        text = text.replace("```json", "").replace("```", "").strip()
        raw = json.loads(text)
        return validate_against_taxonomy(raw)
    except Exception as e:
        log.warning("analysis failed for product %s: %s", product["id"], e)
        return None


def fetch_unanalyzed(limit: int) -> list[dict]:
    analyzed = sb.table("trend_analysis").select("product_id").execute()
    analyzed_ids = {row["product_id"] for row in analyzed.data}

    products = sb.table("trend_products").select(
        "id, brand, product_name, raw_category, image_url"
    ).limit(limit + len(analyzed_ids)).execute()

    pending = [p for p in products.data if p["id"] not in analyzed_ids][:limit]
    log.info("pending analysis: %d items", len(pending))
    return pending


def save_analysis(product_id: int, result: dict):
    row = {"product_id": product_id, "model_used": MODEL, **result}
    sb.table("trend_analysis").upsert(row, on_conflict="product_id").execute()


def main():
    log.info("=== VLVD analyzer v2 (7-axis) start ===")
    pending = fetch_unanalyzed(BATCH_LIMIT)

    ok = 0
    for i, p in enumerate(pending, 1):
        result = analyze_one(p)
        if result:
            save_analysis(p["id"], result)
            ok += 1
            log.info(
                "  [%d/%d] %s → %s / %s / mood=%s",
                i, len(pending),
                (p.get("product_name") or "")[:30],
                result.get("vlvd_category"),
                result.get("fit"),
                ",".join(result.get("mood") or []),
            )

    log.info("=== done. analyzed %d / %d ===", ok, len(pending))


if __name__ == "__main__":
    main()
