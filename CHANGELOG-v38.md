# CampusMate v38 — Student-first workflow

## Added
- Low / Medium / High priorities; existing legacy tasks normalize to the closest equivalent.
- Separate planned date, start/end time, deadline date/time, and reminder lead-time fields.
- Native calendar/time pickers and clearer task editor styling.
- In-tab browser notifications for due reminders with configurable lead times and a once-per-deadline guard.
- Account-backed profile customization (name, college, degree, branch, year, semester, bio, study goal, preferred study hours) and Supabase Storage avatar upload.
- Daily motivational quote selection with a manual refresh action.
- Compact Today page with top-three previews, collapsible detailed intelligence, and course/class preview from the resources workspace.
- Technical Integration Health removed from student-facing navigation while diagnostics code remains in the project.
- Compact Resources panel no longer shows the CM circle mark.
- Convert an accepted planner recommendation into a task only if no same-title task exists.

## Setup / limitations
- Apply `supabase/migrations/20261023_profile_deadlines_priorities.sql` to an existing Supabase project.
- Browser notifications work while a CampusMate tab is open and permission is granted; closed-app push delivery is not configured.
- No GitHub push or deployment was performed as part of this ZIP export.

### TypeScript compatibility fix
- Updated the local Resources API adapter cast to pass through `unknown` before the generic return type, resolving TS2352 in `app/resources/page.tsx` without changing runtime behavior.

## v39 UI corrections (2026-10-23)
- Combined Courses and Class Schedule into one Courses & Classes workspace so course records and their linked class sessions are managed on the same page.
- Made the task editor and profile editor reliably scroll within the viewport, including on shorter screens and mobile.
- Extended Sky Purple palette styling to task form inputs, selects, deadline panels, helper blocks, and the Courses & Classes resource workspace. The resource page now reads the saved Daylight / Sky Purple preference.
- Kept class editing in the combined Courses & Classes workspace.


## v40 UI fixes (2026-10-23)
- Fixed the underlying specificity conflict that kept the task editor from scrolling in Sky Purple: the theme's shared `.add-modal` rule set `overflow: hidden`, overriding the intended editor scroll. The task dialog now uses a dedicated viewport-safe flex wrapper and explicitly scrolls vertically.
- Reworked the Today-page “Courses and campus” learning preview so the outer panel, inner cards, headings, labels, course chips, descriptions, and links inherit Sky Purple colors instead of retaining the pale Daylight palette.
