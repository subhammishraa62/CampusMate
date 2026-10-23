import assert from "node:assert/strict";
import { parseTaskIntents, splitTaskIntentClauses } from "../lib/planning/action-parser";

const now = new Date(2026, 9, 23, 11, 49);
const prompt = "I need to finish my physics assignment by 10 PM today. It will take around two hours. Practice DSA for an hour tomorrow, and complete my calculus problems by Sunday. Also remind me to prepare for my chemistry quiz.";
const clauses = splitTaskIntentClauses(prompt);
assert.equal(clauses.length, 4, "should split four explicit task requests and attach duration context to the physics assignment");
const proposals = parseTaskIntents(prompt, {
  now,
  preferredStart: "17:00",
  preferredEnd: "21:00",
  courses: [
    { id: "physics-id", title: "Applied Physics", course_code: "PHY101" },
    { id: "dsa-id", title: "Data Structures and Algorithms", course_code: "CSE201" },
    { id: "math-id", title: "Mathematics" },
    { id: "chem-id", title: "Chemistry" },
  ],
  classes: [{ title: "Physics Lecture", course_id: "physics-id", starts_at: new Date(2026, 9, 23, 18, 0).toISOString(), ends_at: new Date(2026, 9, 23, 19, 0).toISOString() }],
});
assert.equal(proposals.length, 4, "all explicit task requests should create preview proposals");
assert.equal(proposals[0].title, "Finish physics assignment");
assert.equal(proposals[0].durationMinutes, 120, "supplemental duration sentence should stay attached to task one");
assert.equal(proposals[0].deadlineTime, "22:00");
assert.equal(proposals[0].courseId, "physics-id");
assert.equal(proposals[1].title, "Practice DSA");
assert.equal(proposals[1].targetDate, "2026-10-24", "an unspecific deadline phrase like 'tomorrow' should schedule the task tomorrow");
assert.equal(proposals[1].startTime, "17:00");
assert.equal(proposals[2].courseId, "math-id");
assert.equal(proposals[3].courseId, "chem-id");

// Every scheduled batch block must avoid the fixed class and every earlier proposal.
const scheduled = proposals.filter((p) => p.canSchedule);
for (let i = 0; i < scheduled.length; i++) {
  const current = scheduled[i];
  const start = Number(current.startTime.slice(0, 2)) * 60 + Number(current.startTime.slice(3, 5));
  const end = Number(current.endTime.slice(0, 2)) * 60 + Number(current.endTime.slice(3, 5));
  if (current.scheduledDate === "2026-10-23") {
    assert.ok(end <= 18 * 60 || start >= 19 * 60, "same-day study block must avoid the 6–7 PM class");
  }
  for (const other of scheduled.slice(0, i)) {
    if (other.scheduledDate !== current.scheduledDate) continue;
    const otherStart = Number(other.startTime.slice(0, 2)) * 60 + Number(other.startTime.slice(3, 5));
    const otherEnd = Number(other.endTime.slice(0, 2)) * 60 + Number(other.endTime.slice(3, 5));
    assert.ok(end <= otherStart || start >= otherEnd, "batch proposal blocks must not overlap each other");
  }
}

assert.equal(parseTaskIntents("Help me balance study time, proper breaks, and a little exercise today.", { now }).length, 0,
  "a general planning request should not invent a batch of tasks");

const plainStudy = parseTaskIntents("Study DSA tomorrow for one hour and revise physics notes tonight for 30 minutes.", {
  now, preferredStart: "17:00", preferredEnd: "21:00",
  courses: [{ id: "dsa-id", title: "Data Structures and Algorithms", course_code: "CSE201" }, { id: "physics-id", title: "Applied Physics" }],
});
assert.equal(plainStudy.length, 2, "bare 'study' verbs should also become actionable tasks");
assert.match(plainStudy[0].title, /Study DSA/i);
assert.equal(plainStudy[0].durationMinutes, 60);
assert.match(plainStudy[1].title, /Revise physics notes/i);
assert.equal(plainStudy[1].durationMinutes, 30);

// Existing duplicates must not reserve a new block or display an unrelated course.
const duplicateAware = parseTaskIntents(prompt.replace("my physics assignment", "my Applied Physics assignment"), {
  now,
  preferredStart: "17:00",
  preferredEnd: "21:00",
  tasks: [{
    title: "Finish Applied Physics assignment — Demo",
    courseId: "physics-id",
    deadlineDate: "2026-10-23",
    deadlineTime: "22:00",
    scheduledDate: "2026-10-23",
    startTime: "19:00",
    endTime: "21:00",
    duration: "2 hrs",
    done: true,
    kind: "study",
  }],
  courses: [
    { id: "physics-id", title: "Applied Physics", course_code: "PHY101" },
    { id: "dsa-id", title: "Data Structures and Algorithms", course_code: "CSE201" },
    { id: "math-id", title: "Mathematics" },
    { id: "chem-id", title: "Chemistry" },
  ],
  classes: [{ title: "Physics Lecture", course_id: "physics-id", starts_at: new Date(2026, 9, 23, 18, 0).toISOString(), ends_at: new Date(2026, 9, 23, 19, 0).toISOString() }],
});
assert.equal(duplicateAware[0].canSchedule, false, "existing duplicate should not show a new proposed work block");
assert.equal(duplicateAware[0].startTime, "", "existing duplicate should not reserve a proposed time");
assert.equal(duplicateAware[0].courseId, "physics-id", "duplicate inherits its existing course association when extraction is ambiguous");
for (const proposal of duplicateAware.slice(1).filter((p) => p.canSchedule)) {
  const start = Number(proposal.startTime.slice(0, 2)) * 60 + Number(proposal.startTime.slice(3, 5));
  const end = Number(proposal.endTime.slice(0, 2)) * 60 + Number(proposal.endTime.slice(3, 5));
  if (proposal.scheduledDate === "2026-10-23") {
    assert.ok(end <= 18 * 60 || start >= 19 * 60, "new same-day batch blocks must avoid the saved 6–7 PM class after duplicate filtering");
    assert.ok(end <= 19 * 60 || start >= 21 * 60, "new blocks must not overlap a persisted scheduled block even when its task is completed");
  }
  assert.ok(proposal.scheduledDate !== "2026-10-23" || !(start < 21 * 60 && end > 19 * 60), "no new same-day block may occupy the existing 7–9 PM scheduled task block");
}

console.log("PASS: multi-task extraction, editable preview data, per-task course matching, date/duration parsing, and duplicate skipping, course inheritance, class-safe non-overlapping proposal scheduling");
