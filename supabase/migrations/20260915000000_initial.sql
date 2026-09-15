-- Initial schema. Authentication UI and persistence integration are subsequent steps.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  created_at timestamptz not null default now()
);
create table public.work_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 200),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  schema_version integer not null default 1 check (schema_version > 0),
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index work_records_owner_date on public.work_records(user_id, created_at desc);
create index work_records_public_date on public.work_records(created_at desc) where is_public;
create function public.set_work_record_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger work_records_updated_at before update on public.work_records
for each row execute function public.set_work_record_updated_at();
alter table public.profiles enable row level security;
alter table public.work_records enable row level security;
-- Deliberately no anonymous access: public records are shared with other signed-in users.
revoke all on public.profiles, public.work_records from anon;
grant select, insert, update, delete on public.profiles, public.work_records to authenticated;
create policy profiles_read_own on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy profiles_insert_own on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy profiles_delete_own on public.profiles for delete to authenticated using ((select auth.uid()) = id);
create policy records_read on public.work_records for select to authenticated using ((select auth.uid()) = user_id or is_public);
create policy records_insert_own on public.work_records for insert to authenticated with check ((select auth.uid()) = user_id);
create policy records_update_own on public.work_records for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy records_delete_own on public.work_records for delete to authenticated using ((select auth.uid()) = user_id);
