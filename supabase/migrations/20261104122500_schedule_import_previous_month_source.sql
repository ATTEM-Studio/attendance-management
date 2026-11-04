alter table public.schedule_import_runs
  drop constraint if exists schedule_import_runs_source_type_check;

alter table public.schedule_import_runs
  add constraint schedule_import_runs_source_type_check
  check (source_type in ('xlsx','previous_month'));

comment on column public.schedule_import_runs.source_type is
  'Schedule import source: xlsx external file or previous_month internal schedule copy.';
