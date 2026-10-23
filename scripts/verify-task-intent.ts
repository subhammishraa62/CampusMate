import assert from "node:assert/strict";
import { parseTaskIntent } from "../lib/planning/action-parser";

const now = new Date(2026, 9, 23, 11, 49);
const basic = parseTaskIntent(
  "I have to complete my physics assignment by 10 PM today. It will take around two hours.",
  { now, preferredStart: "17:00", preferredEnd: "21:00" },
);
assert.ok(basic, "an explicit action request should produce a proposed task");
assert.equal(basic.title, "Complete physics assignment");
assert.equal(basic.deadlineDate, "2026-10-23");
assert.equal(basic.deadlineTime, "22:00");
assert.equal(basic.durationMinutes, 120);
assert.equal(basic.durationEstimated, false);
assert.equal(basic.scheduledDate, "2026-10-23");
assert.equal(basic.startTime, "17:00");
assert.equal(basic.endTime, "19:00");

const tomorrow = parseTaskIntent(
  "I have an assignment due tomorrow and need a realistic plan around my lectures.",
  { now, preferredStart: "17:00", preferredEnd: "21:00" },
);
assert.ok(tomorrow, "assignment deadline phrasing should be actionable");
assert.equal(tomorrow.title, "Assignment");
assert.equal(tomorrow.durationEstimated, true);
assert.equal(tomorrow.deadlineDate, "2026-10-24");
assert.equal(tomorrow.scheduledDate, "2026-10-23", "prepare today for a task due tomorrow");

const avoidsConflicts = parseTaskIntent(
  "Finish my chemistry assignment by 10 PM today. It will take one hour.",
  {
    now,
    preferredStart: "17:00",
    preferredEnd: "21:00",
    tasks: [{ scheduledDate: "2026-10-23", startTime: "18:00", endTime: "19:00", duration: "1 hr" }],
    classes: [{ starts_at: "2026-10-23T17:00:00", ends_at: "2026-10-23T18:00:00" }],
  },
);
assert.ok(avoidsConflicts?.canSchedule);
assert.equal(avoidsConflicts.startTime, "19:00", "suggested block should avoid existing tasks and classes");

assert.equal(
  parseTaskIntent("Help me balance study time, proper breaks, and a little exercise today.", { now }),
  null,
  "general planning prompts should not create a made-up task",
);


const linkedCourse = parseTaskIntent(
  "Finish my physics assignment by 10 PM today. It will take two hours.",
  { now, preferredStart: "17:00", preferredEnd: "21:00", courses: [{ id: "physics-course-id", title: "Applied Physics" }] },
);
assert.ok(linkedCourse, "a course-specific task should be parsed");
assert.equal(linkedCourse.courseId, "physics-course-id", "clear subject mention should link to the matching saved course");
assert.equal(linkedCourse.courseTitle, "Applied Physics");

const ambiguousCourses = parseTaskIntent(
  "Finish my physics assignment by 10 PM today.",
  { now, courses: [{ id: "physics-a", title: "Physics I" }, { id: "physics-b", title: "Physics II" }] },
);
assert.ok(ambiguousCourses);
assert.equal(ambiguousCourses.courseId, null, "ambiguous subjects should not be linked automatically");

console.log("PASS: explicit task extraction, deadlines, duration, conflict-aware scheduling, course linking, ambiguous-course safety, and general-prompt safety");
