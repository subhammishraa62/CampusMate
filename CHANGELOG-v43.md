# CampusMate v43 — Course-aware AI planning

- AI Planning Studio now receives a separate compact context snapshot of saved courses and upcoming fixed class sessions (without polluting the student’s own prompt or rules-based summary). Saved class sessions remain protected when proposing a study block.
- Explicit academic requests are matched to a saved course when the subject/course name is clear; ambiguous matches remain unlinked instead of guessing. The course can be changed from the planning preview before creation.
- AI-created tasks retain a `courseId` locally and display their linked course in Tasks and Schedule. Course IDs are persisted to Supabase through a new nullable `tasks.course_id` column.
- Added migration `supabase/migrations/20261023_task_course_links.sql`; run it in the Supabase SQL Editor before using cloud course-linked tasks. `supabase/schema.sql` includes the column for fresh installs.
- API validation verifies linked course ownership in a single batched lookup before saving (avoiding one database request per task).

## Quick verification

- `npm run verify:task-intent` — intent/date/duration/conflict parser tests.
- `npm run verify:planning-workflow` — AI Planning Studio action wiring.
- `npm run typecheck` and `npm run build` — run on the target machine with dependencies installed.
