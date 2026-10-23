# v45 — Google Gemini fallback

- Added server-side Google Gemini support for AI daily briefs and MCP planning suggestions.
- Added a real Gemini-backed Talk it through chat using the student's task/course/class context.
- Gemini is preferred when configured; optional Bedrock remains available; the deterministic planner remains the safe fallback.
- Added provider indicators to the health and integration diagnostics endpoints and updated UI labels.
- Task proposal extraction, course matching, conflict detection, and confirmation remain in CampusMate's local validated logic.
- No API key is included. Configure `GEMINI_API_KEY` in `.env.local`.
