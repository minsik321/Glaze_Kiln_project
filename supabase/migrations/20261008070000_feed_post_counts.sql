-- 프로필의 게시물 수. 비공개 계정의 글은 팔로워가 아니면 읽을 수 없으므로(RLS),
-- 화면이 "읽힌 글 개수"로 세면 언팔로우하는 순간 1 → 0으로 줄어든다.
-- 글 내용은 내보내지 않고 작성자별 개수만 돌려준다(공개 계정이든 비공개든 같은 값).
create or replace function public.feed_post_counts()
returns table (user_id uuid, post_count bigint)
language sql stable security definer set search_path = '' as $$
  select f.user_id, count(*) from public.feed_posts f group by f.user_id;
$$;
revoke all on function public.feed_post_counts() from public, anon;
grant execute on function public.feed_post_counts() to authenticated;

notify pgrst, 'reload schema';
