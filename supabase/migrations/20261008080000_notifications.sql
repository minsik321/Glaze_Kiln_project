-- 알림. 지금까지 알림 화면은 코드에 박힌 가짜 목록이었다.
-- 받는 사람(user_id)의 알림만 본인이 읽고, 읽음 처리(read_at)만 본인이 바꾼다.
-- 알림 생성은 앱이 하지 않고 DB 트리거가 한다(팔로우·댓글이 실제로 생겼을 때만).
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('follow', 'comment')),
  -- comment일 때 댓글이 달린 게시글 id(text: follows.followee_id와 같은 이유).
  post_id text check (post_id is null or char_length(post_id) between 1 and 100),
  body text check (body is null or char_length(body) <= 200),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  check (user_id <> actor_id)
);
create index notifications_user_time on public.notifications(user_id, created_at desc);
create index notifications_user_unread on public.notifications(user_id) where read_at is null;

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_read on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 팔로우 → 팔로우당한 가입자에게 알림. 더미 작가 id(uuid가 아닌 값)에는 만들지 않는다.
-- 언팔로우했다 다시 팔로우해도 읽지 않은 같은 알림이 있으면 새로 쌓지 않는다.
create function public.notify_follow() returns trigger
language plpgsql security definer set search_path = public as $$
declare target uuid;
begin
  if new.followee_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return new;
  end if;
  target := new.followee_id::uuid;
  if not exists (select 1 from auth.users where id = target) then return new; end if;
  if exists (select 1 from public.notifications
             where user_id = target and actor_id = new.follower_id and kind = 'follow' and read_at is null) then
    return new;
  end if;
  insert into public.notifications (user_id, actor_id, kind) values (target, new.follower_id, 'follow');
  return new;
end $$;
create trigger follows_notify after insert on public.follows
  for each row execute function public.notify_follow();

-- 댓글 → 게시글 작성자에게 알림(본인 글에 단 댓글은 제외). 더미 게시물에는 만들지 않는다.
create function public.notify_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  if new.post_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return new;
  end if;
  select user_id into owner from public.feed_posts where id = new.post_id::uuid;
  if owner is null or owner = new.user_id then return new; end if;
  insert into public.notifications (user_id, actor_id, kind, post_id, body)
    values (owner, new.user_id, 'comment', new.post_id, left(new.body, 200));
  return new;
end $$;
create trigger post_comments_notify after insert on public.post_comments
  for each row execute function public.notify_comment();

notify pgrst, 'reload schema';
