# CampusMate v50 — Batch task planning

## What changed

- Planning Studio can extract up to eight explicit tasks from one natural-language request, including requests separated by sentences, commas, semicolons, or list lines. Supporting duration sentences stay attached to their task.
- The batch review shows each task's title, detected deadline, estimated duration, matched course, and proposed work block. Titles, deadlines, durations, and course associations can be edited before saving.
- Batch scheduling reserves each accepted proposal block before placing the next proposal, and checks existing scheduled tasks and saved class sessions to reduce overlaps. Future-day requests such as “tomorrow” can be scheduled on that date.
- “Recheck all times” recalculates the proposals after edits. The user can create all tasks and schedule available blocks, or add all tasks without scheduled times. Nothing is saved until the user confirms.
- Duplicate tasks, including completed tasks, are skipped in the batch creation handler. Tasks that have no available conflict-free block can still be added unscheduled.
- Added `npm run verify:batch-planning` for focused batch extraction and scheduling checks. Existing single-task Planning Studio flow remains available.

## Testing

- `lib/planning/action-parser.ts` passed strict TypeScript compilation and the batch parser runtime examples passed.
- `app/page.tsx` and the new verification script passed TypeScript/JSX syntax transpilation.
- Full Next.js typecheck and production build have not been completed in this environment because project dependencies are not installed here. Run `npm install`, `npm run typecheck`, and `npm run build` locally before deployment.
