create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

create table public.notification_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  enabled boolean not null default true,
  failure_count integer not null default 0 check (failure_count >= 0),
  last_success_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notification_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_key text not null unique,
  type text not null check (type in ('missing_clock_in','missing_clock_out','stale_open','required_checklist')),
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date date not null,
  attendance_id uuid references public.attendance(id) on delete set null,
  severity text not null check (severity in ('warning','danger')),
  title text not null,
  body text not null,
  status text not null default 'open' check (status in ('open','resolved')),
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  push_sent_at timestamptz,
  resolved_at timestamptz
);

create index notification_alerts_open_idx on public.notification_alerts(status, work_date desc);

alter table public.notification_subscriptions enable row level security;
alter table public.notification_alerts enable row level security;
