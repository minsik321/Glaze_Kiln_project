-- The run itself is a durable outbox. Saving and marking feedback pending is
-- atomic; feedback application and marking applied is a second transaction.
alter table public.aice_runs add column request_id uuid;
alter table public.aice_runs add column feedback_status text not null default 'skipped'
  check (feedback_status in ('pending', 'applied', 'skipped'));
alter table public.aice_runs add constraint aice_runs_owner_request_key unique (user_id, request_id);
create index aice_runs_pending_feedback on public.aice_runs(user_id, recipe_id, created_at)
  where feedback_status = 'pending';

create function public.save_aice_run(p_request_id uuid, p_values jsonb)
returns setof public.aice_runs language plpgsql security invoker set search_path = '' as $$
declare existing public.aice_runs; saved public.aice_runs; uid uuid := auth.uid();
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
  insert into public.aice_runs(user_id, request_id, title, payload, schema_version, status,
    goal_gloss, goal_transparency, recipe_id, ware_preset, is_public, feedback_status)
  values(uid, p_request_id, p_values->>'title', p_values->'payload', (p_values->>'schema_version')::integer,
    p_values->>'status', p_values->>'goal_gloss', p_values->>'goal_transparency',
    p_values->>'recipe_id', p_values->>'ware_preset', (p_values->>'is_public')::boolean,
    case when p_values->>'status' = 'evaluated' then 'pending' else 'skipped' end)
  on conflict (user_id, request_id) do update set title=excluded.title, payload=excluded.payload,
    status=excluded.status, goal_gloss=excluded.goal_gloss, goal_transparency=excluded.goal_transparency,
    recipe_id=excluded.recipe_id, ware_preset=excluded.ware_preset, is_public=excluded.is_public,
    feedback_status=excluded.feedback_status returning * into saved;
  return next saved;
end $$;

-- Compare-and-swap covers ALL coefficient writers, including the optional
-- physical calibration endpoint. A conflict makes Python reload and recompute.
create function public.commit_aice_feedback(p_recipe_id text, p_expected jsonb,
  p_coefficients jsonb, p_notes jsonb, p_run_id uuid default null)
returns table(applied boolean) language plpgsql security invoker set search_path = '' as $$
declare current_coefficients jsonb; current_status text; current_recipe text; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_run_id is not null then
    select feedback_status, recipe_id into current_status, current_recipe
      from public.aice_runs where id=p_run_id and user_id=uid for update;
    if not found then raise exception 'Run not found' using errcode='42501'; end if;
    if current_recipe <> p_recipe_id then raise exception 'Recipe mismatch' using errcode='22023'; end if;
    if current_status <> 'pending' then return query select true; return; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text || ':' || p_recipe_id, 0));
  select coefficients into current_coefficients from public.personal_calibrations
    where user_id=uid and recipe_id=p_recipe_id and version=1 for update;
  if coalesce(current_coefficients, '{}'::jsonb) is distinct from p_expected then
    return query select false; return;
  end if;
  insert into public.personal_calibrations(user_id, recipe_id, kiln_profile_id, clay_body, coefficients, provenance, version)
  values(uid, p_recipe_id, 'aice-default', 'unspecified', p_coefficients, p_notes, 1)
  on conflict(user_id, recipe_id, version) do update set coefficients=excluded.coefficients,
    provenance=public.personal_calibrations.provenance || excluded.provenance;
  if p_run_id is not null then
    update public.aice_runs set feedback_status='applied' where id=p_run_id and user_id=uid;
  end if;
  return query select true;
end $$;
revoke all on function public.save_aice_run(uuid,jsonb) from public;
revoke all on function public.commit_aice_feedback(text,jsonb,jsonb,jsonb,uuid) from public;
grant execute on function public.save_aice_run(uuid,jsonb) to authenticated;
grant execute on function public.commit_aice_feedback(text,jsonb,jsonb,jsonb,uuid) to authenticated;
