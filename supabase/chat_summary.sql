-- VLVD 대시보드: 업체 소통 요약 (카카오톡 대화 → AI 요약/번역 → 이슈 추적)
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 RUN.
-- 프로젝트: tzjpgqfdudbhygzmbygo (src/lib/supabaseClient.js 가 가리키는 곳)
--
-- ※ 컬럼명은 전부 영문. (한글 컬럼은 PostgREST 필터에서 인코딩을 매번 감싸야 하고
--    경우에 따라 RPC + SECURITY DEFINER 를 강제하게 되므로 쓰지 않는다.)
-- ※ 이 스크립트는 chat_* 5개 테이블만 만든다. 기존 테이블/뷰
--    (inventory, "MUSINSA Detailed Order", 반품내역, mfs_sales, purchase_orders,
--     purchase_order_lines, v_option_current_stock, v_option_daily_sales,
--     v_option_availability) 는 읽지도 건드리지도 않는다.
-- ※ 전부 create if not exists / drop ... if exists 라 여러 번 실행해도 안전.

-- gen_random_uuid() 용
create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────
-- 1. chat_vendors : 생산 업체 마스터
-- ─────────────────────────────────────────────────────────────
create table if not exists public.chat_vendors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,                 -- 업체명 (인도, 코니, 에스앤제이 …)
  category    text not null check (category in ('봉제','원단','나염','부자재','기타')),
  lang        text not null default 'ko' check (lang in ('ko','en','zh')),
  manager     text,                                 -- 우리 쪽 담당자
  is_active   boolean not null default true,
  aliases     text[] not null default '{}',         -- 카톡 방 제목/발신자명 자동 매칭용 별칭
  memo        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_chat_vendors_active on public.chat_vendors(is_active, name);

-- ─────────────────────────────────────────────────────────────
-- 2. chat_imports : 업로드 1회 = 1행 (파일 업로드 / 붙여넣기)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.chat_imports (
  id             uuid primary key default gen_random_uuid(),
  vendor_id      uuid not null references public.chat_vendors(id) on delete cascade,
  source         text not null check (source in ('file','paste')),
  filename       text,                              -- source='file' 일 때만
  period_from    date,                              -- 파싱된 대화의 첫 날짜
  period_to      date,                              -- 파싱된 대화의 마지막 날짜
  message_count  integer not null default 0,        -- 실제 저장된 메시지 수(중복 제외 후)
  dup_count      integer not null default 0,        -- 중복(msg_hash 충돌)으로 버려진 수
  format         text,                              -- 파서가 판별한 포맷: pc_ko / mobile_ko / ios_en …
  status         text not null default 'saved'
                 check (status in ('parsed','saved','failed')),
  error_text     text,
  created_at     timestamptz not null default now()
);

create index if not exists idx_chat_imports_vendor on public.chat_imports(vendor_id, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- 3. chat_messages : 메시지 1건 = 1행
--    body_raw = 원문 보존(인도 업체는 영어 원문), body_ko = 한글 번역본
-- ─────────────────────────────────────────────────────────────
create table if not exists public.chat_messages (
  id          bigint generated always as identity primary key,
  import_id   uuid references public.chat_imports(id) on delete cascade,
  vendor_id   uuid not null references public.chat_vendors(id) on delete cascade,
  sent_at     timestamptz not null,
  sender      text,
  body_raw    text not null,
  body_ko     text,                                 -- ko 대화는 null (번역 불필요)
  lang        text check (lang in ('ko','en','zh')),
  has_attachment boolean not null default false,    -- 사진/동영상/파일 등 첨부 안내 메시지 ('첨부' 탭용)
  msg_hash    text not null unique,                 -- 중복 업로드 방지 키
  created_at  timestamptz not null default now()
);

-- 요구 인덱스: 업체별 타임라인 조회
create index if not exists idx_chat_messages_vendor_sent on public.chat_messages(vendor_id, sent_at);
create index if not exists idx_chat_messages_import      on public.chat_messages(import_id);

-- ─────────────────────────────────────────────────────────────
-- 4. chat_summaries : AI 요약 1건 = 1행
--    summary_json 스키마(Edge Function 의 tools 파라미터로 강제):
--    { "핵심요약": [],
--      "납기":        [{"품번","내용","변경일"}],
--      "품질_클레임":  [],
--      "수량_단가":    [],
--      "우리_회신필요": [{"내용","기한"}],
--      "리스크":       [] }
--    ※ JSON "키"는 한글이지만 jsonb 값 안이라 PostgREST 컬럼 필터와 무관.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.chat_summaries (
  id            uuid primary key default gen_random_uuid(),
  vendor_id     uuid references public.chat_vendors(id) on delete cascade,
                -- null = '전체 업체 주간 브리핑' (업체 단위가 아닌 통합 요약)
  period_from   date not null,
  period_to     date not null,
  summary_json  jsonb not null default '{}'::jsonb,
  model         text,                               -- 예: claude-sonnet-5
  message_count integer not null default 0,         -- 요약에 투입된 메시지 수
  status        text not null default 'done'
                check (status in ('pending','done','failed')),
  error_text    text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_chat_summaries_vendor on public.chat_summaries(vendor_id, period_from desc);
create index if not exists idx_chat_summaries_period on public.chat_summaries(period_from desc, period_to desc);

-- ─────────────────────────────────────────────────────────────
-- 5. chat_action_items : 요약에서 뽑아낸 추적 대상 이슈
-- ─────────────────────────────────────────────────────────────
create table if not exists public.chat_action_items (
  id            uuid primary key default gen_random_uuid(),
  summary_id    uuid references public.chat_summaries(id) on delete cascade,
  vendor_id     uuid not null references public.chat_vendors(id) on delete cascade,
  type          text not null check (type in ('납기','품질','수량','단가','샘플')),
  content       text not null,
  due_date      date,
  status        text not null default 'open'
                check (status in ('open','doing','done','dropped')),
  ref_style_no  text,                               -- 메시지에서 추출한 스타일넘버 (work_orders/orders_v2 연계용)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 좌측 업체 리스트의 '미처리 액션아이템' 뱃지 카운트용
create index if not exists idx_chat_action_items_vendor  on public.chat_action_items(vendor_id, status);
create index if not exists idx_chat_action_items_summary on public.chat_action_items(summary_id);
create index if not exists idx_chat_action_items_due     on public.chat_action_items(due_date) where due_date is not null;
create index if not exists idx_chat_action_items_style   on public.chat_action_items(ref_style_no) where ref_style_no is not null;

-- ─────────────────────────────────────────────────────────────
-- RLS : 기존 테이블(reference_items, inbound_lines)과 동일한 'Allow all' 정책
-- ─────────────────────────────────────────────────────────────
alter table public.chat_vendors      enable row level security;
alter table public.chat_imports      enable row level security;
alter table public.chat_messages     enable row level security;
alter table public.chat_summaries    enable row level security;
alter table public.chat_action_items enable row level security;

do $policies$
declare t text;
begin
  foreach t in array array['chat_vendors','chat_imports','chat_messages','chat_summaries','chat_action_items'] loop
    execute format('drop policy if exists "Allow all read"   on public.%I', t);
    execute format('drop policy if exists "Allow all insert" on public.%I', t);
    execute format('drop policy if exists "Allow all update" on public.%I', t);
    execute format('drop policy if exists "Allow all delete" on public.%I', t);
    execute format('create policy "Allow all read"   on public.%I for select using (true)', t);
    execute format('create policy "Allow all insert" on public.%I for insert with check (true)', t);
    execute format('create policy "Allow all update" on public.%I for update using (true)', t);
    execute format('create policy "Allow all delete" on public.%I for delete using (true)', t);
  end loop;
end
$policies$;

-- ─────────────────────────────────────────────────────────────
-- updated_at 자동 갱신 (reference_items.sql 의 함수와 동일 — 이미 있으면 그대로 재사용)
-- ─────────────────────────────────────────────────────────────
create or replace function public.update_updated_at_column()
returns trigger as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$ language plpgsql;

drop trigger if exists update_chat_vendors_updated_at on public.chat_vendors;
create trigger update_chat_vendors_updated_at
  before update on public.chat_vendors
  for each row execute function public.update_updated_at_column();

drop trigger if exists update_chat_action_items_updated_at on public.chat_action_items;
create trigger update_chat_action_items_updated_at
  before update on public.chat_action_items
  for each row execute function public.update_updated_at_column();

-- ─────────────────────────────────────────────────────────────
-- 초기 업체 시드 (name unique 충돌 무시 → 재실행 안전)
-- 실제 카톡 방 제목/발신자명에 맞춰 aliases 는 나중에 UI 에서 수정.
-- ─────────────────────────────────────────────────────────────
insert into public.chat_vendors (name, category, lang, aliases) values
  ('인도',       '봉제', 'en', array['india','INDIA','indian']),
  ('코니',       '봉제', 'ko', array['코니','conny']),
  ('에스앤제이', '봉제', 'ko', array['에스앤제이','S&J','SNJ']),
  ('원단업체',   '원단', 'ko', array['원단']),
  ('나염 외주',  '나염', 'ko', array['나염','프린팅','printing'])
on conflict (name) do nothing;

-- ─────────────────────────────────────────────────────────────
-- category 에 '기타' 추가 (UI 업체 등록 폼의 '구분' 선택지와 맞춤)
-- 이미 만들어진 DB 는 위의 create table if not exists 가 건너뛰어지므로
-- 제약을 다시 걸어야 '기타' INSERT 가 통과한다. 재실행 안전.
-- ─────────────────────────────────────────────────────────────
alter table public.chat_vendors drop constraint if exists chat_vendors_category_check;
alter table public.chat_vendors
  add constraint chat_vendors_category_check
  check (category in ('봉제','원단','나염','부자재','기타'));
