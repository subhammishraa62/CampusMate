# CampusMate v48 — Explicit schedule time ranges

- Schedule timeline entries now display the full start–end time range when both times are available (for example, `7:00–9:00 PM`) rather than showing only the start time next to a duration.
- Scheduled tasks also show their explicit time range in the task metadata while retaining the duration label.
- Saved class sessions carry start and end times into the timeline presentation.
- Preserves the Gemini integration, fallback behavior, class editing, task/course association, and existing data model.

## Setup
Reuse the existing `.env.local` securely. Keep the Gemini API key server-side and preserve existing Supabase values. Then run `npm install` and `npm run dev`.
- The Today dashboard's compact schedule list also displays the end time (compact same-period ranges such as `7:00–9:00 PM`) instead of only the start time.
