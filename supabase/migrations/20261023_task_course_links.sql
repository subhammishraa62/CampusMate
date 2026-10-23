-- v43: allow AI/manual planner tasks to link to a saved course.
-- Safe to run on an existing CampusMate database more than once.
alter table public.tasks
  add column if not exists course_id uuid references public.courses(id) on delete set null;

create index if not exists tasks_user_course_idx on public.tasks(user_id, course_id);
