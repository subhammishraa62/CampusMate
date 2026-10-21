import assert from "node:assert/strict";
import { buildRuleBasedBrief, sanitizePlannerTasks } from "../lib/planning/engine";

const tasks = sanitizePlannerTasks([
  { id: 1, title: "Finish DSA assignment", detail: "Trees and BSTs", time: "10:30 AM", duration: "35 min", priority: "Today", done: false, kind: "study" },
  { id: 2, title: "Physics lecture", detail: "Block C", time: "11:30 AM", duration: "1 hr", priority: "Today", done: false, kind: "class" },
  { id: 3, title: "Submit lab observation", detail: "Applied Physics", time: "1:00 PM", duration: "25 min", priority: "Today", done: false, kind: "study" },
  { id: 4, title: "Lunch break", detail: "Step away", time: "1:30 PM", duration: "40 min", priority: "Whenever", done: false, kind: "life" },
]);

assert.equal(tasks.length, 4, "valid tasks should be kept");
assert.equal(tasks[0].id, "1", "task ids should be normalized to strings");

const brief = buildRuleBasedBrief(tasks, "Low energy today");
assert.equal(brief.engine, "rules", "the baseline planner should identify its engine");
assert.ok(brief.priorityTaskId, "an open task should be recommended");
assert.equal(brief.plan.length, 3, "the draft should contain three plan items");
assert.equal(brief.nextSteps.length, 3, "the draft should contain three next steps");
assert.ok(brief.reason.includes("Low energy today"), "student context should inform the explanation");

const clearBrief = buildRuleBasedBrief(tasks.map((task) => ({ ...task, done: true })));
assert.equal(clearBrief.priorityTaskId, null, "a completed list should not recommend an open task");
assert.equal(clearBrief.priorityTitle, "Nothing urgent is waiting");

const fixedOnly = buildRuleBasedBrief([
  { id: "class-1", title: "Physics lecture", detail: "Room 204", time: "11:30 AM", duration: "1 hr", priority: "Today", done: false, kind: "class" },
  { id: "class-2", title: "Programming lab", detail: "Lab 3", time: "2:00 PM", duration: "90 min", priority: "Today", done: false, kind: "class" },
]);
assert.equal(fixedOnly.priorityTaskId, null, "fixed commitments alone must not be recommended as a task to start");
assert.equal(fixedOnly.headline, "Protect the fixed parts of today.");
assert.ok(fixedOnly.plan[0].title.includes("Physics lecture"), "fixed-only plans should protect a class commitment");
const mixed = buildRuleBasedBrief([
  { id: "class-1", title: "Physics lecture", detail: "Room 204", time: "11:30 AM", duration: "1 hr", priority: "Today", done: false, kind: "class" },
  { id: "study-1", title: "Finish DSA assignment", detail: "Trees", time: "Not scheduled", duration: "35 min", priority: "Today", done: false, kind: "study" },
]);
assert.equal(mixed.priorityTitle, "Finish DSA assignment", "a flexible academic task should be preferred over a fixed class");

assert.throws(() => sanitizePlannerTasks({ title: "not a list" }), /array of up to 40/i);
assert.throws(() => sanitizePlannerTasks([{ id: 1, title: "  " }]), /needs a title/i);

console.log("CampusMate planner smoke test: PASS");
console.log(`Validated ${tasks.length} sample tasks, generated ${brief.plan.length} plan items, and checked empty-list and invalid-input handling.`);
