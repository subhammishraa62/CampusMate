import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const resources = await read("app/resources/page.tsx");
const home = await read("app/page.tsx");
const planner = await read("lib/planning/engine.ts");

assert.match(resources, /campusmate-resources-v1/, "resources should have a versioned local browser store");
assert.match(resources, /setAccessState\("local"\)/, "resources should fall back to local mode when cloud reads fail");
assert.match(resources, /async function resourceRequest/, "resource mutations should use a local/cloud adapter");
for (const path of ["\/api\/courses", "\/api\/class-sessions", "\/api\/study-sessions", "\/api\/study-plans"]) {
  assert.ok(resources.includes(path), `resource workspace should support ${path}`);
}
assert.match(resources, /Export local backup/, "local demo mode should expose a backup export");
assert.match(resources, /importLocalBackup/, "local demo mode should support restoring a backup");
assert.match(resources, /file\.size > 5_000_000/, "backup import should enforce a file-size limit");
assert.match(resources, /function editClassSession/, "class sessions should be editable in the workspace");
assert.match(resources, /function editPlan/, "saved plans should be editable in the workspace");
assert.match(resources, /campusmate:resources-updated/, "resource changes should notify the same-tab dashboard");
assert.match(home, /loadLearningSchedule/, "the dashboard should load saved class sessions");
assert.match(home, /campusmate-resources-v1/, "the dashboard should use local resources when Supabase is unavailable");
assert.match(home, /tasks: plannerTasks/, "daily planning and MCP test should receive today's saved classes");
assert.match(home, /scheduleEntries\.map/, "schedule UI should be data-driven rather than hard-coded sample rows");
assert.match(home, /Date\.parse\(a\.starts_at\) - Date\.parse\(b\.starts_at\)/, "today's saved classes should be ordered chronologically");
assert.match(planner, /Fixed classes are commitments to protect/, "planner should avoid recommending classes as tasks to start");
assert.match(planner, /Protect the fixed parts of today/, "class-only plans should protect fixed commitments");

console.log("PASS: browser-local CRUD, guarded backup import/export, editable classes and plans, same-tab dashboard updates, schedule bridge, and fixed-commitment planner checks");
