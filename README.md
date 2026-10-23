# CampusMate AI — v56

CampusMate combines Gemini-assisted planning with Tasks, Schedule, Courses & sessions, batch task review, duplicate protection, and a rules-based fallback.

## Run locally

- Copy `.env.example` to `.env.local` only if you do not already have an `.env.local` file. Preserve existing Supabase variables and add your Gemini API key privately.
- Install dependencies with `npm install`.
- Start with `npm run dev`, then open `http://localhost:3000`.
- Never expose `GEMINI_API_KEY` to browser code or commit `.env.local` to source control.

## v54 batch scheduling safeguards

- Refreshes current courses and classes before planning.
- Rechecks all batch times when requested.
- Checks overlaps against classes, scheduled tasks, and previously accepted blocks in the current batch.
- At final save, a conflicting proposed block is omitted while the task itself can still be created unscheduled.
- Existing duplicates continue to be skipped.

See `CHANGELOG-v54.md` for details.

## v53 update

This build keeps the v50 batch task planner and the v51/v52 Gemini failover/timeout work, with an additional fix for duplicate batch items and schedule validation. Existing duplicates show no new time block, inherit the existing course link where available, and are not reserved when scheduling later new tasks. New batch blocks are recalculated against saved classes and previously proposed blocks.

Keep your existing `.env.local` private and copy it into this project folder. Run `npm install` if needed, then `npm run dev`. A full production build has not been completed in this environment; verify the app locally before the demo.

# CampusMate AI v51 — Gemini failover, batch task planning, and duplicate protection

This version preserves the existing dashboard, themes, student planner, and Streamable HTTP MCP endpoint. It supports **Google Gemini as an external AI provider**, optional Amazon Bedrock when available, and a rules-based fallback when no provider is configured. Gemini does not require AWS Bedrock access.

## v51: Gemini model failover

Gemini briefs and chat now make bounded attempts across the configured primary model and up to two alternate model IDs to handle temporary 429/503 responses. Default alternates are `gemini-3.5-flash-lite` and `gemini-3.8-flash`. If every candidate fails, CampusMate keeps the deterministic local fallback so the UI stays usable. Live provider availability still depends on Google's service capacity and your API key access.

## v50: Batch task planning

- Enter multiple task requests in one AI Command Center prompt. Planning Studio extracts up to eight explicit task actions.
- Review each task title, deadline date/time, duration, course association, and proposed work block before saving.
- Click **Recheck all times** after editing a deadline or duration. CampusMate recalculates proposed blocks around saved class sessions and existing scheduled tasks, including blocks for “tomorrow”.
- **Create all tasks & schedule available blocks** creates the reviewed batch and schedules tasks with conflict-free blocks; tasks with no available slot are still added unscheduled. **Add all to Tasks only** keeps every new task flexible.
- Existing duplicates are skipped, including completed tasks, and tasks are not created until a batch action is confirmed.
- Run `npm run verify:batch-planning` for focused batch planner checks.

## v49: Duplicate-safe AI task creation

- Before displaying task-creation actions, Planning Studio checks whether the proposed assignment already exists, including completed tasks. It normalizes capitalization, punctuation, dash styles, and a trailing `Demo`/`Copy` label.
- When a match exists, CampusMate hides the create-new-task buttons and offers to reopen/update the existing task and schedule, or view the existing task.
- Explicitly different deadlines or course associations are treated as potentially separate occurrences.
- The final task creation handler repeats the duplicate check to protect against accidental duplicate clicks.
- Run `npm run verify:duplicate-prevention` to check the targeted examples.

## v48: Show start–end ranges in Schedule

- Scheduled tasks show an explicit range such as `7:00–9:00 PM` in the full Schedule timeline instead of only `7:00 PM` alongside `2 hrs`.
- The Today dashboard shows compact start–end times, and scheduled task metadata shows the range while retaining duration.
- Saved class entries carry their actual start and end times into the Schedule timeline.
- This is a display enhancement; it does not modify stored schedules or AI behavior.

## v47: Gemini requests stop hanging

- Gemini calls time out after 15 seconds with automatic retries disabled for demo responsiveness.
- Gemini 3.8 Flash uses low thinking effort, JSON output mode for planning briefs, and no unsupported temperature parameter.
- The client stops waiting after 40 seconds and releases loading state with a clear message.
- Provider errors log a sanitized status/code/message for troubleshooting; API-key-like values are redacted.

## v46: Reliable Edit Class workflow

- Fixed the Edit Class control so it scrolls directly to the class form instead of jumping to the top of the page.
- The class editor now focuses the title field, highlights edit mode, and clearly explains that changes are not saved until Save changes is clicked.
- Made Edit Class and Remove controls explicit buttons to avoid accidental form submission.
- Keeps the existing class ID populated during editing so the form updates the selected session instead of adding a duplicate.

## v45: Use Google Gemini without AWS Bedrock

- Add `GEMINI_API_KEY` in `.env.local` to enable AI-generated daily briefs, MCP planning suggestions, and the Talk it through chat using Google Gemini.
- Gemini is preferred when configured; if it fails, enabled Bedrock can be tried next; if no AI provider succeeds, CampusMate uses its deterministic planner.
- The Gemini key is server-side only and must never use a `NEXT_PUBLIC_` prefix.
- Task extraction and conflict-aware course/schedule linking continue to use CampusMate's validated local planner; AI recommendations do not silently create or change tasks.

## v43: AI planning connected to Courses & sessions

- The AI Command Center receives your saved courses and upcoming class sessions as separate planning context. The rules-based summary still reflects only your own prompt.
- When an academic request clearly matches a saved course (e.g. “physics assignment” with an Applied Physics course), CampusMate preselects that course in the task preview. The student can change the association or leave it as a general task before saving. Ambiguous course matches are not guessed.
- Proposed focus blocks avoid conflicts with saved class sessions and existing scheduled tasks. Accepted tasks show their course in Tasks and Schedule and persist the link in browser storage or Supabase.
- Existing Supabase projects must run `supabase/migrations/20261023_task_course_links.sql` once before using course-linked tasks.

## v42: AI Planning Studio → Tasks → Schedule

- Enter a concrete task request in the AI Command Center, for example: “I have to complete my physics assignment by 10 PM today. It will take around two hours.”
- After CampusMate generates the plan, review the detected task, deadline, work duration, and conflict-aware suggested time. Nothing is created until you confirm.
- Choose **Create task & schedule block** to add a scheduled task that appears in both Tasks and the Schedule timeline, or **Add to Tasks only** to keep it flexible.
- If the request doesn't contain a specific task, CampusMate leaves it as a planning suggestion rather than inventing one.
- Test extraction and scheduling with `npm run verify:task-intent`.

## What's included

- Preserves the v31 CampusMate dashboard, Daylight / Sky Purple themes, moving sky effects, and cinematic tab transitions.
- Daily Intelligence Brief backed by a deterministic TypeScript planner, with optional Amazon Bedrock natural-language planning through the AWS SDK for JavaScript v3 Converse API.
- Self-hosted MCP server at `POST/GET/DELETE /api/mcp` over Streamable HTTP, using the current MCP TypeScript SDK server package. It supports the current protocol era and stateless legacy clients including the hackathon's minimum MCP version.
- Five MCP tools: `get_today_overview`, `list_tasks`, `get_schedule`, `suggest_daily_plan`, and confirmation-gated `update_task`.
- An in-app **Run Alexa+ MCP test** control. It creates a real MCP client, completes the protocol handshake, lists tools, and calls tools over HTTP using the MCP client SDK. It is not a mocked button animation.
- Supabase SSR authentication and owner-scoped cloud task sync, plus authenticated CRUD API routes for courses, class sessions, study sessions, and saved study plans. The `/resources` workspace works in two explicit modes: cloud-backed for a signed-in student with Supabase configured, or browser-local demo mode when Supabase is unavailable. Local mode supports create/edit/delete courses, create/edit/delete classes, start/finish focus sessions, create/edit/accept/archive/delete plans, and export a JSON backup. Course and schedule actions are now high-contrast pill buttons with accessible labels; the schedule uses an explicit **EDIT CLASS** control that loads the selected entry back into the form and scrolls directly to it, and action controls wrap below the details on small screens.
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

4. **To use AI without AWS:** create a Gemini API key at https://aistudio.google.com/apikey, then add `GEMINI_API_KEY=your_key`, `GEMINI_MODEL_ID=gemini-3.5-flash-lite`, and optionally `GEMINI_FALLBACK_MODEL_IDS=gemini-3.6-flash,gemini-3.8-flash` to `.env.local`. Restart `npm run dev`. CampusMate will use Gemini for AI-generated planning briefs, MCP planning suggestions, and Talk it through chat; the planning UI indicates `GEMINI-ASSISTED` when successful. Check current model access, rate limits, and pricing at Google AI Studio.
5. Keep the Gemini key server-side; never use a `NEXT_PUBLIC_` prefix or commit `.env.local`. The no-cost Gemini tier has limitations and Google's pricing page says content submitted under the free tier may be used to improve products, so use synthetic demo information rather than sensitive student data.
6. Amazon Bedrock is still optional: keep `BEDROCK_ENABLED=false` while access is blocked. If you later regain access, configure AWS credentials and model access, then set `BEDROCK_ENABLED=true`. Gemini is preferred if `GEMINI_API_KEY` is configured; Bedrock is tried as a fallback if Gemini fails and Bedrock is enabled. If both fail or neither is configured, CampusMate uses its deterministic local planner.

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


### v43: connect planner tasks to saved courses

For an existing Supabase project, open the SQL Editor and run `supabase/migrations/20261023_task_course_links.sql` once before updating the app. This adds a nullable `tasks.course_id` foreign key; it does not delete or rewrite existing tasks. Fresh installs using `supabase/schema.sql` get the column automatically. After applying it, restart the dev server. In AI Command Center, a clear subject match (for example, “finish my physics assignment”) is linked to a matching saved course when possible; review or change the course in the proposal before creating the task. The planner also receives upcoming class-session context and avoids overlaps with saved class commitments.

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
- `POST /api/intelligence-brief` — validates a task snapshot and returns a Gemini- or Bedrock-assisted brief, with deterministic rules-based fallback.
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
4. Configure `GEMINI_API_KEY`, restart the dev server, then click refresh and verify that the badge says `GEMINI-ASSISTED`.
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
- Gemini and Bedrock credentials are not included in the ZIP. Set `GEMINI_API_KEY` in `.env.local` to use Gemini without AWS; Bedrock still requires AWS credentials, model access, and `BEDROCK_ENABLED=true`.
- The MCP server is real and uses Streamable HTTP, but non-authenticated external callers are limited to the demo workspace. A production multi-user Alexa+ setup needs per-user authorization and durable storage for remote tool calls.
- The existing Planning Studio conversational panel still contains frontend demo interactions; the Daily Intelligence Brief and MCP tools are the wired server-side intelligence slice in this version.
- The account, task-sync, and resource APIs need your own Supabase project configuration before cloud persistence will activate. The resource management UI is available at `/resources`; authenticated database behavior still needs to be verified against your own project.

## v37 Integration Command Center

Visit `/integrations` for safe, read-only status checks across Supabase configuration/session/core table access and honest Bedrock/MCP readiness notes. The endpoint never returns table row contents or raw database errors. Use `npm run verify:integrations` for static checks and `npm run verify:all` for the local static suite.

**Alexa+ status:** Streamable HTTP and local tools exist, but the shared-token starter does not implement Alexa+'s current OAuth 2.1 + PKCE/account-linking requirements. Review `docs/ALEXAPLUS_MCP_READINESS.md` before remote deployment. Do not treat local MCP success as proof of Alexa+ connectivity.


## Student experience v38 updates

This build adds Low/Medium/High priorities, planned work date and start/end time pickers, separate deadline date/time, configurable browser reminders, a customizable per-user profile and avatar upload, quote rotation, a compact Today page with an integrated course/class preview, and removal of technical Integration Health from the main navigation.

For an existing Supabase project, apply `supabase/migrations/20261023_profile_deadlines_priorities.sql` before expecting the new fields to cloud-sync. Browser deadline notifications require CampusMate to remain open and browser permission; closed-app push reminders are not configured.


## v44 Daylight scrollbar polish

Scrollbars follow the selected interface theme throughout the document, sidebar, task editor, profile modal, and nested scroll areas. Daylight uses a muted blue-grey thumb/track; Sky Purple uses lavender over a deep violet track. Avoid hard-coded scrollbar colors in component-specific styles; use `--cm-scrollbar-thumb`, `--cm-scrollbar-thumb-hover`, and `--cm-scrollbar-track` instead.

## v48 schedule display
The Schedule timeline now displays explicit time ranges when a scheduled task or saved class includes both start and end times. For example, a two-hour task starting at 7 PM appears as `7:00–9:00 PM`, with its duration retained separately.

## v52: Fix Gemini minimum-deadline errors

- Gemini's SDK HTTP timeout is now 12 seconds (above the API's 10-second minimum) for both planning briefs and chat.
- The browser waits up to 40 seconds, enough for the app's bounded three-model failover chain to return or fall back rather than cutting the chain off at 25 seconds.
- The rules-based fallback remains available if Gemini models return temporary overload errors. A 503 still means the provider may be temporarily unavailable; this fix removes the invalid short-deadline 400 error, not provider outages.
- Added a regression check that the Gemini timeout stays at or above 10 seconds.


## v56: Gemini recovery and merged source

- Defaults to `gemini-3.5-flash-lite`, currently listed by Google as a stable high-throughput model, and falls back across `gemini-3.6-flash` and `gemini-3.8-flash`.
- Adds one bounded retry with backoff for transient `408`, `429`, `500`, `502`, `503`, and `504` errors, then tries alternate models.
- Keeps the rules-based planner as a safe fallback if all provider models are unavailable. A Google-side `503 UNAVAILABLE` may still persist across models.
- Preserves the existing repository history; this release ZIP intentionally excludes `.env.local`, `node_modules`, and `.next`.

## v55 batch scheduling note
Batch planning now reserves all saved task calendar blocks (including completed tasks whose scheduled block remains visible) and searches later available dates when no conflict-free block fits today. Review all times before confirming batch creation.
