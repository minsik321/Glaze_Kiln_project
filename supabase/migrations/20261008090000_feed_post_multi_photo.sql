-- 게시물 사진을 여러 장 올릴 수 있게 됐다. 글의 payload에는 대표 사진 경로(imagePath)와
-- 전체 경로(imagePaths)가 들어간다. 저장소 읽기 정책이 대표 사진만 보고 있었으므로,
-- 두 번째 장부터는 다른 사용자에게 서명 URL이 발급되지 않았다. imagePaths도 같은 기준으로 연다.
-- (feed_posts 조회 자체가 RLS를 거치므로 비공개 계정 글의 사진은 팔로워에게만 열린다.)
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
          and (
            f.payload->>'imagePath' = storage.objects.name
            or coalesce(jsonb_exists(f.payload->'imagePaths', storage.objects.name), false)
          )
      )
    )
  )
);

notify pgrst, 'reload schema';
