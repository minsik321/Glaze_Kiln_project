-- aice_runs: payload is the source of truth; the searchable columns are derived.
--
-- title, status, goal_gloss, goal_transparency, ware_preset and recipe_id are
-- copies of payload->title / status / goal / ware / recipe. Nothing in the
-- database kept the copies in step, and two legacy draft rows had already
-- drifted (title column = the chat prompt, payload title = the recipe name).
-- A trigger now writes the columns from the payload on every insert and every
-- payload update, so the two can no longer disagree.
--
-- schema_version is not touched: payload->>'schema_version' = '3' and
-- schema_version = 3 are both table CHECKs already.
-- recipe_ref_id is not derived: it is a real FK resolved by resolve_recipe().
--
-- A payload that lacks a key keeps the column's current value, so the trigger
-- never introduces a NOT NULL violation of its own.
create function public.aice_runs_sync_from_payload() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.title := coalesce(left(nullif(btrim(new.payload->>'title'), ''), 200), new.title);
  new.status := coalesce(new.payload->>'status', new.status);
  new.goal_gloss := coalesce(new.payload #>> '{goal,gloss}', new.goal_gloss);
  new.goal_transparency := coalesce(new.payload #>> '{goal,transparency}', new.goal_transparency);
  new.ware_preset := coalesce(new.payload #>> '{ware,preset}', new.ware_preset);
  new.recipe_id := coalesce(new.payload #>> '{recipe,id}', new.recipe_id);
  return new;
end $$;

create trigger aice_runs_sync_from_payload
before insert or update of payload on public.aice_runs
for each row execute function public.aice_runs_sync_from_payload();

-- Re-derive the rows that had drifted. Rows already in step are left alone so
-- their updated_at does not move.
update public.aice_runs
set payload = payload
where title is distinct from left(nullif(btrim(payload->>'title'), ''), 200)
   or status is distinct from payload->>'status'
   or goal_gloss is distinct from payload #>> '{goal,gloss}'
   or goal_transparency is distinct from payload #>> '{goal,transparency}'
   or ware_preset is distinct from payload #>> '{ware,preset}'
   or recipe_id is distinct from payload #>> '{recipe,id}';
