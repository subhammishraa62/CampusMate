-- CampusMate AI initial schema
-- Run this in Supabase SQL Editor for a fresh project.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Student',
  course text not null default 'Student',
  year_of_study integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  title text not null check (char_length(title) between 1 and 180),
  detail text not null default '' check (char_length(detail) <= 300),
  scheduled_time text not null default 'Not scheduled',
  duration text not null default '30 min',
  priority text not null default 'Soon' check (priority in ('Today', 'Soon', 'Whenever')),
  is_done boolean not null default false,
  kind text not null default 'study' check (kind in ('study', 'class', 'life')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 140),
  course_code text,
  instructor text,
  color_token text not null default 'lavender',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  title text not null check (char_length(title) between 1 and 180),
  location text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  recurrence_rule text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id text,
  course_id uuid references public.courses(id) on delete set null,
  title text not null check (char_length(title) between 1 and 180),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  status text not null default 'running' check (status in ('running', 'completed', 'cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);

create table if not exists public.study_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_date date not null default current_date,
  title text not null default 'Daily plan',
  summary text not null default '',
  status text not null default 'draft' check (status in ('draft', 'accepted', 'archived')),
  source text not null default 'rules' check (source in ('rules', 'ai')),
  plan_data jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.plan_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.study_plans(id) on delete cascade,
  task_id text,
  title text not null,
  detail text not null default '',
  starts_at timestamptz,
  ends_at timestamptz,
  item_order integer not null default 0,
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'done', 'skipped')),
  created_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Planning conversation',
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_user_updated_idx on public.tasks(user_id, updated_at desc);
create index if not exists class_sessions_user_start_idx on public.class_sessions(user_id, starts_at);
create index if not exists study_sessions_user_started_idx on public.study_sessions(user_id, started_at desc);
create index if not exists study_plans_user_date_idx on public.study_plans(user_id, plan_date desc);
create index if not exists plan_items_plan_order_idx on public.plan_items(plan_id, item_order);
create index if not exists ai_conversations_user_updated_idx on public.ai_conversations(user_id, updated_at desc);

-- A profile is created automatically when a student signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1), 'Student')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Keep updated_at current on updates.
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();
drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at before update on public.tasks for each row execute procedure public.set_updated_at();
drop trigger if exists courses_set_updated_at on public.courses;
create trigger courses_set_updated_at before update on public.courses for each row execute procedure public.set_updated_at();
drop trigger if exists class_sessions_set_updated_at on public.class_sessions;
create trigger class_sessions_set_updated_at before update on public.class_sessions for each row execute procedure public.set_updated_at();
drop trigger if exists study_sessions_set_updated_at on public.study_sessions;
create trigger study_sessions_set_updated_at before update on public.study_sessions for each row execute procedure public.set_updated_at();
drop trigger if exists study_plans_set_updated_at on public.study_plans;
create trigger study_plans_set_updated_at before update on public.study_plans for each row execute procedure public.set_updated_at();
drop trigger if exists ai_conversations_set_updated_at on public.ai_conversations;
create trigger ai_conversations_set_updated_at before update on public.ai_conversations for each row execute procedure public.set_updated_at();

-- Row Level Security: each student can only access rows bearing their own auth UID.
alter table public.profiles enable row level security;
alter table public.tasks enable row level security;
alter table public.courses enable row level security;
alter table public.class_sessions enable row level security;
alter table public.study_sessions enable row level security;
alter table public.study_plans enable row level security;
alter table public.plan_items enable row level security;
alter table public.ai_conversations enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select to authenticated using (auth.uid() = id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "tasks_select_own" on public.tasks;
create policy "tasks_select_own" on public.tasks for select to authenticated using (auth.uid() = user_id);
drop policy if exists "tasks_insert_own" on public.tasks;
create policy "tasks_insert_own" on public.tasks for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "tasks_update_own" on public.tasks;
create policy "tasks_update_own" on public.tasks for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "tasks_delete_own" on public.tasks;
create policy "tasks_delete_own" on public.tasks for delete to authenticated using (auth.uid() = user_id);

-- Apply the same ownership rule to every remaining user-owned table.
drop policy if exists "courses_own_all" on public.courses;
create policy "courses_own_all" on public.courses for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "class_sessions_own_all" on public.class_sessions;
create policy "class_sessions_own_all" on public.class_sessions for all to authenticated
  using (
    auth.uid() = user_id and
    (course_id is null or exists (select 1 from public.courses c where c.id = class_sessions.course_id and c.user_id = auth.uid()))
  )
  with check (
    auth.uid() = user_id and
    (course_id is null or exists (select 1 from public.courses c where c.id = class_sessions.course_id and c.user_id = auth.uid()))
  );
drop policy if exists "study_sessions_own_all" on public.study_sessions;
create policy "study_sessions_own_all" on public.study_sessions for all to authenticated
  using (
    auth.uid() = user_id and
    (course_id is null or exists (select 1 from public.courses c where c.id = study_sessions.course_id and c.user_id = auth.uid())) and
    (task_id is null or exists (select 1 from public.tasks t where t.id = study_sessions.task_id and t.user_id = auth.uid()))
  )
  with check (
    auth.uid() = user_id and
    (course_id is null or exists (select 1 from public.courses c where c.id = study_sessions.course_id and c.user_id = auth.uid())) and
    (task_id is null or exists (select 1 from public.tasks t where t.id = study_sessions.task_id and t.user_id = auth.uid()))
  );
drop policy if exists "study_plans_own_all" on public.study_plans;
create policy "study_plans_own_all" on public.study_plans for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "plan_items_own_all" on public.plan_items;
create policy "plan_items_own_all" on public.plan_items for all to authenticated
  using (
    auth.uid() = user_id and
    exists (select 1 from public.study_plans p where p.id = plan_items.plan_id and p.user_id = auth.uid()) and
    (task_id is null or exists (select 1 from public.tasks t where t.id = plan_items.task_id and t.user_id = auth.uid()))
  )
  with check (
    auth.uid() = user_id and
    exists (select 1 from public.study_plans p where p.id = plan_items.plan_id and p.user_id = auth.uid()) and
    (task_id is null or exists (select 1 from public.tasks t where t.id = plan_items.task_id and t.user_id = auth.uid()))
  );
drop policy if exists "ai_conversations_own_all" on public.ai_conversations;
create policy "ai_conversations_own_all" on public.ai_conversations for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- Explicit grants complement RLS. RLS still limits every row to its owning student.
grant select, insert, update, delete on public.profiles, public.tasks, public.courses, public.class_sessions, public.study_sessions, public.study_plans, public.plan_items, public.ai_conversations to authenticated;
