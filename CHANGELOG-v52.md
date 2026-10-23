# CampusMate v52 — Gemini timeout minimum fix

## What changed

- Fixed the invalid Gemini request deadline: v51 set `timeout: 6500`, which the SDK surfaced to Google as a 7-second deadline; Gemini rejects manual deadlines shorter than 10 seconds.
- Added shared `GEMINI_HTTP_TIMEOUT_MS = 12000` and used it consistently for daily planning briefs and chat.
- Increased the browser-side bounded fetch timeout to 40 seconds so the page does not abort before the three-model failover sequence can complete in the worst case.
- Added a regression assertion that the configured Gemini HTTP timeout is at least 10 seconds.
- Preserved Gemini model fallback, batch planning, duplicate prevention, class/course associations, schedule conflict checks, themes, and confirmation-before-save behavior.

## Expected behavior

Gemini requests should no longer fail immediately with `Manually set deadline 7s is too short. Minimum allowed deadline is 10s.` Temporary provider `503 UNAVAILABLE` responses can still occur; v51/v52 failover attempts alternatives and returns to the rules-based fallback if all attempts fail.

## Verification

Full live inference and a production build must be verified in the user's environment.
