"""
VLVD 트렌드 분석기 - Claude Sonnet 으로 상품 속성 자동 추출
- 아직 분석되지 않은 trend_products 를 가져와서
- 상품명 + 이미지 + 브랜드 + raw_category 를 Claude 에 보내고
- 카테고리/핏/컬러/소재/디테일 JSON 으로 받아 trend_analysis 에 저장

크롤러 직후 GitHub Actions 에서 이어서 실행.
하루치 batch 라서 비용 컨트롤 가능.
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
log = logging.getLogger("vlvd-analyzer")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]

sb: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
claude = Anthropic(api_key=ANTHROPIC_API_KEY)

MODEL = "claude-sonnet-4-5"
BATCH_LIMIT = 200   # 1회 실행에 분석할 최대 상품 수 (비용 안전장치)

# ---------------------------------------------------------------
# VLVD 내부 카테고리 체계 - 분석 가이드로 프롬프트에 주입
# ---------------------------------------------------------------
VLVD_CATEGORY_GUIDE = """
VLVD 내부 카테고리 체계:
- 상의: 반팔티, 긴팔티, 맨투맨, 후드, 후드집업, 셔츠, 니트, 카디건, 베스트
- 아우터: 자켓, 코트, 패딩, 점퍼, 블레이저, 야상
- 하의: 데님, 슬랙스, 트레이닝, 숏팬츠, 버뮤다, 스커트
- 원피스: 미니, 미디, 맥시
- 액세서리: 가방, 모자, 양말, 벨트

핏 분류: 오버핏 / 와이드 / 레귤러 / 슬림 / 크롭 / 롱
시즌: SS (봄여름) / FW (가을겨울) / ALL (사계절)
젠더: M (남성) / W (여성) / U (유니섹스)
"""

ANALYSIS_PROMPT = """당신은 한국 캐주얼 패션 브랜드의 MD 입니다. 아래 상품 정보를 보고 VLVD 내부 분류 체계로 속성을 추출해주세요.

{guide}

상품 정보:
- 브랜드: {brand}
- 상품명: {name}
- 무신사 분류: {raw_category}

반드시 아래 JSON 형식으로만 응답하세요. 다른 설명 금지.
{{
  "vlvd_category": "상의|아우터|하의|원피스|액세서리 중 하나",
  "sub_category": "후드집업, 와이드데님 등 구체적 품목",
  "fit": "오버핏|와이드|레귤러|슬림|크롭|롱 중 하나 또는 null",
  "silhouette": "A라인|H라인|박시 등 또는 null",
  "primary_color": "기본 색상 한국어",
  "color_palette": ["보조 색상 배열"],
  "material": "주 소재 (피그먼트, 코듀로이, 데님, 면, 울 등)",
  "detail_tags": ["워싱", "자수", "패치워크" 등 디테일 키워드 배열],
  "season": "SS|FW|ALL",
  "gender": "M|W|U",
  "confidence": 0.0-1.0 사이 값
}}
"""


def fetch_unanalyzed(limit: int) -> list[dict]:
    """ trend_analysis 에 아직 없는 상품 조회 """
    # Supabase 에는 EXCEPT 가 없어서 LEFT JOIN 패턴: rpc 또는 view 활용
    # 여기서는 간단히 두 번 쿼리해서 클라이언트에서 차집합
    analyzed = sb.table("trend_analysis").select("product_id").execute()
    analyzed_ids = {row["product_id"] for row in analyzed.data}

    products = sb.table("trend_products").select(
        "id, brand, product_name, raw_category, image_url"
    ).limit(limit + len(analyzed_ids)).execute()

    pending = [p for p in products.data if p["id"] not in analyzed_ids][:limit]
    log.info("pending analysis: %d items", len(pending))
    return pending


def fetch_image_b64(url: Optional[str]) -> Optional[tuple[str, str]]:
    """ 이미지 다운로드 후 base64. (media_type, data) 반환 """
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


def analyze_one(product: dict) -> Optional[dict]:
    prompt = ANALYSIS_PROMPT.format(
        guide=VLVD_CATEGORY_GUIDE,
        brand=product.get("brand") or "?",
        name=product.get("product_name") or "",
        raw_category=product.get("raw_category") or "?",
    )

    content = [{"type": "text", "text": prompt}]

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
            max_tokens=600,
            messages=[{"role": "user", "content": content}],
        )
        text = resp.content[0].text.strip()
        # ```json ... ``` 펜스 제거
        text = text.replace("```json", "").replace("```", "").strip()
        return json.loads(text)
    except Exception as e:
        log.warning("analysis failed for product %s: %s", product["id"], e)
        return None


def save_analysis(product_id: int, result: dict):
    row = {
        "product_id": product_id,
        "vlvd_category": result.get("vlvd_category"),
        "sub_category": result.get("sub_category"),
        "fit": result.get("fit"),
        "silhouette": result.get("silhouette"),
        "primary_color": result.get("primary_color"),
        "color_palette": result.get("color_palette") or [],
        "material": result.get("material"),
        "detail_tags": result.get("detail_tags") or [],
        "season": result.get("season"),
        "gender": result.get("gender"),
        "confidence": result.get("confidence"),
        "model_used": MODEL,
    }
    sb.table("trend_analysis").upsert(row, on_conflict="product_id").execute()


def main():
    log.info("=== VLVD analyzer start ===")
    pending = fetch_unanalyzed(BATCH_LIMIT)

    ok = 0
    for p in pending:
        result = analyze_one(p)
        if result:
            save_analysis(p["id"], result)
            ok += 1
            log.info("  [%d/%d] %s → %s / %s / %s",
                     ok, len(pending),
                     (p.get("product_name") or "")[:30],
                     result.get("sub_category"),
                     result.get("fit"),
                     result.get("primary_color"))

    log.info("=== done. analyzed %d / %d ===", ok, len(pending))


if __name__ == "__main__":
    main()
