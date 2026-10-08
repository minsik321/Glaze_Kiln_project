-- 홈 피드는 모든 로그인 사용자에게 같은 글이 보여야 한다. 20261007010000에서는
-- 읽기 정책이 본인 글만 허용해 다른 계정에는 새 글이 뜨지 않았다.
-- 쓰기(insert/update/delete)는 그대로 작성자 본인만.

-- 1. 글 읽기: 로그인한 누구나.
drop policy if exists feed_posts_read on public.feed_posts;
create policy feed_posts_read on public.feed_posts for select to authenticated
  using (true);
create index if not exists feed_posts_created on public.feed_posts(created_at desc);

-- 2. 작성자 표시용 공개 프로필. profiles는 본인 행만 읽히므로(profiles_read_own)
--    이름·아바타만 노출하는 뷰를 따로 둔다. bio 등 나머지 열은 내보내지 않는다.
--    (뷰는 소유자 권한으로 실행되어 profiles RLS를 우회한다 — 노출 열을 제한하려는 의도.)
create or replace view public.public_profiles as
  select id, display_name, avatar_url from public.profiles;
revoke all on public.public_profiles from anon, authenticated;
grant select on public.public_profiles to authenticated;

-- 3. 게시글 사진: 소유자 외에도, 피드 글이 그 경로를 가리키면 로그인한 누구나 읽는다.
--    기존 조건(공개·동의된 run의 사진)은 그대로 유지한다.
drop policy if exists aice_storage_read on storage.objects;
create policy aice_storage_read on storage.objects for select to authenticated using (
  bucket_id in ('aice-recipe-photos', 'aice-result-photos') and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1 from public.aice_runs r
      where r.user_id::text = (storage.foldername(storage.objects.name))[1]
        and r.is_public
        and public.has_active_aice_consent(r.id)
        and jsonb_path_exists(r.payload, '$.**.storage_path ? (@ == $p)',
                              jsonb_build_object('p', storage.objects.name))
    )
    or (
      bucket_id = 'aice-result-photos'
      and exists (
        select 1 from public.feed_posts f
        where f.user_id::text = (storage.foldername(storage.objects.name))[1]
          and f.payload->>'imagePath' = storage.objects.name
      )
    )
  )
);

notify pgrst, 'reload schema';
