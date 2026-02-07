# PLAN

## INN-159 — Implement Linear GraphQL client (Done)

### Issue summary (INN-159)
Implement a Linear GraphQL client that POSTs to `https://api.linear.app/graphql` with an `Authorization` header. Must handle:
- HTTP errors
- GraphQL `errors[]`

Errors should be logged and **must not crash the daemon** (poll loop should keep running). Definition of done: run a simple query and log success/failure cleanly.

### Implemented
- `src/linear.js`: hardened `executeQuery()` and added a smoke query
- `src/poller.js`: runs smoke query on startup and logs success/failure without throwing

---

## INN-160 — Implement assigned issues in open states query

### Issue summary
Query up to `LINEAR_PAGE_LIMIT` issues assigned to `ASSIGNEE_ID` where `state.name ∈ LINEAR_OPEN_STATES`.
Must include:
- `issue.id`
- `issue.title` (optional for logs)
- `state.name`
- `project { id name }`

If returned count hits the limit, log a truncation warning.

### Repo exploration / where it fits
- `src/config.js` already provides:
  - `assigneeId`
  - `linearOpenStates`
  - `linearPageLimit`
- `src/linear.js` already has placeholder `fetchAssignedIssues()`

### Reference implementation (linear-cli)
- `../linear-cli/src/utils/linear.ts` shows querying `issues(filter: $filter, first: $first)` and reading `pageInfo.hasNextPage`.

### Implementation approach
1. Implement `fetchAssignedIssues(apiKey, assigneeId, openStates, limit)` using `executeQuery()`.
2. GraphQL query shape:
   - `issues(first: $first, filter: { assignee: { id: { eq: $assigneeId } }, state: { name: { in: $stateNames } } })`
   - request `nodes { id title state { name } project { id name } }`
   - request `pageInfo { hasNextPage }` to detect truncation reliably
3. Return `{ issues, truncated }` where `truncated = pageInfo.hasNextPage || nodes.length >= limit`.
4. If truncated, `warn()` once with a clear message mentioning `LINEAR_PAGE_LIMIT`.

### Manual verification
- Run service with real `.env` key:
  - call `fetchAssignedIssues()` (via quick log call in `poller.js` temporarily or a one-off script) and verify it returns issues and logs truncation when applicable.

### Files expected to change
- `src/linear.js`
- (optional for manual test) `src/poller.js`
