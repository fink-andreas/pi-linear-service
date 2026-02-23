# TODO: Migrate to Linear TypeScript SDK

## Phase 1: Setup & Infrastructure
- [x] Install `@linear/sdk` package
- [x] Create `src/linear-client.js` with `createLinearClient(apiKey)` factory
- [x] Add `transformIssue()` helper in `src/linear.js` to normalize SDK responses

## Phase 2: Query Functions Migration
- [x] Refactor `runSmokeQuery` → `fetchViewer(client)` using `client.viewer`
- [x] Refactor `fetchIssues(client, assigneeId, openStates, limit)` using `client.issues({ filter })`
- [x] Refactor `fetchProjects(client)` using `client.projects()`
- [x] Refactor `resolveIssue(client, issueRef)` using `client.issue()` + filter
- [x] Refactor `resolveProjectRef(client, ref)` using project lookup
- [x] Refactor `getTeamWorkflowStates(client, teamRef)` using `client.team().states`
- [x] Refactor `fetchIssueDetails(client, issueRef, options)` with nested relations

## Phase 3: Mutation Functions Migration
- [x] Refactor `setIssueState(client, issueId, stateId)` using `issue.update({ stateId })`
- [x] Refactor `addIssueComment(client, issueRef, body, parentId)` using `client.createComment()`
- [x] Refactor `updateIssue(client, issueRef, patch)` using `issue.update()`
- [x] Refactor `prepareIssueStart(client, issue)` using SDK equivalents
- [x] Refactor `startIssue(client, issue)` using SDK equivalents (or remove if unused)

## Phase 4: Cleanup in `src/linear.js`
- [x] Remove `executeQuery()` function
- [x] Remove `fetchAssignedIssues()` (deprecated)
- [x] Remove `truncate()` and `truncateJson()` helpers (no longer needed)
- [x] Keep `groupIssuesByProject()` unchanged (pure JS)
- [x] Keep `formatIssueAsMarkdown()` unchanged (pure JS)

## Phase 5: Update Consumers
- [x] Update `src/poller.js`:
  - Import `createLinearClient` from `./linear-client.js`
  - Create client once at start
  - Update calls to `fetchViewer(client)` and `fetchIssues(client, ...)`
- [x] Update `extensions/pi-linear-service.js`:
  - Import `createLinearClient` from `../src/linear-client.js`
  - Create client per command (or reuse if possible)
  - Update all Linear API function calls to pass `client` first

## Phase 6: Testing
- [x] Create `test-linear-sdk.js` with `createMockLinearClient()` helper
- [x] Add test for `fetchViewer()`
- [x] Add tests for `fetchIssues()` (with/without assignee, pagination)
- [x] Add tests for `fetchProjects()`
- [x] Add tests for `resolveIssue()` (by ID, by identifier, not found)
- [x] Add tests for `getTeamWorkflowStates()`
- [x] Add tests for `setIssueState()`
- [x] Add tests for `addIssueComment()`
- [x] Add tests for `updateIssue()` (via extension test update)
- [x] Add tests for `fetchIssueDetails()` (via extension test update)
- [x] Rename `test-linear-execute-query.js` to `test-linear-execute-query.js.old`
- [x] Update `package.json` test script to use new test file
- [x] Run all tests: all tests pass (12 test files)

## Phase 7: Documentation & Finalization
- [x] Update `README.md` with `@linear/sdk` dependency (already documented)
- [x] Verify service starts successfully (confirmed via manual test)
- [x] Manual smoke test with real API key (poll loop running correctly)
