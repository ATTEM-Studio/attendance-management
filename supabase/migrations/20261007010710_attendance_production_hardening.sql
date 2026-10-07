-- Production hardening: cover foreign keys reported by Supabase advisors.
create index if not exists app_sessions_employee_id_idx
  on public.app_sessions(employee_id);

create index if not exists attendance_events_actor_employee_id_idx
  on public.attendance_events(actor_employee_id);

create index if not exists audit_logs_attendance_id_idx
  on public.audit_logs(attendance_id);

create index if not exists audit_logs_employee_id_idx
  on public.audit_logs(employee_id);

create index if not exists checklist_overrides_attendance_id_idx
  on public.checklist_overrides(attendance_id);

create index if not exists notification_alerts_attendance_id_idx
  on public.notification_alerts(attendance_id);

create index if not exists notification_alerts_employee_id_idx
  on public.notification_alerts(employee_id);

create index if not exists schedule_import_aliases_employee_id_idx
  on public.schedule_import_aliases(employee_id);

create index if not exists task_assignments_template_id_idx
  on public.task_assignments(template_id);

create index if not exists task_assignments_template_item_id_idx
  on public.task_assignments(template_item_id);

create index if not exists task_records_task_id_idx
  on public.task_records(task_id);

delete from public.app_sessions where expires_at < now();

select cron.schedule(
  'attendance-cleanup-expired-sessions',
  '15 18 * * *',
  $$delete from public.app_sessions where expires_at < now();$$
);
