import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = readFileSync(resolve("app/resources/page.tsx"), "utf8");
const css = readFileSync(resolve("app/globals.css"), "utf8");
const checks = [
  ["Schedule entries have an explicit EDIT CLASS control", page.includes(">EDIT CLASS</button>")],
  ["Schedule edit control has an accessible label", page.includes("aria-label={`Edit schedule entry ${item.title}`}")],
  ["Schedule editing opens the existing edit form", page.includes("onClick={() => editClassSession(item)}")],
  ["Editing scrolls directly to the class form instead of the page top", page.includes("classFormRef.current?.scrollIntoView({ behavior: \"smooth\", block: \"center\" })") && !page.includes("function editClassSession(item: ClassSession) {\n    setSection(\"courses\"); setClassSessionId(item.id); setClassTitle(item.title); setClassCourseId(item.course_id ?? \"\"); setClassLocation(item.location ?? \"\");\n    setClassStart(localDateTimeFromIso(item.starts_at)); setClassEnd(localDateTimeFromIso(item.ends_at));\n    window.scrollTo({ top: 0, behavior: \"smooth\" });\n  }")],
  ["The class editor announces edit mode and highlights the form", page.includes("resource-class-editing-note") && page.includes("classSessionId ? \"is-editing\" : \"\"")],
  ["Edit controls are explicit buttons, not accidental submit controls", page.includes("type=\"button\" className=\"resource-action-button resource-action-edit\"")],
  ["Course and schedule actions use a grouped action container", page.includes('className="resource-record-actions"')],
  ["Action controls have visible focus styling", css.includes(".resource-record-actions .resource-action-button:focus-visible")],
  ["Mobile action controls wrap below the record details", css.includes(".resource-record-actions{grid-column:2;justify-content:flex-start;margin-top:4px}")],
];
let failed = false;
for (const [label, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
  if (!passed) failed = true;
}
if (failed) process.exit(1);
