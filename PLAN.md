# INN-170: Structured Logging - Implementation Plan

## Current State

The project already has:
- ✅ Startup config summary (masked secrets) in `logger.js` with `logConfig()`
- ✅ Structured JSON logging with timestamps, levels, and data
- ✅ Individual operation logging (Linear API, session creation, health checks)

## Requirements

1. **Per poll metrics** - Track and log for each poll:
   - Poll start/end timestamps
   - Poll duration
   - Issue count
   - Project count
   - Sessions created
   - Unhealthy sessions detected
   - Sessions killed
   - Errors during poll

2. **Readable in both terminal and journald** - Already satisfied with JSON format

## Implementation Plan

### 1. Update `src/poller.js`

Add poll metrics tracking and consolidated logging:

**Poll Start Tracking:**
- Add `pollStartTimestamp` at beginning of `performPoll()`
- Log poll start with metrics placeholder

**Metrics Collection:**
- Collect all metrics from operations:
  - `issueCount` - from fetchAssignedIssues
  - `projectCount` - from groupIssuesByProject
  - `sessionsCreated` - from createSessionsForProjects
  - `unhealthyDetected`, `sessionsKilled`, `sessionsChecked` - from checkAndKillUnhealthySessions
  - `errorCount` - track try/catch failures

**Poll End Tracking:**
- Add `pollEndTimestamp` at end of `performPoll()`
- Calculate `pollDurationMs`
- Log consolidated poll summary with all metrics

### 2. File Structure

**Files to modify:**
- `src/poller.js` - Add poll metrics tracking and logging

**No new files needed**

## Definition of Done

- [ ] Poll start/end logged with timestamps and duration
- [ ] Poll summary includes: issue count, project count, sessions created, unhealthy sessions, kills, errors
- [ ] Logs remain structured JSON (readable in terminal and journald)
- [ ] Manual test: run service and verify poll metrics appear in logs
