-- 홈 피드에 올린 게시글(작업 게시·기물 판매). 지금까지는 화면 상태에만 있어
-- 새로고침하면 사라졌다. 게시글 한 건 = 한 행, 화면용 필드는 payload에 둔다.
-- 사진은 aice-result-photos 버킷의 <user_id>/... 경로(payload.imagePath)로 저장한다.
create table public.feed_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null default 'work' check (kind in ('work', 'sale')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index feed_posts_user_created on public.feed_posts(user_id, created_at desc);
create trigger feed_posts_updated_at before update on public.feed_posts
for each row execute function public.set_updated_at();

alter table public.feed_posts enable row level security;
revoke all on public.feed_posts from anon;
grant select, insert, update, delete on public.feed_posts to authenticated;
create policy feed_posts_read on public.feed_posts for select to authenticated
  using (user_id = (select auth.uid()));
create policy feed_posts_insert on public.feed_posts for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy feed_posts_update on public.feed_posts for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy feed_posts_delete on public.feed_posts for delete to authenticated
  using (user_id = (select auth.uid()));

notify pgrst, 'reload schema';
