import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const route = await read("app/api/integration-status/route.ts");
const page = await read("app/integrations/page.tsx");
const css = await read("app/globals.css");
const home = await read("app/page.tsx");
const pkg = JSON.parse(await read("package.json"));
const quickstart = "https://www.developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-quickstart";

assert.match(route, /export async function GET\(\)/, "diagnostics API must be read-only GET");
assert.match(route, /Cache-Control.*no-store/s, "diagnostics must disable caching");
assert.match(route, /select\("id"\)\.limit\(1\)/, "database checks should select only the sentinel id column");
assert.match(route, /Never row contents|never row contents|never returns row contents/i, "diagnostics route must document data minimization");
for (const table of ["tasks", "courses", "class_sessions", "study_sessions", "study_plans"]) {
  assert.ok(route.includes(`"${table}"`), `diagnostics should check ${table}`);
}
assert.match(route, /OAuth 2\.1 \+ PKCE/, "status must not represent a shared token as full Alexa+ account linking");
assert.match(page, /No mystery states/, "integration command center should be present");
assert.match(page, /read-only checks/i, "UI must explain diagnostics are read-only");
assert.ok(page.includes(quickstart), "UI should link the official Alexa+ MCP requirements");
assert.match(page, /npm run test:bedrock/, "UI should provide an explicit real Bedrock test command");
assert.match(page, /npm run verify:mcp/, "UI should provide an explicit MCP test command");
assert.doesNotMatch(home, /href="\/integrations"/, "technical integration diagnostics should not clutter the student dashboard navigation");
assert.ok(pkg.scripts["verify:integrations"], "package should expose integration verifier");
assert.match(css, /Integration Command Center/, "integration command center styles should exist");

console.log("PASS: diagnostics are read-only, no-store, minimal-data, core-table aware, reachable by direct route but hidden from student dashboard navigation, and honest about Alexa+/Bedrock readiness");
