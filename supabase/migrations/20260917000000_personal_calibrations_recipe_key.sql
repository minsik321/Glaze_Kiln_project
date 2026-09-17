-- personal_calibrations was migrated with a (kiln_profile_id, clay_body) key,
-- but kiln.calibration.registry.CoefficientTableStore (10-2절) keys strictly
-- by recipe_id — a table isolation guarantee that breaks if two recipes on
-- the same kiln/clay share a row. No endpoint has ever read or written this
-- table yet (LLM 프런트도어 TODO Phase 5), so there is no data to migrate.

alter table public.personal_calibrations
  add column recipe_id text not null default '';

-- Drop the original (user_id, kiln_profile_id, clay_body, version) unique
-- constraint by looking up its auto-generated name rather than guessing it
-- (Postgres silently truncates long default constraint names to 63 bytes).
do $$
declare
  old_constraint text;
begin
  select conname into old_constraint
  from pg_constraint
  where conrelid = 'public.personal_calibrations'::regclass
    and contype = 'u'
    and conkey = (
      select array_agg(attnum order by attnum)
      from pg_attribute
      where attrelid = 'public.personal_calibrations'::regclass
        and attname in ('user_id', 'kiln_profile_id', 'clay_body', 'version')
    );
  if old_constraint is not null then
    execute format('alter table public.personal_calibrations drop constraint %I', old_constraint);
  end if;
end $$;

alter table public.personal_calibrations
  add constraint personal_calibrations_user_recipe_version_key
  unique (user_id, recipe_id, version);

create index personal_calibrations_recipe on public.personal_calibrations(user_id, recipe_id);
