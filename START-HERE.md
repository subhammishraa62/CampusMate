# CampusMate AI v37 — Integration Command Center

This is an incremental version built from v36. It preserves the Living Sky dashboard, browser-local learning space, Supabase APIs, planner, Bedrock fallback, and existing MCP tools. The main new feature is `/integrations`: a read-only integration health page that helps you distinguish setup, sign-in, database schema, model-access, and remote Alexa+ gaps without showing secrets or personal database rows.

## 1. Run it safely

Open the extracted folder in VS Code. In PowerShell:

```powershell
npm install
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local } else { Write-Host "Keeping your existing .env.local. Review new settings manually." }
npm run verify:all
npm run typecheck
npm run dev
```

Open these pages:

- `http://localhost:3000` — main dashboard
- `http://localhost:3000/auth` — sign-in/sign-up
- `http://localhost:3000/resources` — courses, editable class sessions, focus sessions, and saved study plans
- `http://localhost:3000/integrations` — read-only configuration/session/table checks

In a second terminal, while the dev server is running:

```powershell
npm run verify:mcp
```

The static verifiers and local MCP verifier test different things; a successful static check is not the same as a successful live integration.

## 2. Supabase: check it in order

1. Preserve your existing `.env.local`. Check `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Never use a service-role key as a `NEXT_PUBLIC_*` key.
2. If this is a new, empty CampusMate database, run `supabase/schema.sql` in the Supabase SQL Editor. If it already contains data, back it up first and apply only migrations not yet applied. Do not blindly run the full schema against an existing database.
3. For an existing v32/v33 database missing the changes, inspect and apply these only if not already applied, in order:
   - `supabase/migrations/20261020_add_study_sessions_and_api_permissions.sql`
   - `supabase/migrations/20261020_harden_resource_ownership.sql`
4. Sign in at `/auth`, open `/integrations`, and click **RUN CHECKS**. It tests authenticated read access to `tasks`, `courses`, `class_sessions`, `study_sessions`, and `study_plans`, selecting only IDs and returning status—not rows.
5. Open `/resources`, create a test course and class, edit the class, refresh, and confirm it persists. Test focus session lifecycle and saved plan edits too.
6. To validate isolation, use a second test account and confirm it cannot read, edit, or delete the first account's rows. Don't run this test using important personal data.

Local browser demo data and Supabase cloud data are intentionally separate. Import/export is explicit; do not expect local records to move into the cloud automatically.

## 3. Bedrock: keep the AWS blocker contained

Your latest status was that the Nova quota request is pending and both the CLI and Playground returned `Operation not allowed`. Keep this setting while AWS resolves it:

```env
BEDROCK_ENABLED=false
AWS_REGION=ap-south-1
BEDROCK_MODEL_ID=global.amazon.nova-2-lite-v1:0
```

Do not replace the entire `.env.local`—preserve the Supabase variables. The Integration Command Center does not invoke a model. After AWS approves the request, run this real test from the project directory:

```powershell
npm run test:bedrock
```

Only set `BEDROCK_ENABLED=true` after that test succeeds. If it still returns `Operation not allowed`, treat that as an AWS access/account issue; don't keep switching model IDs. Global inference can route to supported AWS Regions worldwide, so don't choose the Global profile if India-only processing is a requirement. A real Bedrock test may incur a small usage charge.

## 4. MCP and Alexa+: what is done vs what remains

Local endpoint: `http://localhost:3000/api/mcp` using Streamable HTTP.

Tools exposed: `get_today_overview`, `list_tasks`, `get_schedule`, `suggest_daily_plan`, `update_task`.

Test the local MCP handshake and tool listing/call with:

```powershell
npm run verify:mcp
```

A pass proves local MCP protocol and tool behavior. It does not prove that Alexa+ is connected.

**Important production gap:** The current `CAMPUSMATE_MCP_TOKEN` is a shared development gate, not Alexa+ account linking. Amazon's current MCP QuickStart requires a remotely reachable HTTPS endpoint and a supported OAuth 2.1 authorization-code + PKCE (`S256`) flow with resource metadata/account-linking requirements. That is why `/integrations` reports remote Alexa+ as not yet verified. Before allowing remote clients to access or mutate student-specific records, implement the current supported auth flow and map every remote identity to one Supabase user server-side. Do not use a service-role key to bypass RLS.

Read `docs/ALEXAPLUS_MCP_READINESS.md` for the current researched checklist and official references.

## 5. Tests

```powershell
npm run verify:all
npm run typecheck
npm run build
npm run dev
# second terminal
npm run verify:mcp
```

`verify:all` runs the planner smoke test and structural checks for resource ownership, local mode, schedule editing, and integration diagnostics. `typecheck` and `build` are separate checks and should both pass before deploying. Live Supabase, AWS, and Alexa+ tests need your configured services.

## 6. What v37 adds

- Integration Command Center at `/integrations` linked from the dashboard.
- Read-only `/api/integration-status`, with no-store responses and minimal table access checks.
- Safe diagnostics that do not output user IDs, rows, tokens, or raw database error contents.
- Explicitly honest readiness status: config flags are not runtime proof; local MCP is not full Alexa+; enabling Bedrock isn't proof of an invocation succeeding.
- `npm run verify:integrations` and `npm run verify:all`.
- Researched Alexa+ MCP remote-auth checklist in `docs/ALEXAPLUS_MCP_READINESS.md`.

## Official references

- Amazon Alexa+ MCP QuickStart: https://www.developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-quickstart
- Amazon Alexa+ MCP lifecycle: https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-client-lifecycle
- Supabase Server-Side Auth: https://supabase.com/docs/guides/auth/server-side
