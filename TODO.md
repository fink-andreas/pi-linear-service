# TODO — INN-159 Implement Linear GraphQL client

- [x] 1. Inspect current logging + linear client usage; decide where to run the smoke-test query (startup in poller vs index).
  - Decision: run once at poll-loop startup (`src/poller.js`) after `setLogLevel()`, and **catch+log** so the daemon can keep running.
- [x] 2. Update `src/linear.js`:
  - add `User-Agent` header
  - add optional request timeout (AbortController)
  - normalize HTTP + GraphQL error handling into a single error shape
  - add `runSmokeQuery(apiKey)` (e.g. `viewer { id name }`)
- [x] 3. Update `src/poller.js` to call `runSmokeQuery()` once on startup and **catch + log** errors (do not throw).
- [x] 4. Manual test:
  - `LINEAR_API_KEY="test" ASSIGNEE_ID="test" node index.js` logs a clean failure and exits/continues as intended
  - `node index.js` with real `.env` key logs success
- [x] 5. Ensure repo is clean and implementation matches INN-159 definition of done; update Linear issue with summary + files changed.
