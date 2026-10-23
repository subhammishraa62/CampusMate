import assert from "node:assert/strict";
import { findDuplicatePlanningTask, normalizePlanningTaskTitle } from "../lib/planning/duplicate-task";

const existing = [
  { id: 12, title: "Finish Applied Physics assignment — Demo", done: true, courseId: "phy101-id", deadlineDate: "2026-10-23", deadlineTime: "22:00" },
];
const sameTask = { title: "Finish Applied Physics assignment–DEMO", courseId: "phy101-id", deadlineDate: "2026-10-23", deadlineTime: "22:00" };
assert.equal(normalizePlanningTaskTitle(existing[0].title), normalizePlanningTaskTitle(sameTask.title));
assert.equal(findDuplicatePlanningTask(existing, sameTask)?.id, 12, "should find completed tasks with dash/case/spacing differences");
assert.equal(findDuplicatePlanningTask(existing, { ...sameTask, deadlineDate: "2026-10-24" }), undefined, "different due dates may represent a new occurrence");
assert.equal(findDuplicatePlanningTask(existing, { ...sameTask, courseId: "chemistry-id" }), undefined, "different saved courses may represent different tasks");
assert.equal(findDuplicatePlanningTask([], sameTask), undefined, "does not invent a duplicate when no task exists");

console.log("PASS: duplicate task detection normalizes demo labels and punctuation, includes completed tasks, and respects explicit course/date differences");
