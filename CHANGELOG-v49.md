# CampusMate v49 — AI task duplicate protection

## What changed

- Planning Studio compares proposed tasks against existing tasks before presenting creation actions.
- Task-title matching ignores case, punctuation, different dash styles, and a trailing `Demo`/`Copy` label, which fixes the duplicate found during the fresh-account test.
- Completed tasks are checked too. A repeat request for an already completed task offers to reopen/update that existing task instead of silently creating another copy.
- If course IDs or explicit deadline dates conflict, matching is skipped so a legitimate separate assignment/course occurrence can still be created.
- The creation handler performs the same duplicate guard as a second line of defence.
- Added focused verification examples for normalization, completed-task matches, and differing deadline/course values.

## Testing

- Planning workflow, resources API, schedule edit, integrations, student experience, and local-mode static verification scripts passed in the build environment.
- The duplicate matching helper compiled with TypeScript and its runtime examples passed.
- Full Next.js production build was not run in this environment because project dependencies are not installed here.
