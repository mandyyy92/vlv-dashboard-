# 작업 규칙

## 커밋·푸시
- 모든 작업은 커밋 후 반드시 `git push` 까지 실행한다.
- 푸시하지 않고 작업을 끝내지 않는다.
- 푸시 후 `git status` 로 `up to date` 를 확인하고 결과를 보고한다.

## 줄바꿈
- CRLF ↔ LF 전체 변환을 하지 않는다. 실제 변경 줄만 수정한다.
- diff가 수백 줄 이상으로 뜨면 줄바꿈 변환을 의심하고 멈춰서 보고한다.

## 보호 대상
- 아래 Supabase 테이블·뷰는 읽기 전용. 수정·DROP·ALTER 금지:
  inventory, "MUSINSA Detailed Order", 반품내역, mfs_sales,
  purchase_orders, purchase_order_lines,
  v_option_current_stock, v_option_daily_sales, v_option_availability
- App.jsx 는 요청된 변경에 필요한 부분만 수정한다.

## 컬럼명
- 새로 만드는 Supabase 테이블의 컬럼명은 영문으로 한다.
  (한글 컬럼은 PostgREST에서 RPC + SECURITY DEFINER 가 필요해짐)

## UI 규칙
- window.alert / window.confirm / window.prompt 사용 금지.
  안내는 인라인 메시지(성공 녹색 / 실패 빨강 / 중립 회색, 3초 후 사라짐),
  삭제 확인은 2단계 인라인 토글(3초 내 재클릭)로 처리한다.

## 작업 규칙
- 작업 완료 후 항상 commit + push 까지 수행한다.
