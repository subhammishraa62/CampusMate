# CampusMate v56 — Start here

1. Extract the archive to a new folder. The existing `.git` directory and `origin` remote are preserved.
2. Copy your private `.env.local` from your existing project into this folder. The archive intentionally does not include API keys or Supabase credentials.
3. In `.env.local`, set `GEMINI_MODEL_ID=gemini-3.5-flash-lite`. Optional: set `GEMINI_FALLBACK_MODEL_IDS=gemini-3.6-flash,gemini-3.8-flash`. Keep `GEMINI_API_KEY` server-side; never commit `.env.local`.
4. Run `npm install`.
5. Run `npm run dev` and open `http://localhost:3000`.
6. Test the `/api/health` endpoint, then use AI Command Center once. If every model returns a provider-side 503, CampusMate retains its rules-based fallback and the provider may need time to recover.
7. Run `npm run verify:gemini-failover` to test the bounded failover logic.

## GitHub

The archive keeps the existing Git history and `origin` remote. After checking `git status`, stage and commit the desired source changes. Before pushing, verify `.env.local` is ignored and not staged.
