"""
VLVD 트렌드 수집기 - 무신사 랭킹 크롤러
- 카테고리별 TOP N 상품의 메타데이터와 하트수를 수집
- Supabase 에 upsert
- GitHub Actions 에서 매일 1회 실행

운영 원칙:
- 무신사 서버 부담 최소화: 카테고리당 요청 사이 1.5초 sleep
- 실패 시 재시도 3회 (exponential backoff)
- 한 번 실행에 ~5분 이내 완료 목표
"""

import os
import re
import time
import json
import logging
from datetime import date
from typing import Optional

import requests
from bs4 import BeautifulSoup
from supabase import create_client, Client

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)
log = logging.getLogger("vlvd-crawler")

# ---------------------------------------------------------------
# Config
# ---------------------------------------------------------------
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

# 무신사 카테고리 코드 (대표 카테고리만 - 필요 시 추가)
# 실제 운영 전에 무신사 페이지 가서 코드 확인 후 조정 필요
CATEGORIES = {
    "001": "상의",
    "002": "아우터",
    "003": "바지",
    "022": "원피스/스커트",
    "020": "신발",
    "018": "가방",
}

TOP_N_PER_CATEGORY = 100
SLEEP_SEC = 1.5
TIMEOUT = 15
HEADERS = {
    "User-Agent": "VLVD-Trend-Bot/1.0 (production planning research; contact: park@vlvd.kr)",
    "Accept-Language": "ko-KR,ko;q=0.9",
}

# ---------------------------------------------------------------
# Supabase
# ---------------------------------------------------------------
sb: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


# ---------------------------------------------------------------
# Crawler
# ---------------------------------------------------------------
def fetch_ranking(category_code: str) -> list[dict]:
    """
    무신사 카테고리 랭킹 페이지 파싱.
    실제 셀렉터는 무신사 페이지 구조 보면서 조정해야 함.
    여기서는 일반적인 패턴으로 작성.
    """
    url = f"https://www.musinsa.com/ranking/best?period=now&age=ALL&mainCategory={category_code}"
    log.info("fetching %s (%s)", url, CATEGORIES.get(category_code))

    for attempt in range(3):
        try:
            r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
            r.raise_for_status()
            break
        except Exception as e:
            wait = 2 ** attempt
            log.warning("attempt %d failed: %s, retry in %ds", attempt + 1, e, wait)
            time.sleep(wait)
    else:
        log.error("all retries failed for %s", url)
        return []

    soup = BeautifulSoup(r.text, "html.parser")
    items = []

    # 무신사 랭킹 그리드 카드 셀렉터 (페이지 구조 확인 후 조정 필요)
    cards = soup.select("[data-goods-no]")[:TOP_N_PER_CATEGORY]

    for idx, card in enumerate(cards, start=1):
        try:
            goods_no = card.get("data-goods-no")
            brand_el = card.select_one(".brand, [class*='brand']")
            name_el = card.select_one(".product-name, [class*='goodsName'], [class*='ProductName']")
            price_el = card.select_one(".price, [class*='price']")
            like_el = card.select_one("[class*='like'], [class*='heart']")
            img_el = card.select_one("img")

            items.append({
                "external_id": goods_no,
                "product_url": f"https://www.musinsa.com/app/goods/{goods_no}",
                "brand": brand_el.get_text(strip=True) if brand_el else None,
                "product_name": name_el.get_text(strip=True) if name_el else "",
                "price": _parse_price(price_el.get_text() if price_el else ""),
                "image_url": img_el.get("src") or img_el.get("data-original") if img_el else None,
                "raw_category": CATEGORIES[category_code],
                "rank_position": idx,
                "like_count": _parse_int(like_el.get_text() if like_el else "0"),
            })
        except Exception as e:
            log.warning("card parse failed: %s", e)
            continue

    log.info("  → parsed %d items", len(items))
    return items


def _parse_price(txt: str) -> Optional[int]:
    digits = re.sub(r"[^0-9]", "", txt or "")
    return int(digits) if digits else None


def _parse_int(txt: str) -> int:
    """ '1.2K' / '12,345' 등 처리 """
    if not txt:
        return 0
    txt = txt.strip().replace(",", "")
    m = re.match(r"([\d.]+)\s*([kKmM]?)", txt)
    if not m:
        return 0
    num = float(m.group(1))
    unit = m.group(2).lower()
    mult = {"k": 1_000, "m": 1_000_000}.get(unit, 1)
    return int(num * mult)


# ---------------------------------------------------------------
# Persist
# ---------------------------------------------------------------
def upsert_products_and_metrics(items: list[dict], snapshot: date):
    """
    1) trend_products upsert (source, external_id 기준)
    2) trend_metrics_daily insert (오늘 날짜 스냅샷)
    """
    if not items:
        return

    # ① product upsert
    product_rows = [
        {
            "source": "musinsa",
            "external_id": it["external_id"],
            "product_url": it["product_url"],
            "brand": it["brand"],
            "product_name": it["product_name"],
            "price": it["price"],
            "image_url": it["image_url"],
            "raw_category": it["raw_category"],
            "last_seen_at": "now()",
        }
        for it in items if it.get("external_id")
    ]

    res = sb.table("trend_products").upsert(
        product_rows,
        on_conflict="source,external_id",
    ).execute()

    # external_id → product_id 매핑
    ids = {row["external_id"]: row["id"] for row in res.data}

    # ② metrics insert
    metric_rows = [
        {
            "product_id": ids[it["external_id"]],
            "snapshot_date": snapshot.isoformat(),
            "like_count": it["like_count"],
            "rank_position": it["rank_position"],
        }
        for it in items if it.get("external_id") in ids
    ]

    sb.table("trend_metrics_daily").upsert(
        metric_rows,
        on_conflict="product_id,snapshot_date",
    ).execute()

    log.info("  → persisted %d products, %d metric rows", len(product_rows), len(metric_rows))


# ---------------------------------------------------------------
# Main
# ---------------------------------------------------------------
def main():
    snapshot = date.today()
    log.info("=== VLVD crawler start (snapshot=%s) ===", snapshot)

    total = 0
    for code, name in CATEGORIES.items():
        items = fetch_ranking(code)
        upsert_products_and_metrics(items, snapshot)
        total += len(items)
        time.sleep(SLEEP_SEC)

    log.info("=== done. total=%d items ===", total)


if __name__ == "__main__":
    main()
