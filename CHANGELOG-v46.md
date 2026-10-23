# v46 — Class editor navigation fix

- Fixed the class edit action to scroll directly to the class editing form rather than to the document top.
- Focuses the class title input after navigation without triggering another scroll.
- Shows an edit-mode notice and visual highlight so the selected record and save action are clear.
- Makes schedule Edit Class and Remove buttons explicitly `type="button"`.
- Preserves the selected class session ID and populated fields so saving updates the existing record.
- Adds static verification checks for the edit-form navigation behavior.

## Verification

Passed `verify:schedule-edit`, `verify:local`, `verify:resources`, and `verify:integrations` scripts. A production build/typecheck has not been run in this container because project npm dependencies are not installed here.
