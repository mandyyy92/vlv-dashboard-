-- 오더 입고현황 서랍 '수입 통관' — 선적 행(order_import_docs)별 첨부 파일(BL 사본, 수입신고필증 등).
-- 파일은 Storage 버킷 import-docs 의 `${선적 id}/${시각}_${파일명}` 에 두고, 메타(원래 파일명·크기)는 이 테이블에 저장.
-- order_import_docs.sql 실행 후, Supabase 대시보드 → SQL Editor 에 붙여넣고 RUN. 여러 번 실행해도 안전.

create table if not exists public.order_import_files (
  id             bigint generated always as identity primary key,
  import_doc_id  bigint not null references public.order_import_docs(id) on delete cascade,
  file_path      text not null,   -- import-docs 버킷 내 경로
  file_name      text not null,   -- 원래 파일명(표시용)
  file_type      text,
  file_size      bigint,
  uploaded_at    timestamptz not null default now()
);

create index if not exists idx_order_import_files_doc on public.order_import_files(import_doc_id);

alter table public.order_import_files enable row level security;

drop policy if exists "Allow all read"   on public.order_import_files;
drop policy if exists "Allow all insert" on public.order_import_files;
drop policy if exists "Allow all update" on public.order_import_files;
drop policy if exists "Allow all delete" on public.order_import_files;

create policy "Allow all read"   on public.order_import_files for select using (true);
create policy "Allow all insert" on public.order_import_files for insert with check (true);
create policy "Allow all update" on public.order_import_files for update using (true);
create policy "Allow all delete" on public.order_import_files for delete using (true);

grant select, insert, update, delete on public.order_import_files to anon, authenticated;

-- Storage 버킷(비공개, 20MB 제한) — 열기는 앱이 1시간짜리 서명 URL 로 연다.
insert into storage.buckets (id, name, public, file_size_limit)
values ('import-docs', 'import-docs', false, 20971520)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

drop policy if exists "import-docs read"   on storage.objects;
drop policy if exists "import-docs insert" on storage.objects;
drop policy if exists "import-docs delete" on storage.objects;

create policy "import-docs read"   on storage.objects for select to anon, authenticated using (bucket_id = 'import-docs');
create policy "import-docs insert" on storage.objects for insert to anon, authenticated with check (bucket_id = 'import-docs');
create policy "import-docs delete" on storage.objects for delete to anon, authenticated using (bucket_id = 'import-docs');
