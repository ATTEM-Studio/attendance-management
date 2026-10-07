create table if not exists public.schedule_import_runs (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('xlsx','image')),
  source_name text not null default '',
  source_fingerprint text not null default '',
  target_month text not null check (target_month ~ '^\d{4}-\d{2}$'),
  effective_date date not null,
  parsed_count integer not null default 0 check (parsed_count >= 0),
  add_count integer not null default 0 check (add_count >= 0),
  update_count integer not null default 0 check (update_count >= 0),
  remove_count integer not null default 0 check (remove_count >= 0),
  protected_count integer not null default 0 check (protected_count >= 0),
  review_count integer not null default 0 check (review_count >= 0),
  status text not null default 'previewed' check (status in ('previewed','applied','failed')),
  applied_changes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);

create index if not exists schedule_import_runs_created_idx
  on public.schedule_import_runs(created_at desc);

create table if not exists public.schedule_import_aliases (
  label_key text primary key,
  employee_id uuid not null references public.employees(id) on delete cascade,
  original_label text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.schedule_import_runs enable row level security;
alter table public.schedule_import_aliases enable row level security;

comment on table public.schedule_import_runs is 'Audit metadata for schedule imports. Source file bytes are not stored.';
comment on table public.schedule_import_aliases is 'Confirmed imported employee label aliases. Access is service-role only.';

create or replace function public.apply_schedule_import(
  p_target_month text,
  p_effective_date date,
  p_authoritative boolean,
  p_shifts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_month_start date;
  v_month_next date;
  v_group record;
  v_first record;
  v_base public.schedules%rowtype;
  v_applied integer := 0;
  v_protected integer := 0;
begin
  if p_target_month is null or p_target_month !~ '^\d{4}-\d{2}$' then
    raise exception 'invalid target month';
  end if;
  if p_effective_date is null or p_effective_date < v_today then
    raise exception 'effective date cannot be in the past';
  end if;
  if jsonb_typeof(coalesce(p_shifts,'[]'::jsonb)) <> 'array' then
    raise exception 'shifts must be an array';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_shifts,'[]'::jsonb)) x
    where nullif(btrim(x->>'employeeId'),'') is null
  ) then
    raise exception 'all imported shifts must be matched to an employee';
  end if;

  v_month_start := to_date(p_target_month || '-01','YYYY-MM-DD');
  v_month_next := (v_month_start + interval '1 month')::date;
  if p_effective_date < v_month_start then
    p_effective_date := greatest(v_today,v_month_start);
  end if;
  if p_effective_date >= v_month_next then
    raise exception 'effective date must be inside target month';
  end if;

  create temporary table if not exists schedule_import_desired (
    row_no bigserial,
    employee_id uuid not null,
    work_date date not null,
    scheduled_start time not null,
    scheduled_end time not null,
    shift_type text not null
  ) on commit drop;
  truncate table schedule_import_desired;

  insert into schedule_import_desired(employee_id,work_date,scheduled_start,scheduled_end,shift_type)
  select
    (x->>'employeeId')::uuid,
    (x->>'workDate')::date,
    (x->>'scheduledStart')::time,
    (x->>'scheduledEnd')::time,
    case when coalesce(x->>'shiftType','other') in ('open','middle','close','open_middle','middle_close','other')
      then coalesce(x->>'shiftType','other') else 'other' end
  from jsonb_array_elements(coalesce(p_shifts,'[]'::jsonb)) x;

  if exists (
    select 1 from schedule_import_desired
    where work_date < p_effective_date or work_date < v_month_start or work_date >= v_month_next
  ) then
    raise exception 'import contains a date outside the allowed range';
  end if;
  if exists (select 1 from schedule_import_desired where scheduled_end <= scheduled_start) then
    raise exception 'invalid shift time range';
  end if;
  if exists (
    select 1
    from schedule_import_desired a
    join schedule_import_desired b
      on a.employee_id=b.employee_id and a.work_date=b.work_date and a.row_no<b.row_no
     and a.scheduled_start < b.scheduled_end and b.scheduled_start < a.scheduled_end
  ) then
    raise exception 'overlapping imported shifts';
  end if;
  if exists (
    select 1 from schedule_import_desired d
    left join public.employees e on e.id=d.employee_id and e.active=true
    where e.id is null
  ) then
    raise exception 'import contains an unknown or inactive employee';
  end if;

  create temporary table if not exists schedule_import_scope (
    employee_id uuid not null,
    work_date date not null,
    protected boolean not null default false,
    primary key(employee_id,work_date)
  ) on commit drop;
  truncate table schedule_import_scope;

  insert into schedule_import_scope(employee_id,work_date)
  select distinct employee_id,work_date from schedule_import_desired
  on conflict do nothing;

  if coalesce(p_authoritative,false) then
    insert into schedule_import_scope(employee_id,work_date)
    select employee_id,work_date from public.schedules
    where work_date >= p_effective_date and work_date >= v_month_start and work_date < v_month_next
    union
    select employee_id,work_date from public.extra_schedules
    where work_date >= p_effective_date and work_date >= v_month_start and work_date < v_month_next
    on conflict do nothing;
  end if;

  update schedule_import_scope s
  set protected=true
  where exists (
    select 1 from public.attendance a
    where a.employee_id=s.employee_id and a.work_date=s.work_date
      and (a.clock_in is not null or a.clock_out is not null)
  );

  select count(*) into v_protected from schedule_import_scope where protected;

  for v_group in
    select employee_id,work_date from schedule_import_scope where not protected order by work_date,employee_id
  loop
    -- Re-check immediately before mutation so preview/apply races fail safe.
    if exists (
      select 1 from public.attendance a
      where a.employee_id=v_group.employee_id and a.work_date=v_group.work_date
        and (a.clock_in is not null or a.clock_out is not null)
    ) then
      v_protected := v_protected + 1;
      continue;
    end if;

    select * into v_first
    from schedule_import_desired d
    where d.employee_id=v_group.employee_id and d.work_date=v_group.work_date
    order by d.scheduled_start,d.scheduled_end,d.row_no
    limit 1;

    select * into v_base
    from public.schedules s
    where s.employee_id=v_group.employee_id and s.work_date=v_group.work_date
    order by s.created_at,s.id
    limit 1
    for update;

    if v_first.row_no is null then
      if coalesce(p_authoritative,false) then
        if v_base.id is not null then
          delete from public.task_assignments
          where schedule_id=v_base.id and source_type = 'checklist' and status = 'pending';
          delete from public.schedules where id=v_base.id;
        end if;
        delete from public.extra_schedules
        where employee_id=v_group.employee_id and work_date=v_group.work_date;
        v_applied := v_applied + 1;
      end if;
      v_first := null;
      v_base := null;
      continue;
    end if;

    if v_base.id is null then
      insert into public.schedules(employee_id,work_date,scheduled_start,scheduled_end,shift_type)
      values(v_group.employee_id,v_group.work_date,v_first.scheduled_start,v_first.scheduled_end,v_first.shift_type);
    else
      update public.schedules
      set scheduled_start=v_first.scheduled_start,
          scheduled_end=v_first.scheduled_end,
          shift_type=case when v_first.shift_type='other' then coalesce(v_base.shift_type,'other') else v_first.shift_type end
      where id=v_base.id;
    end if;

    delete from public.extra_schedules
    where employee_id=v_group.employee_id and work_date=v_group.work_date;

    insert into public.extra_schedules(employee_id,work_date,scheduled_start,scheduled_end,shift_type,updated_at)
    select employee_id,work_date,scheduled_start,scheduled_end,shift_type,now()
    from (
      select d.*,row_number() over(order by d.scheduled_start,d.scheduled_end,d.row_no) as rn
      from schedule_import_desired d
      where d.employee_id=v_group.employee_id and d.work_date=v_group.work_date
    ) ordered
    where rn>1;

    v_applied := v_applied + 1;
    v_first := null;
    v_base := null;
  end loop;

  return jsonb_build_object(
    'ok',true,
    'appliedGroups',v_applied,
    'protectedGroups',v_protected,
    'targetMonth',p_target_month,
    'effectiveDate',p_effective_date
  );
exception when others then
  raise exception 'schedule import failed: %', sqlerrm;
end;
$$;

revoke all on function public.apply_schedule_import(text,date,boolean,jsonb) from public;
revoke all on function public.apply_schedule_import(text,date,boolean,jsonb) from anon;
revoke all on function public.apply_schedule_import(text,date,boolean,jsonb) from authenticated;
grant execute on function public.apply_schedule_import(text,date,boolean,jsonb) to service_role;
