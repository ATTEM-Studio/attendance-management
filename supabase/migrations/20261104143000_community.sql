create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  author_employee_id uuid references public.employees(id) on delete set null,
  author_name_snapshot text not null,
  category text not null check (category in ('attendance_issue','inventory_issue','personal_note','suggestion','general')),
  visibility text not null default 'community' check (visibility in ('community','admin_only')),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 2000),
  work_date date,
  attendance_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open','reviewing','resolved')),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.community_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  author_type text not null check (author_type in ('staff','admin')),
  author_employee_id uuid references public.employees(id) on delete set null,
  author_name_snapshot text not null,
  body text not null check (char_length(body) between 1 and 1500),
  created_at timestamptz not null default now()
);

create index if not exists community_posts_created_idx
  on public.community_posts(created_at desc);
create index if not exists community_posts_author_idx
  on public.community_posts(author_employee_id, created_at desc);
create index if not exists community_posts_status_idx
  on public.community_posts(status, created_at desc);
create index if not exists community_comments_post_idx
  on public.community_comments(post_id, created_at asc);

alter table public.community_posts enable row level security;
alter table public.community_comments enable row level security;

revoke all on table public.community_posts from anon, authenticated;
revoke all on table public.community_comments from anon, authenticated;
grant select, insert, update, delete on table public.community_posts to service_role;
grant select, insert, update, delete on table public.community_comments to service_role;
