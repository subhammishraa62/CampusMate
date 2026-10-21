-- Tighten owner checks on references for existing CampusMate projects.
-- Apply after 20261020_add_study_sessions_and_api_permissions.sql.
-- The API performs the same checks; these policies also defend direct Supabase access.

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
