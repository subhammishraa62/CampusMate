# CampusMate v55 — Safe batch scheduling

## Fixed
- Batch planner no longer treats persisted schedule blocks as free merely because their linked task is marked complete. The Schedule UI continues to display those entries, so proposed tasks now respect them too.
- Both the proposal-time scheduler and the final create-time conflict guard use the same conservative rule for any persisted task block.
- If a day has no free block, the planner searches later dates: through the deadline when one is known, or up to seven days for tasks without a deadline. It will not schedule past the deadline.
- Scheduling notes now display the actual date of a moved block, not the original target date.

## Safety behaviour
- Duplicate tasks are still skipped and do not get a new schedule block.
- Tasks without a conflict-free block can still be added to Tasks only.
- No data is saved until the user chooses an action in the review UI.

## Verification
- Updated the batch-planning regression test to cover completed-but-still-scheduled tasks.
- Full production build should be run locally before submission.
