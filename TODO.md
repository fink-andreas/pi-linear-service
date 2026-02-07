# TODO

## INN-159 Implement Linear GraphQL client (Done)

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

---

## INN-160 Implement assigned issues in open states query (Done)

- [x] 1. Implement `fetchAssignedIssues()` in `src/linear.js` using a GraphQL query filtered by `assigneeId` + `state.name in openStates` and requesting `pageInfo.hasNextPage`.
- [x] 2. Add truncation detection + warning when results reach `LINEAR_PAGE_LIMIT`.
- [x] 3. Manual test with real `.env` key: verify it returns issues and logs truncation warning when applicable.
  - Verified with `ASSIGNEE_ID=<viewerId>`: returns issues
  - Verified with `LINEAR_PAGE_LIMIT=1`: logs truncation warning
- [x] 4. Update Linear issue (Done + comment), commit, merge to main.

---

## INN-161 Group issues by project

- [x] 1. Implement `groupIssuesByProject()` in `src/linear.js` to return `Map(projectId -> { projectName, issueCount })`, ignoring issues without a project.
- [x] 2. Add required logging: issue count, project count, ignored-no-project count (+ optional per-ignored issue debug/info).
- [x] 3. Manual test with real API key: fetch issues, group them, verify logs.
  - Verified with `ASSIGNEE_ID=<viewerId> node index.js` (logs grouped summary)
- [>] 4. Update Linear issue (Done + comment), commit, merge to main.
