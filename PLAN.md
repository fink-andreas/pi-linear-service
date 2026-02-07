# Plan - INN-178: Add simple metrics in logs

## Overview
Add simple performance metrics to logs for:
- Poll duration: Time taken for each polling cycle
- API latency: Time taken for Linear GraphQL API calls
- tmux command latency: Time taken for tmux commands

## Files Involved

### src/poller.js
- Poll loop orchestration
- Calls Linear API and tmux operations
- Needs: Poll duration metrics

### src/linear.js
- GraphQL API queries
- Needs: API latency metrics

### src/tmux.js
- Tmux command execution
- Needs: tmux command latency metrics

### src/metrics.js (NEW)
- Create new module for metrics collection
- Helper functions for timing operations
- Format metrics for logging

## Current Architecture

### Poll Loop Flow (src/poller.js)
1. Start poll tick
2. Check if previous poll still running (skip if yes)
3. Execute Linear GraphQL query
4. Group issues by project
5. For each project:
   - Check/create tmux session
   - Run health checks
6. End poll tick

### Linear API Calls (src/linear.js)
- fetchAssignedIssues(): Gets issues from Linear
- Uses HTTP POST to GraphQL endpoint

### Tmux Commands (src/tmux.js)
- listSessions(): Get list of tmux sessions
- newSession(): Create new tmux session
- killSession(): Kill a tmux session
- getSessionInfo(): Get session information
- All use child_process.exec() or execSync()

## Implementation Plan

### 1. Create src/metrics.js Module
```javascript
// Helper for timing operations
export function measureTime(fn) {
  const start = Date.now();
  try {
    const result = fn();
    const duration = Date.now() - start;
    return { result, duration, success: true };
  } catch (error) {
    const duration = Date.now() - start;
    return { error, duration, success: false };
  }
}

// Helper for measuring async operations
export async function measureTimeAsync(fn) {
  const start = Date.now();
  try {
    const result = await fn();
    const duration = Date.now() - start;
    return { result, duration, success: true };
  } catch (error) {
    const duration = Date.now() - start;
    return { error, duration, success: false };
  }
}
```

### 2. Add Poll Duration Metrics (src/poller.js)
- Wrap entire poll cycle with timing
- Log poll duration at end of cycle
- Include in pollStarted/pollCompleted logs

### 3. Add API Latency Metrics (src/linear.js)
- Wrap GraphQL query execution with timing
- Log API latency for each fetch
- Include error handling with duration

### 4. Add tmux Command Latency Metrics (src/tmux.js)
- Wrap each tmux command execution with timing
- Log duration for listSessions, newSession, killSession, getSessionInfo
- Include in debug logs for detailed visibility

### 5. Update Logging
- Add metrics to existing log entries where relevant
- Format: duration in milliseconds (ms)
- Example: {"level":"INFO","message":"Poll completed","durationMs":1234,"issuesCount":5}

## High-Level TODO

- [ ] 1. Create src/metrics.js module with timing helpers
- [ ] 2. Add poll duration metrics to src/poller.js
- [ ] 3. Add API latency metrics to src/linear.js
- [ ] 4. Add tmux command latency metrics to src/tmux.js
- [ ] 5. Test metrics appear in logs
- [ ] 6. Verify metrics don't impact performance

## Non-Goals

- Complex metrics aggregation or storage
- Metrics visualization dashboards
- Performance analysis beyond simple timing
- Historical metrics comparison
