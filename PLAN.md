# PLAN — INN-159 Implement Linear GraphQL client

## Issue summary (INN-159)
Implement a Linear GraphQL client that POSTs to `https://api.linear.app/graphql` with an `Authorization` header. Must handle:
- HTTP errors
- GraphQL `errors[]`

Errors should be logged and **must not crash the daemon** (poll loop should keep running). Definition of done: run a simple query and log success/failure cleanly.

## Project exploration (current repo)
Top-level structure (from `tree -L 2`):
- `index.js` — boot sequence: banner → validate env → start poll loop
- `src/config.js` — env parsing/validation; requires `LINEAR_API_KEY`, `ASSIGNEE_ID`
- `src/poller.js` — currently a skeleton (does not yet poll)
- `src/linear.js` — already contains `executeQuery()` (fetch-based) plus placeholders for later issues
- `src/logger.js` — structured logging helpers

### Current Linear client status (`src/linear.js`)
- Has `executeQuery(apiKey, query, variables)` that uses `fetch` against `https://api.linear.app/graphql`
- Sends headers: `Authorization: apiKey`, `Content-Type: application/json`
- On non-2xx: logs details and throws
- On `result.errors`: logs messages and throws

Gaps vs INN-159 definition-of-done:
- No single “smoke test” query wired into startup/poll loop to demonstrate success/failure behavior
- Daemon-level error handling policy not yet implemented (poller is skeleton), so “don’t crash daemon” needs an explicit pattern (catch + log + continue)
- Missing request metadata that is useful in practice (e.g., `User-Agent`, request timeout/abort)
- Error logging could be standardized (include operation name, status, request id if any)

## Reference implementation to consult (linear-cli)
User provided: `../linear-cli/`.
Relevant file:
- `../linear-cli/src/utils/graphql.ts`
  - Uses `graphql-request` client
  - Sets `Authorization: apiKey`
  - Adds `User-Agent: schpet-linear-cli/<version>`
  - Has utilities for extracting GraphQL error messages

We won’t copy the dependency stack (this service is plain Node + fetch), but we can copy patterns:
- Always include a `User-Agent`
- Normalize error messages

## Implementation approach
1. Keep using Node’s built-in `fetch` (Node >=18) to avoid adding dependencies.
2. Harden `executeQuery()`:
   - Add `User-Agent` header (e.g., `pi-linear-service/<version>` from package.json)
   - Add optional timeout via `AbortController` (small helper; configurable later if needed)
   - Improve error object returned/thrown to include:
     - `httpStatus`, `httpStatusText`, `graphQLErrors` (array), maybe `responseBodySnippet`
3. Add a small exported helper like `testLinearConnection(config)` or `runSmokeQuery(apiKey)` that runs a simple query (e.g. `query { viewer { id name } }`).
4. Ensure daemon does not crash:
   - In `startPollLoop()`, call the smoke query and catch/log failures (do not throw).
   - Future poll iterations must wrap Linear calls in try/catch.

## Files expected to change
- `src/linear.js` — improve `executeQuery`, add `smokeTestQuery()` helper
- `src/poller.js` — call smoke test on startup and log success/failure without throwing
- `package.json` (optional) — expose version to build User-Agent (can read from `process.env.npm_package_version` or read package.json once)

## Manual verification (per project AGENTS.md)
- Reality check:
  - `LINEAR_API_KEY="test" ASSIGNEE_ID="test" node index.js` should start and log a clear failure from the smoke query but **not crash** (process keeps running once poll loop exists; for now at least it should reach “service ready” without exiting non-zero).
  - With a real key: smoke query logs success.
