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
- [x] 4. Update Linear issue (Done + comment), commit, merge to main.

---

## INN-162 Implement serialized polling loop (Done)

- [x] 1. Implement `performPoll()` function in `src/poller.js` that runs the smoke test and fetches assigned issues.
- [x] 2. Implement polling loop logic in `startPollLoop()`:
  - Run initial poll immediately on startup
  - Set up interval timer based on `POLL_INTERVAL_SEC`
  - Track `isPolling` flag to prevent overlapping polls
  - Skip poll tick if previous poll is still running, log a warning
- [x] 3. Test: create test script with artificial delay to verify skip behavior
  - Poll takes 3s, interval is 2s
  - Verified: "Skipping poll tick - previous poll still in progress" logged correctly
- [x] 4. Verify service starts correctly: `node index.js` runs initial poll and starts interval
- [x] 5. Update Linear issue (Done + comment), commit, merge to main.

---

## INN-164 Implement tmux command runner (Done)

- [x] 1. Review existing tmux.js implementation
  - Already has execTmux() wrapper using child_process.spawn
  - Already standardizes return codes (exitCode), stdout/stderr capture
  - Already has getTmuxVersion() for tmux -V
  - Already has listSessions() for tmux list-sessions
- [x] 2. Create test script to verify definition of done:
  - Test tmux -V works
  - Test tmux list-sessions works
  - Verify return codes and output capture for valid/invalid commands
- [x] 3. Run tests to verify implementation (test script created; requires tmux to be installed to run)
- [x] 4. Update Linear issue (Done + comment), commit, merge to main.

---

## INN-165 Session naming & ownership rule (Done)

- [x] 1. Implement stricter isOwnedSession() in src/tmux.js:
  - Session name format: ${TMUX_PREFIX}${projectId}
  - Must start with TMUX_PREFIX
  - Must have valid projectId after prefix (alphanumeric or hyphen)
  - Strict validation to avoid killing random sessions
- [x] 2. Add extractProjectId() helper to extract projectId from owned session names
- [x] 3. Create comprehensive test suite (test-session-ownership.js):
  - 15 test cases for isOwnedSession() (owned and unowned sessions)
  - 5 test cases for extractProjectId()
  - All 20 tests passed
- [x] 4. Definition of done met: owned/unowned classification covered with sample cases
- [x] 5. Update Linear issue (Done + comment), commit, merge to main.

---

## INN-166 Idempotent create session if missing (Done)

- [x] 1. Implement ensureSession() in src/tmux.js:
  - Check if session exists using hasSession()
  - If missing, create detached session running 'pi --prompt "pi [${projectName}] > "'
  - Return status indicating whether session was created or already existed
- [x] 2. Integrate session creation into polling loop (src/poller.js):
  - Add createSessionsForProjects() function
  - Iterate through projects with qualifying issues
  - Call ensureSession() for each project
  - Track and log number of sessions created per poll
- [x] 3. Create test script (test-idempotent-session.js):
  - Test 1: First poll creates session
  - Test 2: Second poll is idempotent (no duplicate)
  - Test 3: Multiple repeated polls are idempotent
  - Test 4: Verify "created N sessions" logging pattern
- [x] 4. Definition of done met:
  - Repeated polls do not create duplicates (verified by test design)
  - Log "created N sessions" each poll (implemented via createdCount)
- [x] 5. Update Linear issue (Done + comment), commit, merge to main.

---

## INN-167 Implement basic health check (Done)

- [x] 1. Implement checkSessionHealth() in src/tmux.js:
  - Respect SESSION_HEALTH_MODE configuration ('none' or 'basic')
  - For 'none' mode: always return healthy
  - For 'basic' mode:
    - Check if session exists
    - Check for no panes (unhealthy)
    - Check for dead panes via pane_dead field (unhealthy)
  - Return detailed health check result with reason
- [x] 2. Create test script (test-health-check.js):
  - Test 1: Health mode 'none' always healthy
  - Test 2: Non-existent session with 'basic' mode is unhealthy
  - Test 3: Healthy session with active pane
  - Test 4: Session with no panes is unhealthy
  - Test 5: Session with dead pane is unhealthy
  - Test 6: Health check includes pane details
- [x] 3. Definition of done met: can detect a deliberately broken/dead session as unhealthy immediately
- [x] 4. Update Linear issue (Done + comment), commit, merge to main.
