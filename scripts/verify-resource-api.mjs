import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const routes = {
  courses: await read("app/api/courses/route.ts"),
  classSessions: await read("app/api/class-sessions/route.ts"),
  studySessions: await read("app/api/study-sessions/route.ts"),
  studyPlans: await read("app/api/study-plans/route.ts"),
};
for (const [name, source] of Object.entries(routes)) {
  assert.match(source, /requireUser\(\)/, `${name} must require an authenticated user`);
  assert.match(source, /user_id", auth\.user\.id/, `${name} must scope reads or writes to the authenticated owner`);
  assert.match(source, /Cache-Control|jsonNoStore/, `${name} should avoid cached personal data`);
}
assert.match(routes.courses, /export async function (GET|POST|PATCH|DELETE)/);
assert.match(routes.classSessions, /ends_at.*starts_at|The end must be after the start/s);
assert.match(routes.classSessions, /selected course does not belong to this account/);
assert.match(routes.studySessions, /duration_seconds/);
assert.match(routes.studySessions, /Finish or cancel your current focus session/, "focus API should stop accidental duplicate running sessions");
assert.match(routes.studyPlans, /100 KB maximum/);
const resourcePage = await read("app/resources/page.tsx");
assert.match(resourcePage, /\/api\/courses/, "resource page should be wired to course APIs");
assert.match(resourcePage, /\/api\/class-sessions/, "resource page should be wired to class APIs");
assert.match(resourcePage, /\/api\/study-sessions/, "resource page should be wired to focus-session APIs");
assert.match(resourcePage, /\/api\/study-plans/, "resource page should be wired to saved-plan APIs");
assert.match(resourcePage, /Finish session/, "resource page should support finishing focus sessions");
const home = await read("app/page.tsx");
assert.match(home, /href="\/resources"/, "home sidebar should link to the resource workspace");
const schema = await read("supabase/schema.sql");
for (const table of ["courses", "class_sessions", "study_sessions", "study_plans"]) {
  assert.match(schema, new RegExp(`create table if not exists public\\.${table}\\b`), `${table} table must exist in schema`);
  assert.match(schema, new RegExp(`alter table public\\.${table} enable row level security`), `${table} must have RLS enabled`);
}
assert.match(schema, /class_sessions\.course_id[\s\S]*courses c/, "class-session RLS should validate course ownership");
assert.match(schema, /study_sessions\.task_id[\s\S]*tasks t/, "focus-session RLS should validate task ownership");
assert.match(schema, /plan_items\.plan_id[\s\S]*study_plans p/, "plan-item RLS should validate plan ownership");
console.log("PASS: resource API ownership, validation, UI wiring, navigation, no-store, and schema/RLS checks");
