# CampusMate v51 — Gemini model failover for temporary overloads

## What changed

- Added bounded model failover for Gemini briefs and AI chat. The configured model remains first choice; on a transient 429/5xx or model-level response/format issue, CampusMate tries another supported model.
- Default alternate order includes `gemini-3.5-flash-lite` (Google's current high-throughput, cost-efficient Flash-Lite model) and `gemini-3.8-flash`. References: https://ai.google.dev/gemini-api/docs/models and https://ai.google.dev/gemini-api/docs/troubleshooting.
- Each model attempt has a 6.5-second timeout and only one SDK attempt; the route tries at most three models, with a short jittered pause. This stays within the page's 25-second browser timeout under normal timing.
- A model that succeeds is remembered for subsequent requests in the same running server process, so a currently working model is preferred after an overloaded primary.
- Model-specific generation config avoids sending the Gemini 3.6/3.8 low-thinking config to the Flash-Lite fallback.
- Health endpoint now reports candidate fallback models. The brief's `Generated with Google Gemini` label identifies the model that actually succeeded.
- If every candidate is overloaded/unavailable or the key/account cannot access models, the deterministic rules-based fallback remains as a last-resort safety path; the application cannot guarantee provider availability.
- Existing batch task review, duplicate protection, course linkage, class conflict scheduling, and confirmation-before-save behavior are preserved.

## Testing

- Checked the model IDs against Google's current public model catalog. This environment cannot issue a live Gemini API request, so provider availability must be tested using the user's server-side key.
- Run `npm run verify:batch-planning`, `npm run verify:duplicate-prevention`, `npm run verify:planning-workflow`, `npm run verify:all`, and `npm run build` locally.
