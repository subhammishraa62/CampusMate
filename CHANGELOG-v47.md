# CampusMate v47 — Gemini timeout and diagnostics fix

- Added a 15-second provider timeout and disabled automatic retries for Gemini calls so a stalled provider cannot block requests indefinitely.
- Set Gemini 3.8 Flash thinking to `low` for the short chat/planning use cases and removed unsupported temperature controls for this model family.
- Added sanitized diagnostic logging (status/code/message) while redacting API-key-like values.
- Added a 25-second browser-side timeout and user-facing message to stop infinite loading states.
- Updated `@google/genai` to `^2.31.0` for current SDK support.
- Keeps the rules-based fallback and existing task, course, class, theme, and schedule behavior.

## Setup
Reuse the existing `.env.local` values securely. Add/carry forward `GEMINI_API_KEY`, keep the key server-side, then run `npm install` and `npm run dev`.
