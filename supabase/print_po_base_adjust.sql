-- 발주서 작성 탭 — 4) 베이스 재고 추가 조정 (입고 후)
-- 1차 출고(=발주수량)는 베이스출고 때 어드민에서 이미 차감됨.
-- 입고 후 남은 베이스 = 1차 출고 − 입고 − 불량 → 어드민에 다시 넣을 수량.
-- 새로 만든 print_po / print_po_lines 에 컬럼만 추가(보호 테이블 아님).

alter table public.print_po_lines add column if not exists defect_qty int;          -- 불량 수량
alter table public.print_po_lines add column if not exists base_return_qty int;     -- 어드민에 넣은 베이스 수량(수정값)
alter table public.print_po       add column if not exists base_adjusted_at timestamptz; -- 베이스 조정 파일 생성 시각

notify pgrst, 'reload schema';
