# CampusMate AI — Alexa+ MCP readiness notes

Research checked: 21 October 2026. Treat the official docs as the source of truth because onboarding and certification requirements may change.

## What is already in CampusMate

- A Streamable HTTP MCP endpoint at `/api/mcp`.
- Five tools: `get_today_overview`, `list_tasks`, `get_schedule`, `suggest_daily_plan`, and `update_task`.
- Local MCP handshake/tool-call test (`npm run verify:mcp`).
- A production fail-closed shared-token guard and host/origin validation in the current starter.
- A confirmation preview before the `update_task` tool persists an update.

These establish a local MCP prototype, not a completed Alexa+ connection or certification.

## The blocking remote-integration work

Amazon's Alexa+ MCP QuickStart requires Streamable HTTP and an externally reachable HTTPS endpoint. Its authentication checklist currently calls for OAuth 2.1 authorization-code flow with PKCE (`S256`), a resource parameter, bearer token use in the Authorization header, Protected Resource Metadata at the well-known URI (RFC 9728), and authorization-server metadata. It says account linking will not proceed without the relevant PKCE metadata. The docs also list unsupported flows/capabilities, so don't improvise an OIDC/DCR implementation and assume it will work.

Official sources:

- Alexa+ MCP QuickStart: https://www.developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-quickstart
- Alexa+ MCP lifecycle: https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-client-lifecycle
- Alexa+ developer docs home: https://developer.amazon.com/docs/alexaplus/add-ons/home
- Supabase Auth with Next.js: https://supabase.com/docs/guides/auth/server-side
- Supabase authorization and RLS overview: https://supabase.com/docs/guides/auth

## Safe implementation sequence

1. Deploy the app to HTTPS with environment variables configured server-side. Keep secrets out of `NEXT_PUBLIC_*` variables and source control.
2. Complete a proper OAuth 2.1 + PKCE / resource-metadata implementation that Alexa+'s current checklist supports. The current `CAMPUSMATE_MCP_TOKEN` is a development gate only; it is not a substitute for per-user account linking.
3. Bind the linked external subject to a CampusMate/Supabase user. Every data read/write must resolve this identity server-side and scope operations to that exact user. Never infer the user from a tool argument or accept a caller-supplied user ID.
4. For mutations, preserve the preview/approval flow and require the authenticated user's token to authorize the exact resource. Audit unsuccessful and successful writes without logging tokens or private task contents.
5. Run `npm run verify:mcp` against localhost, then against the deployed URL with the intended authentication mechanism. Test two separate accounts and verify no cross-account reads/writes.
6. Follow Amazon's current tool metadata, privacy policy, terms-of-use, example phrase, icon and carousel asset, simulator, and certification requirements before submission. See the QuickStart for the full current list.

## Known limitation in this version

The current server has a shared bearer token gate to prevent an unconfigured public endpoint. It does not implement Alexa+'s full OAuth 2.1 account-linking flow or map an external Alexa+ token to an individual Supabase user. Therefore the integration dashboard deliberately reports remote Alexa+ as not yet verified. Do not expose student-specific data or enable remote mutations until this gap is closed.
