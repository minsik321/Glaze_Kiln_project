-- AiceRun v3 normalized envelope, provenance, consent, photo metadata and RLS.
-- Legacy work_records remains readable and unchanged for compatibility.

create table public.aice_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 200),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  schema_version integer not null default 3 check (schema_version = 3),
  status text not null check (status in ('draft', 'simulated', 'evaluated')),
  goal_gloss text not null,
  goal_transparency text not null,
  recipe_id text not null,
  ware_preset text not null check (ware_preset in ('bowl', 'plate', 'mug', 'cylinder_vase', 'bottle', 'tile', 'other')),
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (payload ->> 'schema_version' = '3')
);
create index aice_runs_owner_date on public.aice_runs(user_id, created_at desc);
create index aice_runs_discovery on public.aice_runs(goal_gloss, goal_transparency, recipe_id, ware_preset, created_at desc);
create index aice_runs_public_date on public.aice_runs(created_at desc) where is_public;
create trigger aice_runs_updated_at before update on public.aice_runs
for each row execute function public.set_work_record_updated_at();

create table public.aice_run_sources (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.aice_runs(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source_type text not null check (source_type in ('observed', 'patent_example', 'patent_range', 'literature', 'inferred', 'synthetic')),
  reference text not null,
  locator text,
  original_condition text,
  conversion text,
  interpretation text,
  limitation text not null,
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  created_at timestamptz not null default now()
);
create index aice_run_sources_run on public.aice_run_sources(run_id);

create table public.aice_consents (
  run_id uuid primary key references public.aice_runs(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  share_allowed boolean not null default false,
  photo_rights_confirmed boolean not null default false,
  pii_reviewed boolean not null default false,
  location_removed boolean not null default false,
  granted_at timestamptz,
  withdrawn_at timestamptz,
  updated_at timestamptz not null default now(),
  check (not share_allowed or granted_at is not null)
);
create trigger aice_consents_updated_at before update on public.aice_consents
for each row execute function public.set_work_record_updated_at();

create table public.personal_calibrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kiln_profile_id text not null,
  clay_body text not null,
  coefficients jsonb not null default '{}'::jsonb check (jsonb_typeof(coefficients) = 'object'),
  provenance jsonb not null default '[]'::jsonb check (jsonb_typeof(provenance) = 'array'),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kiln_profile_id, clay_body, version)
);
create trigger personal_calibrations_updated_at before update on public.personal_calibrations
for each row execute function public.set_work_record_updated_at();

create table public.aice_photos (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.aice_runs(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('recipe', 'result')),
  bucket_id text not null check (bucket_id in ('aice-recipe-photos', 'aice-result-photos')),
  storage_path text not null unique,
  source_type text not null check (source_type in ('observed', 'patent_example', 'patent_range', 'literature', 'inferred', 'synthetic')),
  rights_confirmed boolean not null default false,
  license_note text not null default '',
  is_public boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  check (storage_path like user_id::text || '/%'),
  check (not is_public or rights_confirmed),
  check ((kind = 'recipe' and bucket_id = 'aice-recipe-photos') or (kind = 'result' and bucket_id = 'aice-result-photos'))
);
create index aice_photos_run on public.aice_photos(run_id) where deleted_at is null;

create function public.has_active_aice_consent(target_run uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.aice_consents c
    where c.run_id = target_run and c.share_allowed and c.photo_rights_confirmed
      and c.pii_reviewed and c.location_removed and c.withdrawn_at is null
  )
$$;
revoke all on function public.has_active_aice_consent(uuid) from public;
grant execute on function public.has_active_aice_consent(uuid) to authenticated;

alter table public.aice_runs enable row level security;
alter table public.aice_run_sources enable row level security;
alter table public.aice_consents enable row level security;
alter table public.personal_calibrations enable row level security;
alter table public.aice_photos enable row level security;

revoke all on public.aice_runs, public.aice_run_sources, public.aice_consents, public.personal_calibrations, public.aice_photos from anon;
grant select, insert, update, delete on public.aice_runs, public.aice_run_sources, public.aice_consents, public.personal_calibrations, public.aice_photos to authenticated;

create policy aice_runs_read on public.aice_runs for select to authenticated
using ((select auth.uid()) = user_id or (is_public and public.has_active_aice_consent(id)));
create policy aice_runs_insert on public.aice_runs for insert to authenticated with check ((select auth.uid()) = user_id);
create policy aice_runs_update on public.aice_runs for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy aice_runs_delete on public.aice_runs for delete to authenticated using ((select auth.uid()) = user_id);

create policy aice_sources_read on public.aice_run_sources for select to authenticated
using ((select auth.uid()) = user_id or exists (select 1 from public.aice_runs r where r.id = run_id and r.is_public and public.has_active_aice_consent(r.id)));
create policy aice_sources_insert on public.aice_run_sources for insert to authenticated
with check ((select auth.uid()) = user_id and exists (select 1 from public.aice_runs r where r.id = run_id and r.user_id = (select auth.uid())));
create policy aice_sources_update on public.aice_run_sources for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy aice_sources_delete on public.aice_run_sources for delete to authenticated using ((select auth.uid()) = user_id);

create policy aice_consents_owner on public.aice_consents for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id and exists (select 1 from public.aice_runs r where r.id = run_id and r.user_id = (select auth.uid())));
create policy calibrations_owner on public.personal_calibrations for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy aice_photos_read on public.aice_photos for select to authenticated
using ((select auth.uid()) = user_id or (is_public and rights_confirmed and deleted_at is null and exists (select 1 from public.aice_runs r where r.id = run_id and r.is_public and public.has_active_aice_consent(r.id))));
create policy aice_photos_insert on public.aice_photos for insert to authenticated
with check ((select auth.uid()) = user_id and exists (select 1 from public.aice_runs r where r.id = run_id and r.user_id = (select auth.uid())));
create policy aice_photos_update on public.aice_photos for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy aice_photos_delete on public.aice_photos for delete to authenticated using ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('aice-recipe-photos', 'aice-recipe-photos', false, 10485760, array['image/jpeg','image/png','image/webp']),
  ('aice-result-photos', 'aice-result-photos', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy aice_storage_read on storage.objects for select to authenticated using (
  bucket_id in ('aice-recipe-photos', 'aice-result-photos') and (
    (storage.foldername(name))[1] = (select auth.uid())::text or
    exists (select 1 from public.aice_photos p where p.bucket_id = storage.objects.bucket_id and p.storage_path = storage.objects.name and p.is_public and p.rights_confirmed and p.deleted_at is null)
  )
);
create policy aice_storage_insert on storage.objects for insert to authenticated with check (
  bucket_id in ('aice-recipe-photos', 'aice-result-photos') and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy aice_storage_update on storage.objects for update to authenticated using (
  bucket_id in ('aice-recipe-photos', 'aice-result-photos') and (storage.foldername(name))[1] = (select auth.uid())::text
) with check ((storage.foldername(name))[1] = (select auth.uid())::text);
create policy aice_storage_delete on storage.objects for delete to authenticated using (
  bucket_id in ('aice-recipe-photos', 'aice-result-photos') and (storage.foldername(name))[1] = (select auth.uid())::text
);

create view public.legacy_work_records_readonly with (security_invoker = true) as
select id, user_id, title, payload, schema_version, is_public, created_at, updated_at
from public.work_records;
grant select on public.legacy_work_records_readonly to authenticated;
