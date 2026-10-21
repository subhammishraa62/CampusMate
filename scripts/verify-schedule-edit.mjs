import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = readFileSync(resolve("app/resources/page.tsx"), "utf8");
const css = readFileSync(resolve("app/globals.css"), "utf8");
const checks = [
  ["Schedule entries have an explicit EDIT CLASS control", page.includes(">EDIT CLASS</button>")],
  ["Schedule edit control has an accessible label", page.includes("aria-label={`Edit schedule entry ${item.title}`}")],
  ["Schedule editing opens the existing edit form", page.includes("onClick={() => editClassSession(item)}")],
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
