# TODO - INN-178: Add simple metrics in logs

## Implementation Steps

- [x] 1. Create src/metrics.js module:
    - Add measureTime() function for synchronous operations
    - Add measureTimeAsync() function for async operations
    - Return object with { result/duration/success } or { error/duration/success }
    - Export both functions

- [x] 2. Add poll duration metrics to src/poller.js:
    - Import measureTimeAsync from src/metrics.js
    - Wrap poll tick execution with measureTimeAsync
    - Log poll duration in pollCompleted message
    - Format: {"message":"Poll completed","durationMs":1234,"issuesCount":5}

- [x] 3. Add API latency metrics to src/linear.js:
    - Import measureTimeAsync from src/metrics.js
    - Wrap GraphQL fetch in measureTimeAsync
    - Log API latency on success and error
    - Format: {"message":"Fetched assigned issues","durationMs":456,"count":10}
    - Format: {"message":"Failed to fetch issues","durationMs":789,"error":"..."}

- [x] 4. Add tmux command latency metrics to src/tmux.js:
    - Import measureTime and measureTimeAsync from src/metrics.js
    - Wrap listSessions() with measureTimeAsync
    - Wrap newSession() with measureTimeAsync
    - Wrap killSession() with measureTimeAsync
    - Wrap getSessionInfo() with measureTimeAsync
    - Add durationMs to relevant log entries

- [x] 5. Test metrics appear in logs:
    - Run service with LOG_LEVEL=info
    - Verify poll duration appears in logs
    - Verify API latency appears in logs
    - Verify tmux command latency appears in logs

- [>] 6. Update Linear issue (Done + comment), commit, merge to main
