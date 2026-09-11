drop index if exists public.attendance_one_open_session_per_employee_idx;

create unique index attendance_one_open_session_per_employee_idx
on public.attendance (employee_id, work_date)
where clock_in is not null
  and clock_out is null;

create or replace function public.record_attendance_action_v3(p_employee_id uuid, p_action text)
returns attendance
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_now timestamptz := now();
  v_today date := (timezone('Asia/Seoul', now()))::date;
  v_open public.attendance%rowtype;
  v_record public.attendance%rowtype;
  v_latest public.attendance%rowtype;
  v_schedule public.schedules%rowtype;
  v_next_session integer;
  v_completed_today integer := 0;
  v_minutes integer := 0;
  v_schedule_start timestamptz;
  v_schedule_end timestamptz;
begin
  if p_action not in ('clock_in','clock_out','start_extra','cancel_clock_out') then
    raise exception 'invalid_action';
  end if;

  perform 1
  from public.employees
  where id = p_employee_id
  for update;
  if not found then
    raise exception 'employee_not_found';
  end if;

  select * into v_open
  from public.attendance
  where employee_id = p_employee_id
    and work_date = v_today
    and clock_in is not null
    and clock_out is null
  order by work_date desc, session_no desc
  limit 1
  for update;

  if p_action in ('clock_in','start_extra') and v_open.id is not null then
    raise exception 'another_session_open';
  end if;

  if p_action = 'clock_in' then
    if exists (
      select 1
      from public.attendance
      where employee_id = p_employee_id
        and work_date = v_today
    ) then
      raise exception 'base_session_already_exists';
    end if;

    select * into v_schedule
    from public.schedules
    where employee_id = p_employee_id
      and work_date = v_today
    limit 1;

    insert into public.attendance (
      employee_id, work_date, session_no, session_type,
      clock_in, break_minutes, work_minutes,
      late_minutes, early_leave_minutes, overtime_minutes,
      clock_out_cancel_count, updated_at
    ) values (
      p_employee_id, v_today, 1, 'base',
      v_now, 0, 0,
      case when v_schedule.id is not null then
        greatest(
          0,
          floor(
            extract(epoch from (
              v_now - ((v_today + v_schedule.scheduled_start) at time zone 'Asia/Seoul')
            )) / 60
          )
        )::integer
      else 0 end,
      0, 0, 0, v_now
    )
    returning * into v_record;

    return v_record;
  end if;

  if p_action = 'start_extra' then
    select count(*)::integer into v_completed_today
    from public.attendance
    where employee_id = p_employee_id
      and work_date = v_today
      and clock_in is not null
      and clock_out is not null;

    if v_completed_today = 0 then
      raise exception 'extra_requires_completed_session';
    end if;

    select coalesce(max(session_no),0) + 1 into v_next_session
    from public.attendance
    where employee_id = p_employee_id
      and work_date = v_today;

    insert into public.attendance (
      employee_id, work_date, session_no, session_type,
      clock_in, break_minutes, work_minutes,
      late_minutes, early_leave_minutes, overtime_minutes,
      clock_out_cancel_count, updated_at
    ) values (
      p_employee_id, v_today, v_next_session, 'extra',
      v_now, 0, 0,
      0, 0, 0,
      0, v_now
    )
    returning * into v_record;

    insert into public.attendance_events (
      employee_id, attendance_id, work_date, event_type,
      previous_value, new_value, actor_type, actor_employee_id, created_at
    ) values (
      p_employee_id, v_record.id, v_today, 'extra_work_started',
      null, v_record.clock_in, 'staff', p_employee_id, v_now
    );

    return v_record;
  end if;

  if p_action = 'clock_out' then
    if v_open.id is null then
      raise exception 'clock_in_required';
    end if;

    v_minutes := greatest(
      0,
      floor(extract(epoch from (v_now - v_open.clock_in)) / 60)
    )::integer;

    if v_open.session_type = 'base' then
      select * into v_schedule
      from public.schedules
      where employee_id = p_employee_id
        and work_date = v_open.work_date
      limit 1;

      if v_schedule.id is not null then
        v_schedule_start := ((v_open.work_date + v_schedule.scheduled_start) at time zone 'Asia/Seoul');
        v_schedule_end := ((v_open.work_date + v_schedule.scheduled_end) at time zone 'Asia/Seoul');
      end if;
    end if;

    update public.attendance
    set clock_out = v_now,
        break_start = null,
        break_end = null,
        break_minutes = 0,
        work_minutes = v_minutes,
        late_minutes = case
          when v_open.session_type = 'extra' then 0
          when v_schedule_start is not null then greatest(0, floor(extract(epoch from (v_open.clock_in - v_schedule_start)) / 60))::integer
          else 0
        end,
        early_leave_minutes = case
          when v_open.session_type = 'extra' then 0
          when v_schedule_end is not null then greatest(0, floor(extract(epoch from (v_schedule_end - v_now)) / 60))::integer
          else 0
        end,
        overtime_minutes = case
          when v_open.session_type = 'extra' then 0
          when v_schedule_end is not null then greatest(0, floor(extract(epoch from (v_now - v_schedule_end)) / 60))::integer
          else 0
        end,
        updated_at = v_now
    where id = v_open.id
    returning * into v_record;

    return v_record;
  end if;

  if v_open.id is not null then
    raise exception 'another_session_open';
  end if;

  select * into v_latest
  from public.attendance
  where employee_id = p_employee_id
    and work_date = v_today
    and clock_out is not null
  order by session_no desc
  limit 1
  for update;

  if v_latest.id is null then
    select * into v_record
    from public.attendance
    where employee_id = p_employee_id
      and clock_out is not null
    order by work_date desc, session_no desc
    limit 1;

    if v_record.id is not null and v_record.work_date <> v_today then
      raise exception 'clock_out_cancel_same_day_only';
    end if;
    raise exception 'attendance_not_found';
  end if;

  if v_latest.clock_out_cancel_count >= 1 then
    raise exception 'clock_out_cancel_limit';
  end if;

  insert into public.attendance_events (
    employee_id, attendance_id, work_date, event_type,
    previous_value, new_value, actor_type, actor_employee_id, created_at
  ) values (
    p_employee_id, v_latest.id, v_latest.work_date, 'clock_out_cancelled',
    v_latest.clock_out, null, 'staff', p_employee_id, v_now
  );

  update public.attendance
  set clock_out = null,
      clock_out_cancel_count = clock_out_cancel_count + 1,
      last_clock_out_cancelled_at = v_now,
      work_minutes = 0,
      early_leave_minutes = 0,
      overtime_minutes = 0,
      updated_at = v_now
  where id = v_latest.id
  returning * into v_record;

  return v_record;
end;
$function$;
