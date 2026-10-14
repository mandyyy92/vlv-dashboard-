-- 하이웍스 숫자 문서 ID(hiworks_doc_id) 컬럼 — 오더 입고현황 서랍의 '열기' 링크용.
-- 주소: https://approval.office.hiworks.com/openhan.kr/approval/document/view/{hiworks_doc_id}/
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 RUN. 여러 번 실행해도 안전.
-- (컬럼이 없어도 앱은 링크(hiworks_url)만 저장하고 동작한다.)

alter table public.hiworks_docs add column if not exists hiworks_doc_id bigint;

-- 북마클릿이 저장한 'javascript:void(0)' 같은 열 수 없는 값 정리 → 서랍에서 '링크 입력' 으로 다시 넣는다.
update public.hiworks_docs set hiworks_url = null
 where hiworks_url is not null and hiworks_url !~* '^https?://';
