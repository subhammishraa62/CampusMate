-- CampusMate v33 migration for an existing Supabase project.
-- Safe to run more than once. RLS remains the source of row ownership enforcement.
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

create index if not exists study_sessions_user_started_idx on public.study_sessions(user_id, started_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists study_sessions_set_updated_at on public.study_sessions;
create trigger study_sessions_set_updated_at before update on public.study_sessions for each row execute procedure public.set_updated_at();

alter table public.study_sessions enable row level security;
drop policy if exists "study_sessions_own_all" on public.study_sessions;
create policy "study_sessions_own_all" on public.study_sessions for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.study_sessions to authenticated;
