-- Schema cleanup: drop tables and columns the app never reads or writes, and
-- fix the two integrity gaps found while auditing the live database.

-- 1. Legacy v1 records. aice_runs (schema v3) replaced them; the table held
--    no rows and no client called the /work-records API.
drop view if exists public.legacy_work_records_readonly;
drop table if exists public.work_records;

-- The shared updated_at trigger function outlives work_records; name it for
-- what it does. Existing triggers reference it by OID, so they keep working.
alter function public.set_work_record_updated_at() rename to set_updated_at;

-- 2. aice_run_sources. Provenance is stored once, in aice_runs.payload.sources;
--    this table was never written.
drop table if exists public.aice_run_sources;

-- 3. aice_photos. Photo metadata is stored in aice_runs.payload (each photo's
--    storage_path); this table was never written. The storage read policy
--    depended on it, so photos of a published run were unreadable to others.
--    New rule: an object is readable by its owner, or by any signed-in user
--    when a public, consented run of the same owner references its path.
drop policy if exists aice_storage_read on storage.objects;
drop table if exists public.aice_photos;
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
  )
);

-- 4. personal_calibrations. Since 20260917 the row is keyed by recipe alone:
--    kiln_profile_id/clay_body were written as constants, version was always 1,
--    and provenance duplicated coefficients.*.provenance_notes.
--    (user_id, recipe_id) becomes the natural primary key.
alter table public.personal_calibrations
  drop column id,
  drop column kiln_profile_id,
  drop column clay_body,
  drop column version,
  drop column provenance,
  alter column recipe_id drop default,
  add constraint personal_calibrations_recipe_id_check check (char_length(recipe_id) between 1 and 200),
  add constraint personal_calibrations_pkey primary key (user_id, recipe_id);
drop index if exists public.personal_calibrations_recipe;

drop function if exists public.commit_aice_feedback(text, jsonb, jsonb, jsonb, uuid);
create function public.commit_aice_feedback(p_recipe_id text, p_expected jsonb,
  p_coefficients jsonb, p_run_id uuid default null)
returns table(applied boolean) language plpgsql security invoker set search_path = '' as $$
declare current_coefficients jsonb; current_status text; current_recipe text; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_run_id is not null then
    select feedback_status, recipe_id into current_status, current_recipe
      from public.aice_runs where id = p_run_id and user_id = uid for update;
    if not found then raise exception 'Run not found' using errcode = '42501'; end if;
    if current_recipe <> p_recipe_id then raise exception 'Recipe mismatch' using errcode = '22023'; end if;
    if current_status <> 'pending' then return query select true; return; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text || ':' || p_recipe_id, 0));
  select coefficients into current_coefficients from public.personal_calibrations
    where user_id = uid and recipe_id = p_recipe_id for update;
  if coalesce(current_coefficients, '{}'::jsonb) is distinct from p_expected then
    return query select false; return;
  end if;
  insert into public.personal_calibrations(user_id, recipe_id, coefficients)
  values (uid, p_recipe_id, p_coefficients)
  on conflict (user_id, recipe_id) do update set coefficients = excluded.coefficients;
  if p_run_id is not null then
    update public.aice_runs set feedback_status = 'applied' where id = p_run_id and user_id = uid;
  end if;
  return query select true;
end $$;
revoke all on function public.commit_aice_feedback(text, jsonb, jsonb, uuid) from public;
grant execute on function public.commit_aice_feedback(text, jsonb, jsonb, uuid) to authenticated;

-- 5. profiles: kiln capacity/shelf/power were display-only and never used in
--    any calculation (all rows empty). kiln_sensor_plan stays: it drives the
--    sensor layout on the firing screen.
alter table public.profiles
  drop column if exists kiln_capacity_l,
  drop column if exists kiln_shelf_count,
  drop column if exists kiln_power_kw;

-- 6. Every auth user gets exactly one profile row (one account had none).
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id) values (new.id) on conflict (id) do nothing;
  return new;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();
insert into public.profiles(id) select id from auth.users on conflict (id) do nothing;

notify pgrst, 'reload schema';
