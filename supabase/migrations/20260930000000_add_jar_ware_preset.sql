alter table public.aice_runs
  drop constraint if exists aice_runs_ware_preset_check;

alter table public.aice_runs
  add constraint aice_runs_ware_preset_check
  check (ware_preset in ('bowl', 'plate', 'mug', 'cylinder_vase', 'bottle', 'jar', 'tile', 'other'));
