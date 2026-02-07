# TODO - INN-170: Structured Logging

## Implementation Steps

- [x] 1. Add poll start tracking in `performPoll()` function:
    - Add `const pollStartTimestamp = Date.now()` at the beginning
    - Add info log: "Poll started" with poll ID or timestamp
    - Initialize metrics object: `{ issueCount: 0, projectCount: 0, sessionsCreated: 0, unhealthyDetected: 0, sessionsKilled: 0, errors: [] }`

- [x] 2. Update Linear API fetch section to collect metrics:
    - Capture `issueCount` from fetchAssignedIssues result
    - Capture `projectCount` from byProject.size
    - Store in metrics object
    - Catch errors and add to errors array

- [x] 3. Update session creation section to collect metrics:
    - Capture `sessionsCreated` from createSessionsForProjects
    - Store in metrics object
    - Catch errors and add to errors array

- [x] 4. Update health check section to collect metrics:
    - Capture all metrics from checkAndKillUnhealthySessions result (unhealthyDetected, sessionsKilled, sessionsChecked)
    - Store in metrics object
    - Catch errors and add to errors array

- [x] 5. Add poll end tracking and summary logging:
    - Add `const pollEndTimestamp = Date.now()` at the end
    - Calculate `const pollDurationMs = pollEndTimestamp - pollStartTimestamp`
    - Log "Poll completed" with all consolidated metrics:
      - pollDurationMs
      - issueCount
      - projectCount
      - sessionsCreated
      - unhealthyDetected
      - sessionsKilled
      - errorCount

- [x] 6. Manual test:
    - Run `node index.js` with valid .env
    - Verify poll start/end logs appear
    - Verify all metrics are present in poll summary
    - Check logs are readable JSON format

- [>] 7. Update Linear issue (Done + comment), commit, merge to main
