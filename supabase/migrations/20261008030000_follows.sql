-- 팔로우 관계. 지금까지는 화면 상태에만 있어 새로고침하면 사라졌다.
-- followee_id는 text다: 홈 피드에 섞여 있는 더미 작가 id("mira" 등)와 실제 가입자
-- uuid(문자열)를 둘 다 담는다(chat_threads.peer_id와 같은 이유).
create table public.follows (
  follower_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  followee_id text not null check (char_length(followee_id) between 1 and 100),
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (followee_id <> follower_id::text)
);
-- "나를 팔로우하는 사람" 조회용.
create index follows_followee on public.follows(followee_id, created_at desc);

alter table public.follows enable row level security;
revoke all on public.follows from anon;
grant select, insert, delete on public.follows to authenticated;
-- 팔로우 그래프는 공개 정보다(팔로워 목록·수를 다른 사용자도 본다). 쓰기는 본인 관계만.
create policy follows_read on public.follows for select to authenticated using (true);
create policy follows_insert on public.follows for insert to authenticated
  with check (follower_id = (select auth.uid()));
create policy follows_delete on public.follows for delete to authenticated
  using (follower_id = (select auth.uid()));

-- 20261008020000에서 만든 뷰가 아직 없는 환경에서도 이 마이그레이션이 단독으로 통하도록 재선언.
create or replace view public.public_profiles as
  select id, display_name, avatar_url from public.profiles;
revoke all on public.public_profiles from anon, authenticated;
grant select on public.public_profiles to authenticated;

notify pgrst, 'reload schema';
