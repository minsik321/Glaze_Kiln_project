-- aice_runs.recipe_id vs recipe_ref_id: keep the copy, forbid disagreement.
--
-- recipe_id is the recipe's composition key as text; recipe_ref_id is the real
-- FK to recipes. The text copy cannot simply go: personal_calibrations is keyed
-- by it (user_id, recipe_id), commit_aice_feedback / save_aice_run take it, the
-- /aice/calibration/{recipe_id} route and the calibration core use it as their
-- identity. So the duplicate stays, and the database now refuses a run whose
-- two columns disagree. Together with aice_runs_sync_from_payload this makes
-- payload -> recipe_id -> recipes.composition_key one chain with no free copy.
--
-- The guard trigger is named so that it sorts after aice_runs_sync_from_payload
-- (same-event triggers run alphabetically) and therefore checks the final value.
-- If the referenced recipe is not visible to the caller (a public recipe that
-- was made private later), the check is skipped rather than failing an
-- unrelated update.
create function public.aice_runs_recipe_key_guard() returns trigger
language plpgsql set search_path = '' as $$
declare v_key text;
begin
  if new.recipe_ref_id is null then return new; end if;
  select composition_key into v_key from public.recipes where id = new.recipe_ref_id;
  if v_key is not null and v_key is distinct from new.recipe_id then
    raise exception 'aice_runs.recipe_id (%) does not match recipes.composition_key (%) of recipe_ref_id',
      new.recipe_id, v_key using errcode = '23514';
  end if;
  return new;
end $$;

create trigger aice_runs_sync_recipe_key_guard
before insert or update of recipe_id, recipe_ref_id, payload on public.aice_runs
for each row execute function public.aice_runs_recipe_key_guard();

-- Legacy drafts from 2026-09-18 carry the pre-hash key 'coastal-satin', so
-- 20261005050000_recipes.sql (glaze-v1-% keys only) left them unlinked. Give
-- them the canonical key kiln.aice.identity.canonical_recipe_id() computes for
-- the same materials, create the recipe row, and link the runs. Matches only
-- runs that still carry the legacy key AND exactly these materials; a database
-- without them is untouched.
insert into public.recipes(owner_id, name, materials, colorants, composition_key, created_at)
select distinct on (r.user_id)
  r.user_id, left(coalesce(r.payload->'recipe'->>'name', ''), 200), r.payload->'recipe'->'materials',
  '{}'::jsonb, 'glaze-v1-9799c9424d963459c01eb67875feb78dd0cacf6270917ba76f937c93e07d3314', r.created_at
from public.aice_runs r
where r.recipe_id = 'coastal-satin' and r.recipe_ref_id is null
  and r.payload->'recipe'->'materials' = '{"규석": 25, "장석": 40, "석회석": 20, "카올린": 15}'::jsonb
order by r.user_id, r.created_at
on conflict (owner_id, composition_key) do nothing;

update public.aice_runs r
set payload = jsonb_set(
      jsonb_set(r.payload, '{recipe,id}', to_jsonb(c.composition_key)),
      '{recipe,colorants}', '{}'::jsonb),
    recipe_ref_id = c.id
from public.recipes c
where c.owner_id = r.user_id
  and c.composition_key = 'glaze-v1-9799c9424d963459c01eb67875feb78dd0cacf6270917ba76f937c93e07d3314'
  and r.recipe_id = 'coastal-satin' and r.recipe_ref_id is null
  and r.payload->'recipe'->'materials' = '{"규석": 25, "장석": 40, "석회석": 20, "카올린": 15}'::jsonb;
