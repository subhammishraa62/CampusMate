-- CampusMate profile customization, true task scheduling fields, and priority levels.
-- Run this in the Supabase SQL Editor for an existing installation.

alter table public.profiles add column if not exists college text not null default '';
alter table public.profiles add column if not exists branch text not null default '';
alter table public.profiles add column if not exists semester text not null default '';
alter table public.profiles add column if not exists bio text not null default '';
alter table public.profiles add column if not exists study_goal_hours numeric not null default 3;
alter table public.profiles add column if not exists preferred_start time not null default '17:00';
alter table public.profiles add column if not exists preferred_end time not null default '21:00';
alter table public.profiles add column if not exists avatar_url text not null default '';
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check (auth.uid() = id);

alter table public.tasks add column if not exists scheduled_date date;
alter table public.tasks add column if not exists start_time time;
alter table public.tasks add column if not exists end_time time;
alter table public.tasks add column if not exists deadline_date date;
alter table public.tasks add column if not exists deadline_time time;
alter table public.tasks add column if not exists reminder_minutes integer;

-- Map the legacy urgency-as-date labels to the nearest new priority.
alter table public.tasks drop constraint if exists tasks_priority_check;
update public.tasks set priority = case priority when 'Today' then 'High' when 'Soon' then 'Medium' when 'Whenever' then 'Low' else priority end;
alter table public.tasks alter column priority set default 'Medium';
alter table public.tasks add constraint tasks_priority_check check (priority in ('Low', 'Medium', 'High'));
alter table public.tasks drop constraint if exists tasks_reminder_minutes_check;
alter table public.tasks add constraint tasks_reminder_minutes_check check (reminder_minutes is null or reminder_minutes in (0, 15, 30, 60, 1440));

-- Public profile pictures; uploads are restricted to a folder named after the signed-in user id.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-avatars', 'profile-avatars', true, 8388608, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = true, file_size_limit = 8388608, allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif'];

drop policy if exists "profile_avatars_public_read" on storage.objects;
create policy "profile_avatars_public_read" on storage.objects for select using (bucket_id = 'profile-avatars');
drop policy if exists "profile_avatars_insert_own_folder" on storage.objects;
create policy "profile_avatars_insert_own_folder" on storage.objects for insert to authenticated with check (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "profile_avatars_update_own_folder" on storage.objects;
create policy "profile_avatars_update_own_folder" on storage.objects for update to authenticated using (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = auth.uid()::text) with check (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "profile_avatars_delete_own_folder" on storage.objects;
create policy "profile_avatars_delete_own_folder" on storage.objects for delete to authenticated using (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
