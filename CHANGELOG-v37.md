# CampusMate AI — v37 changes

## Added
- `/integrations`, an Integration Command Center page reachable from the main dashboard.
- `/api/integration-status`, a read-only, no-store diagnostics endpoint.
- Safe authenticated table checks for `tasks`, `courses`, `class_sessions`, `study_sessions`, and `study_plans`; the endpoint selects only `id` and returns status only.
- A Bedrock status card that explicitly distinguishes configuration from a real invocation test.
- An Alexa+ readiness card that explicitly marks remote account linking as not yet implemented/verified.
- `npm run verify:integrations` and `npm run verify:all`.
- `docs/ALEXAPLUS_MCP_READINESS.md`, based on current official Alexa+ and Supabase documentation.

## Preserved
- Living Sky dashboard and existing motion/theme foundation.
- Local planner and backup/import workflow.
- Supabase resource APIs and ownership/RLS structure.
- Editable classes, focus sessions, saved study plans, and Bedrock-off fallback.
- Existing Streamable HTTP MCP tools.

## Validation performed in this build environment
- `verify-resource-api.mjs`: PASS
- `verify-local-mode.mjs`: PASS
- `verify-schedule-edit.mjs`: PASS
- `verify-integrations.mjs`: PASS
- TypeScript/TSX syntax transpile check on 26 files: 0 syntax errors.

A full `npm run verify:all`, semantic `npm run typecheck`, and production `npm run build` could not be completed in this build environment because dependencies were not installed; `npm install` timed out. Run these checks on the development machine after `npm install`. No live Supabase, Bedrock, or Alexa+ account operation was performed from this environment.
