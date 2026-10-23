# CampusMate v56 — Gemini recovery and merged source

- Merged the latest source snapshot into the existing Git repository while preserving its `.git` history and remote configuration.
- Excluded local secrets, `.next`, `node_modules`, and TypeScript build artifacts from the handoff archive.
- Default Gemini model is `gemini-3.5-flash-lite`, a currently listed stable model aimed at high-throughput tasks.
- Added one bounded retry for transient Gemini `408`, `429`, `500`, `502`, `503`, and `504` failures with backoff, then tries alternate supported model IDs.
- Kept the safe rules-based fallback when Google model endpoints remain unavailable.
- Increased the browser request timeout so bounded failover can finish without a permanent spinner.
- Preserved latest source differences, including visible schedule conflict flags.

A provider-side `503 UNAVAILABLE` can still affect all available model endpoints; application retries cannot guarantee Google's service capacity.
