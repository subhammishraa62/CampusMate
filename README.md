# CampusMate AI v36 — Local-first learning space + planner integration

This version starts from the exact v31 Living Sky stylesheet and preserves the existing dashboard, themes, atmosphere, and transitions. It adds a real backend slice for the Alexa+ track using a **Streamable HTTP MCP server** and **Amazon Bedrock** for optional runtime AI. No OpenAI SDK or OpenAI API is used in this version.

## What's included

- Preserves the v31 CampusMate dashboard, Daylight / Sky Purple themes, moving sky effects, and cinematic tab transitions.
- Daily Intelligence Brief backed by a deterministic TypeScript planner, with optional Amazon Bedrock natural-language planning through the AWS SDK for JavaScript v3 Converse API.
- Self-hosted MCP server at `POST/GET/DELETE /api/mcp` over Streamable HTTP, using the current MCP TypeScript SDK server package. It supports the current protocol era and stateless legacy clients including the hackathon's minimum MCP version.
- Five MCP tools: `get_today_overview`, `list_tasks`, `get_schedule`, `suggest_daily_plan`, and confirmation-gated `update_task`.
- An in-app **Run Alexa+ MCP test** control. It creates a real MCP client, completes the protocol handshake, lists tools, and calls tools over HTTP using the MCP client SDK. It is not a mocked button animation.
- Supabase SSR authentication and owner-scoped cloud task sync, plus authenticated CRUD API routes for courses, class sessions, study sessions, and saved study plans. The `/resources` workspace works in two explicit modes: cloud-backed for a signed-in student with Supabase configured, or browser-local demo mode when Supabase is unavailable. Local mode supports create/edit/delete courses, create/edit/delete classes, start/finish focus sessions, create/edit/accept/archive/delete plans, and export a JSON backup. Course and schedule actions are now high-contrast pill buttons with accessible labels; the schedule uses an explicit **EDIT CLASS** control that loads the selected entry back into the form, and action controls wrap below the details on small screens.
- Saved class sessions now appear in the dashboard's data-driven schedule and today's planner input. Fixed classes are treated as commitments to protect rather than tasks to start, including days with no flexible task remaining.
- Health/configuration endpoint at `/api/health`.
- Safe deterministic fallback if Bedrock is disabled, unavailable, or returns invalid output.

## Requirements

- Node.js 20 LTS recommended.
- An AWS account with Amazon Bedrock available in a region and access enabled for the chosen model if you want live AI responses.
- Optional Supabase project for sign-in and persistent cloud tasks.

## Run locally on Windows PowerShell

```powershell
npm install
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local } else { Write-Host "Keeping existing .env.local; review new settings manually." }
npm run smoke:planner
npm run verify:resources
npm run verify:local
npm run verify:schedule-edit
npm run dev
```

Then open `http://localhost:3000`. Without AWS and Supabase configuration, the dashboard, rules-based planner, local MCP test, and the `/resources` local demo workspace remain usable. Local resource data is stored in this browser only; export a JSON backup from `/resources` before clearing browser storage or changing machines. The Alexa+ MCP route allows localhost requests without a token only while running in development mode.

## Enable Amazon Bedrock Nova 2 Lite

1. Configure AWS credentials using the AWS CLI (for example `aws configure` for a local development profile, or IAM Identity Center if that is how your account is set up). Avoid committing long-lived keys.
2. Verify the selected AWS identity in a terminal with `aws sts get-caller-identity`.
3. In `.env.local`, set:

   ```env
   AWS_REGION=ap-south-1
   BEDROCK_MODEL_ID=global.amazon.nova-2-lite-v1:0
   BEDROCK_ENABLED=false
   ```

4. Keep `BEDROCK_ENABLED=false` until the connectivity test succeeds. Confirm that the model is available to your account in that region and that the identity has permission to invoke it (including `bedrock:InvokeModel`).
5. Run `npm run test:bedrock` to send a small real Converse request. If it succeeds, set `BEDROCK_ENABLED=true` and restart `npm run dev`. Then, in Today → Daily Intelligence, click **Refresh intelligence**. When Bedrock is configured and the call succeeds, the engine badge changes to `BEDROCK-ASSISTED` and the note identifies the region/model. If Bedrock cannot be used, the endpoint falls back to the rules-based brief and shows a safe explanation.

The default is Amazon Nova 2 Lite through the Global cross-Region inference profile (`global.amazon.nova-2-lite-v1:0`) initiated from Mumbai (`ap-south-1`). Global inference can route requests to supported AWS Regions worldwide; do not use this profile if you require strict India-only processing. A model change will not bypass an account-level Bedrock restriction. Use `npm run test:bedrock` to make a real test request after setting up authentication and permissions; it may incur a small usage charge. Availability, pricing, IAM permission, and account access must still be verified in your AWS account. AWS SDK credentials are read server-side through the normal credential provider chain; no AWS credentials are exposed through `NEXT_PUBLIC_*` variables or sent to the browser.

Official AWS references:
- Bedrock Converse API examples: https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/javascript_bedrock-runtime_code_examples.html
- Amazon Nova model IDs and Converse API: https://docs.aws.amazon.com/nova/latest/userguide/using-converse-api.html

## Enable Supabase accounts and persistent tasks

1. Create a Supabase project.
2. Put the project URL and publishable key in `.env.local`:

   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
   ```

3. Open the Supabase SQL Editor and run `supabase/schema.sql`.
4. In Supabase Authentication settings, set the local Site URL to `http://localhost:3000`. Configure email confirmation according to your demo needs.
5. Restart the development server, open the account control at the bottom of the CampusMate sidebar, and sign in. When a valid session exists, `/api/tasks` loads and syncs tasks belonging to that user, subject to Row Level Security policies.

### Manage courses, classes, focus sessions, and plans

Open `http://localhost:3000/resources` (also linked from the left sidebar). In local demo mode, it supports browser-local resource management without credentials. After signing in and applying the schema, the same interface uses the cloud APIs. The workspace supports:

- Create, edit, and delete courses.
- Create, edit, and delete class sessions with validated timestamps and optional course links.
- Start, complete, or cancel focus sessions; duration is calculated by the server when a session ends.
- Save or edit a rules-based plan draft, accept it, archive it, or delete it.

Cloud resource operations use the authenticated Supabase session and never use a service-role key. If Supabase is missing, a sign-in is absent, or a resource fetch is unavailable, `/resources` switches to clearly labelled browser-local mode instead of blocking the workflow. Local resources do not sync to Supabase and are not sent to another user account; use the explicit JSON backup export to move local demo data. Existing v32 projects should apply `supabase/migrations/20261020_add_study_sessions_and_api_permissions.sql` and then `supabase/migrations/20261020_harden_resource_ownership.sql`; fresh projects should run `supabase/schema.sql`.

Do not put a Supabase service-role key in the browser or in a `NEXT_PUBLIC_*` variable. The current web task sync uses the authenticated user's Supabase session and RLS.

## Alexa+ MCP endpoint

Endpoint: `http://localhost:3000/api/mcp`

The endpoint implements Streamable HTTP using `@modelcontextprotocol/server`. It registers these tools at runtime:

| Tool | Purpose |
|---|---|
| `get_today_overview` | Counts open/completed tasks and returns a next-best-move suggestion. |
| `list_tasks` | Filters open/completed/all tasks, with optional kind filtering. |
| `get_schedule` | Lists the planner's scheduled items in chronological order. It does not claim to query an external calendar. |
| `suggest_daily_plan` | Produces a draft plan using Bedrock when enabled, with a deterministic fallback. |
| `update_task` | First returns a preview. It requires `confirmed: true` before attempting the update. An authenticated web session updates that user's Supabase row; without a signed-in session, it updates only the in-memory demo workspace. |

The in-app MCP test actually connects with `@modelcontextprotocol/client`, completes the MCP handshake, calls `tools/list`, then calls `list_tasks`, `get_today_overview`, and `suggest_daily_plan`. It shows the result under the brief.

### Production MCP protection

Before deploying, set a long random bearer token and explicit allowed host/origin hostnames, for example:

```env
CAMPUSMATE_MCP_TOKEN=REPLACE_WITH_A_LONG_RANDOM_SECRET
MCP_ALLOWED_HOSTS=your-app.example.com
MCP_ALLOWED_ORIGINS=your-app.example.com
```

Set the real deployed hostname(s), not the example domain. The MCP route fails closed in production when the token is missing. If `CAMPUSMATE_MCP_TOKEN` is set locally, the in-app test automatically supplies it server-side.

The MCP endpoint uses a shared bearer gate in this starter. A remote MCP client using that token but without a Supabase user session sees the demo workspace, not an arbitrary student's private records. The in-memory demo workspace is intentionally non-durable across server restarts/deployments. For a multi-user production Alexa+ integration, add a proper per-user OAuth/resource-server flow before allowing remote clients to access or mutate user data; do not solve that by exposing a service-role key.

Official MCP references:
- TypeScript SDK Streamable HTTP server: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/http.md
- TypeScript SDK client connection: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/clients/connect.md

## Endpoints

- `GET /api/health` — reports configuration flags only; it does not prove credentials work.
- `POST /api/intelligence-brief` — validates a task snapshot and returns a Bedrock-assisted brief or a deterministic rules-based fallback.
- `GET /api/tasks` / `PUT /api/tasks` — authenticated, owner-scoped Supabase task sync.
- `GET/POST/PATCH/DELETE /api/courses` — authenticated course CRUD.
- `GET/POST/PATCH/DELETE /api/class-sessions` — authenticated class schedule CRUD; validates time ranges and course ownership.
- `GET/POST/PATCH /api/study-sessions` — authenticated focus-session lifecycle with duration tracking.
- `GET/POST/PATCH/DELETE /api/study-plans` — authenticated saved-plan CRUD, with a 100 KB plan-data limit.
- `GET/POST/DELETE /api/mcp` — Streamable HTTP MCP server.
- `POST /api/mcp-demo` — internal real MCP client workflow used by the dashboard's verification control.

## Verification checklist

```powershell
npm run smoke:planner
npm run typecheck
npm run build
npm run dev
# in a second terminal, while the app is running:
npm run verify:mcp
npm run verify:resources
```

Manual browser checks:
1. Run `npm run smoke:planner` and confirm it prints `PASS`.
2. Open Today and click **Run Alexa+ MCP test**. Look for `STREAMABLE HTTP · CONNECTED` and three successful tool calls.
3. Click **Refresh intelligence** with Bedrock disabled; expect a deterministic brief and a note explaining how to enable Bedrock.
4. Configure AWS credentials and enable Bedrock; click refresh again and verify that the badge says `BEDROCK-ASSISTED` if the model call succeeds.
5. Change a task, then run the MCP test again to confirm the plan uses the current visible task snapshot.
6. After Supabase is configured, use the resource API endpoints to create a course, class session, study session, and saved plan; verify each remains after refresh and cannot be accessed by a different account.
7. Check Sky Purple/Daylight and switch all tabs to ensure the visual foundation is intact.

## v33 API examples (requires a signed-in Supabase session)

Create a course:

```http
POST /api/courses
Content-Type: application/json

{"title":"Data Structures","course_code":"CSE-201","color_token":"lavender"}
```

Create a class session (use a course ID returned by `/api/courses`, or omit `course_id`):

```http
POST /api/class-sessions
Content-Type: application/json

{"title":"Data Structures lecture","starts_at":"2026-10-21T04:30:00Z","ends_at":"2026-10-21T05:30:00Z","location":"Block C"}
```

Start and complete a focus session:

```http
POST /api/study-sessions
Content-Type: application/json

{"title":"DSA focused practice","task_id":"your-task-id","notes":"BST deletion practice"}

PATCH /api/study-sessions
Content-Type: application/json

{"id":"returned-session-uuid","ended_at":"2026-10-21T05:15:00Z"}
```

Save a planner draft:

```http
POST /api/study-plans
Content-Type: application/json

{"title":"Wednesday plan","plan_date":"2026-10-21","source":"rules","status":"draft","plan_data":[{"title":"Review BST deletion","minutes":35}]}
```

All these routes use the signed-in user's Supabase session and filter reads/updates/deletes by `user_id`; they do not use a service-role key. They are backend APIs in this version and are not yet wired into dedicated course/session management screens.

## Current limitations (intentional and documented)

- The planning engine handles task priorities and duration heuristics; it does not invent hard deadlines or assert that it has full calendar availability.
- Bedrock runtime calls require AWS credentials, model access in the selected region, and `BEDROCK_ENABLED=true`; those settings are not included in the ZIP.
- The MCP server is real and uses Streamable HTTP, but non-authenticated external callers are limited to the demo workspace. A production multi-user Alexa+ setup needs per-user authorization and durable storage for remote tool calls.
- The existing Planning Studio conversational panel still contains frontend demo interactions; the Daily Intelligence Brief and MCP tools are the wired server-side intelligence slice in this version.
- The account, task-sync, and resource APIs need your own Supabase project configuration before cloud persistence will activate. The resource management UI is available at `/resources`; authenticated database behavior still needs to be verified against your own project.

## v37 Integration Command Center

Visit `/integrations` for safe, read-only status checks across Supabase configuration/session/core table access and honest Bedrock/MCP readiness notes. The endpoint never returns table row contents or raw database errors. Use `npm run verify:integrations` for static checks and `npm run verify:all` for the local static suite.

**Alexa+ status:** Streamable HTTP and local tools exist, but the shared-token starter does not implement Alexa+'s current OAuth 2.1 + PKCE/account-linking requirements. Review `docs/ALEXAPLUS_MCP_READINESS.md` before remote deployment. Do not treat local MCP success as proof of Alexa+ connectivity.
