-- 게시글 댓글. 지금까지는 화면 상태에만 있어 새로고침하면 사라졌다.
-- post_id는 text다: feed_posts.id(uuid)뿐 아니라 홈에 섞여 있는 더미 게시물 id
-- ("chloe-1" 등)에도 댓글을 달 수 있어야 한다(follows.followee_id와 같은 이유).
create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id text not null check (char_length(post_id) between 1 and 100),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index post_comments_post_time on public.post_comments(post_id, created_at, id);
create index post_comments_user on public.post_comments(user_id);

alter table public.post_comments enable row level security;
revoke all on public.post_comments from anon;
grant select, insert, delete on public.post_comments to authenticated;
-- 피드가 모든 계정에 공개이므로 댓글도 로그인 사용자 전체가 읽는다. 쓰기·삭제는 작성자 본인만.
create policy post_comments_read on public.post_comments for select to authenticated using (true);
create policy post_comments_insert on public.post_comments for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy post_comments_delete on public.post_comments for delete to authenticated
  using (user_id = (select auth.uid()));

-- 작성자 이름·아바타 표시용(앞선 마이그레이션과 같은 정의 — 단독으로도 통하도록 재선언).
create or replace view public.public_profiles as
  select id, display_name, avatar_url from public.profiles;
revoke all on public.public_profiles from anon, authenticated;
grant select on public.public_profiles to authenticated;

notify pgrst, 'reload schema';
