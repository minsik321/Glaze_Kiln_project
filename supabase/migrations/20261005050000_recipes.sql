-- Recipes become their own entity, separate from the runs that use them.
--
-- Two different "authors" exist and must not be confused:
--   recipes.owner_id    = who wrote this glaze recipe
--   aice_runs.user_id   = who actually fired a run with it
-- Using someone else's recipe unchanged points a run at THEIR recipe row.
-- Changing the composition creates the user's own recipe whose
-- forked_from_id remembers where it came from (self-referencing FK).
--
-- aice_runs.payload.recipe stays as a snapshot of the recipe at firing time,
-- so later edits or deletion of a recipe never rewrite a past firing.
-- Personal calibration stays keyed by (user, composition_key): it belongs to
-- the person whose kiln produced the result, not to the recipe's author.

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  forked_from_id uuid references public.recipes(id) on delete set null,
  name text not null default '' check (char_length(name) <= 200),
  materials jsonb not null check (jsonb_typeof(materials) = 'object' and materials <> '{}'::jsonb),
  colorants jsonb not null default '{}'::jsonb check (jsonb_typeof(colorants) = 'object'),
  composition_key text not null check (composition_key like 'glaze-v1-%'),
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recipes_owner_composition_key unique (owner_id, composition_key),
  constraint recipes_not_own_parent check (forked_from_id is null or forked_from_id <> id)
);
create index recipes_forked_from on public.recipes(forked_from_id);
create index recipes_public_composition on public.recipes(composition_key) where is_public;
create trigger recipes_updated_at before update on public.recipes
for each row execute function public.set_updated_at();

alter table public.recipes enable row level security;
revoke all on public.recipes from anon;
grant select, insert, update, delete on public.recipes to authenticated;
create policy recipes_read on public.recipes for select to authenticated
  using (owner_id = (select auth.uid()) or is_public);
create policy recipes_insert on public.recipes for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy recipes_update on public.recipes for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy recipes_delete on public.recipes for delete to authenticated
  using (owner_id = (select auth.uid()));

alter table public.aice_runs
  add column recipe_ref_id uuid references public.recipes(id) on delete set null;
create index aice_runs_recipe_ref on public.aice_runs(recipe_ref_id);

-- Backfill: every distinct composition a user has fired becomes that user's
-- recipe (earliest run's name), and their runs point at it.
insert into public.recipes(owner_id, name, materials, colorants, composition_key, created_at)
select distinct on (r.user_id, r.recipe_id)
  r.user_id,
  left(coalesce(r.payload->'recipe'->>'name', ''), 200),
  r.payload->'recipe'->'materials',
  case when jsonb_typeof(r.payload->'recipe'->'colorants') = 'object' then r.payload->'recipe'->'colorants' else '{}'::jsonb end,
  r.recipe_id,
  r.created_at
from public.aice_runs r
where r.recipe_id like 'glaze-v1-%'
  and jsonb_typeof(r.payload->'recipe'->'materials') = 'object'
  and r.payload->'recipe'->'materials' <> '{}'::jsonb
order by r.user_id, r.recipe_id, r.created_at
on conflict (owner_id, composition_key) do nothing;

update public.aice_runs r set recipe_ref_id = c.id
from public.recipes c
where c.owner_id = r.user_id and c.composition_key = r.recipe_id and r.recipe_ref_id is null;

-- Decide which recipe row a run uses.
--   p_ref given and visible with the same composition  -> use it as-is (may be someone else's)
--   otherwise                                          -> the caller's own recipe for this
--     composition, created on first use; when p_ref was a different composition the new
--     row records it as forked_from_id.
create function public.resolve_recipe(p_ref uuid, p_key text, p_recipe jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  uid uuid := auth.uid();
  ref_key text;
  result_id uuid;
  v_materials jsonb := p_recipe->'materials';
  v_colorants jsonb := case when jsonb_typeof(p_recipe->'colorants') = 'object' then p_recipe->'colorants' else '{}'::jsonb end;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_key is null or p_key not like 'glaze-v1-%'
     or jsonb_typeof(v_materials) is distinct from 'object' or v_materials = '{}'::jsonb then
    return null;
  end if;
  if p_ref is not null then
    select composition_key into ref_key from public.recipes where id = p_ref;  -- RLS: own or public
    if not found then
      p_ref := null;
    elsif ref_key = p_key then
      return p_ref;
    end if;
  end if;
  select id into result_id from public.recipes where owner_id = uid and composition_key = p_key;
  if found then return result_id; end if;
  insert into public.recipes(owner_id, forked_from_id, name, materials, colorants, composition_key)
  values (uid, p_ref, left(coalesce(p_recipe->>'name', ''), 200), v_materials, v_colorants, p_key)
  on conflict (owner_id, composition_key) do update set name = public.recipes.name
  returning id into result_id;
  return result_id;
end $$;
revoke all on function public.resolve_recipe(uuid, text, jsonb) from public, anon;
grant execute on function public.resolve_recipe(uuid, text, jsonb) to authenticated;

-- save_aice_run now also links the run to its recipe row.
create or replace function public.save_aice_run(p_request_id uuid, p_values jsonb)
returns setof public.aice_runs language plpgsql security invoker set search_path = '' as $$
declare existing public.aice_runs; saved public.aice_runs; uid uuid := auth.uid(); v_ref uuid;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  -- Serializes creation and draft -> evaluated promotion of the same run.
  perform pg_advisory_xact_lock(hashtextextended(uid::text || p_request_id::text, 0));
  select * into existing from public.aice_runs where user_id = uid and request_id = p_request_id for update;
  if found and existing.status = 'evaluated' then
    if (existing.payload - 'updated_at' - 'revision' - 'consent') is distinct from
       (p_values->'payload' - 'updated_at' - 'revision' - 'consent') then
      raise exception '이미 평가한 회차는 수정할 수 없습니다. 새 회차로 시작해 주세요.' using errcode = '23505';
    end if;
    return next existing; return;
  end if;
  v_ref := public.resolve_recipe(nullif(p_values->>'recipe_ref_id', '')::uuid,
                                 p_values->>'recipe_id', p_values->'payload'->'recipe');
  insert into public.aice_runs(user_id, request_id, title, payload, schema_version, status,
    goal_gloss, goal_transparency, recipe_id, recipe_ref_id, ware_preset, is_public, feedback_status)
  values(uid, p_request_id, p_values->>'title', p_values->'payload', (p_values->>'schema_version')::integer,
    p_values->>'status', p_values->>'goal_gloss', p_values->>'goal_transparency',
    p_values->>'recipe_id', v_ref, p_values->>'ware_preset', (p_values->>'is_public')::boolean,
    case when p_values->>'status' = 'evaluated' then 'pending' else 'skipped' end)
  on conflict (user_id, request_id) do update set title=excluded.title, payload=excluded.payload,
    status=excluded.status, goal_gloss=excluded.goal_gloss, goal_transparency=excluded.goal_transparency,
    recipe_id=excluded.recipe_id, recipe_ref_id=excluded.recipe_ref_id, ware_preset=excluded.ware_preset,
    is_public=excluded.is_public, feedback_status=excluded.feedback_status returning * into saved;
  return next saved;
end $$;

notify pgrst, 'reload schema';
