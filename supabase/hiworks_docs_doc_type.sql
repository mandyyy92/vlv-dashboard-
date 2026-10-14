-- 하이웍스 기안 종류(doc_type) 컬럼 — 오더 입고현황 서랍의 '하이웍스 기안' 섹션에서 종류별로 묶어 보여주고,
-- 표 차수 행에 '계약 ✓ 계산 ✓ 지결 ✓' 를 표시하는 데 쓴다.
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 RUN. 여러 번 실행해도 안전.
--
-- 값: contract(계약서) / tax_invoice(세금계산서) / expense(지출결의서). null 이면 앱이 제목·문서종류로 추정한다
--     (세금계산서 → tax_invoice, 계약서 → contract, 그 외 → expense).

alter table public.hiworks_docs add column if not exists doc_type text;

alter table public.hiworks_docs drop constraint if exists hiworks_docs_doc_type_check;
alter table public.hiworks_docs add constraint hiworks_docs_doc_type_check
  check (doc_type is null or doc_type in ('contract','tax_invoice','expense'));

-- 직접 입력(서랍) 은 insert, 종류 변경·연결/해제는 update 를 쓴다.
grant select, insert, update on public.hiworks_docs to anon, authenticated;
