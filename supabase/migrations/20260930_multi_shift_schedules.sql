create table if not exists public.extra_schedules (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date date not null,
  scheduled_start time not null,
  scheduled_end time not null,
  shift_type text not null default 'other'
    check (shift_type in ('open','middle','close','open_middle','middle_close','other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint extra_schedules_valid_time check (scheduled_end > scheduled_start)
);

create index if not exists extra_schedules_employee_date_idx
  on public.extra_schedules(employee_id, work_date, scheduled_start);

alter table public.extra_schedules enable row level security;

comment on table public.extra_schedules is
  'Planned additional work segments. Access is mediated by attendance-schedule-tools using the service role.';
