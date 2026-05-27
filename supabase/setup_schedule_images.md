# 입고 스케줄 이미지 다중 업로드 — Supabase 세팅

이 문서대로 두 단계(A, B)를 마친 다음, 채팅에 **"SQL 실행 완료"** 라고 알려주면 코드 작업(STEP 3 이후)을 시작합니다.

---

## A. Storage 버킷 생성 (대시보드 GUI)

1. [Supabase 대시보드](https://supabase.com/dashboard) 접속 → 프로젝트 선택
2. 좌측 메뉴 **Storage** 클릭
3. **"New bucket"** 버튼
4. Name: **`schedule-images`**
5. ✅ **"Public bucket"** 체크 — 꼭 체크 (체크 안 하면 이미지 노출 시 별도 서명 URL 필요)
6. **Save**

---

## B. SQL 실행 (대시보드 SQL Editor)

좌측 메뉴 **SQL Editor** → **New query** → 아래 전체를 붙여넣고 **Run**:

```sql
-- ──────────────────────────────────────────────
-- 1) Storage 정책 (팀 내부용 — 익명 키로 읽기/쓰기/삭제 허용)
-- ──────────────────────────────────────────────
CREATE POLICY "schedule_images_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'schedule-images');

CREATE POLICY "schedule_images_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'schedule-images');

CREATE POLICY "schedule_images_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'schedule-images');

-- ──────────────────────────────────────────────
-- 2) schedules 테이블에 다중 이미지 컬럼 추가
-- ──────────────────────────────────────────────
ALTER TABLE public.schedules
  ADD COLUMN IF NOT EXISTS image_urls text[] DEFAULT '{}';

-- ──────────────────────────────────────────────
-- 3) (선택) 기존 단일 image_url(base64) → image_urls 마이그레이션
--    이전 세션에서 추가한 image_url(base64 dataURL) 컬럼이 있다면
--    아래 두 줄 중 원하는 동작을 선택해서 실행:
-- ──────────────────────────────────────────────
-- (a) 기존 image_url 데이터를 image_urls 배열에 옮기고 비우기:
-- UPDATE public.schedules
--   SET image_urls = ARRAY[image_url]
--   WHERE image_url IS NOT NULL AND image_url <> '';

-- (b) 기존 image_url 컬럼을 완전히 제거 (옮긴 뒤 또는 데이터 없을 때):
-- ALTER TABLE public.schedules DROP COLUMN IF EXISTS image_url;
```

> **참고**: (a)는 기존 base64 이미지가 있을 때만 의미 있음. 거의 데이터가 없다면 (b)만 실행해서 단일 컬럼을 정리하는 게 깔끔함. 둘 다 안 해도 신규 멀티 업로드는 동작함 (단, 모달 UI에 옛 이미지가 안 보일 뿐).

---

## 완료 후

위 A, B를 모두 마치고 채팅에 다음과 같이 답하면 STEP 3으로 진행:

- **"SQL 실행 완료"** — 기본
- **"SDK 옵션 A로"** — `@supabase/supabase-js` 패키지를 추가하고 싶은 경우
  - 미선택 시 기본은 **옵션 B (REST 직접 호출)** — 의존성 추가 없음, 기존 `sb` 객체에 `uploadFile`/`removeFile` 메서드 추가하는 방식
- **"기존 image_url 제거함"** / **"유지"** — 마이그레이션 SQL을 실행했는지 알려주면 코드 정합성을 맞춰드림
