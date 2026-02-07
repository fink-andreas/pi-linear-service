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

## INN-160 — Implement assigned issues in open states query (Done)

### Issue summary
Query up to `LINEAR_PAGE_LIMIT` issues assigned to `ASSIGNEE_ID` where `state.name ∈ LINEAR_OPEN_STATES`.
Must include:
- `issue.id`
- `issue.title` (optional for logs)
- `state.name`
- `project { id name }`

If returned count hits the limit, log a truncation warning.

### Implemented
- `src/linear.js`: `fetchAssignedIssues()` implemented with `pageInfo.hasNextPage` truncation detection + WARN log

---

## INN-161 — Group issues by project

### Issue summary
Ignore issues with no `project` (log at info/debug). Produce `Map(projectId → { projectName, issueCount })`.
Definition of done: logs issue count, project count, ignored-no-project count.

### Repo exploration / where it fits
- `src/linear.js` contains placeholder `groupIssuesByProject()`.
- `src/poller.js` currently fetches issues at startup (for manual verification).

### Implementation approach
1. Implement `groupIssuesByProject(issues)`:
   - iterate over issues
   - if missing `project` or `project.id`, increment `ignoredNoProject` and log at debug/info
   - otherwise aggregate counts into a `Map`
2. Log a summary at the end:
   - total issues
   - projects count
   - ignored count
3. (Optional) call it in `poller.js` after fetching issues for a visible manual verification.

### Manual verification
- With real Linear API key and a valid `ASSIGNEE_ID`, run `node index.js` and verify summary log lines.

### Files expected to change
- `src/linear.js`
- `src/poller.js` (optional)
