-- 비공개 계정. 켜면 그 사람이 올린 작업물·판매글(feed_posts)은 본인과
-- 그 사람을 팔로우한 사람(follows)만 볼 수 있다. 승인 절차는 없다 — 팔로우하면 바로 보인다.
alter table public.profiles
  add column if not exists is_private boolean not null default false;

-- 글쓴이 p_author의 글을 지금 로그인한 사용자가 볼 수 있는가.
-- 정책 안에서 profiles를 직접 조회하면 profiles RLS(본인 행만)에 막혀 항상 "공개"로
-- 읽히므로, 소유자 권한(security definer)으로 판정한다.
create or replace function public.can_view_posts_of(p_author uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_author = (select auth.uid())
    or not coalesce((select pr.is_private from public.profiles pr where pr.id = p_author), false)
    or exists (
      select 1 from public.follows f
      where f.follower_id = (select auth.uid()) and f.followee_id = p_author::text
    );
$$;
revoke all on function public.can_view_posts_of(uuid) from public, anon;
grant execute on function public.can_view_posts_of(uuid) to authenticated;

drop policy if exists feed_posts_read on public.feed_posts;
create policy feed_posts_read on public.feed_posts for select to authenticated
  using (public.can_view_posts_of(user_id));

-- 댓글도 같은 기준을 따른다: 못 보는 글의 댓글은 id를 알아도 읽히지 않는다.
-- post_id가 피드 글(uuid)일 때만 판정하고, 더미 게시물 id("chloe-1" 등)는 항상 통과한다.
create or replace function public.can_view_post_comments(p_post_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when p_post_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then not exists (
        select 1 from public.feed_posts f
        where f.id = p_post_id::uuid and not public.can_view_posts_of(f.user_id)
      )
    else true
  end;
$$;
revoke all on function public.can_view_post_comments(text) from public, anon;
grant execute on function public.can_view_post_comments(text) to authenticated;

drop policy if exists post_comments_read on public.post_comments;
create policy post_comments_read on public.post_comments for select to authenticated
  using (user_id = (select auth.uid()) or public.can_view_post_comments(post_id));

-- 다른 사용자 화면에서 비공개 여부를 알 수 있게 뷰에 열을 덧붙인다(기존 열 순서 유지).
create or replace view public.public_profiles as
  select id, display_name, avatar_url, is_private from public.profiles;
revoke all on public.public_profiles from anon, authenticated;
grant select on public.public_profiles to authenticated;

notify pgrst, 'reload schema';
