# pi-linear-service Functionality Documentation

## Overview

pi-linear-service is a Node.js daemon that polls the Linear GraphQL API and manages per-project tmux sessions for development workflows. The service automatically creates tmux sessions for projects where you have assigned issues in open states.

## Architecture

```
┌─────────────────┐
│  index.js      │  Entry point, boot sequence
└──────┬──────────┘
       │
       ├──────────────────────────────┐
       │                              │
       ▼                              ▼
┌──────────────┐              ┌──────────────┐
│  config.js   │              │  logger.js   │
│              │              │              │
│ - validateEnv│              │ - debug/info │
│ - printConfig│              │ - warn/error │
└──────────────┘              └──────────────┘
       │
       ▼
┌──────────────┐
│  poller.js   │  Main polling loop
└──────┬───────┘
       │
       ├─────────────────────┬───────────────────┐
       │                     │                   │
       ▼                     ▼                   ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  linear.js   │    │   tmux.js    │    │  health.js   │
│              │    │              │    │              │
│ - GraphQL    │    │ - session    │    │ - health     │
│   queries    │    │   mgmt       │    │   checks     │
│ - issue      │    │ - health     │    │              │
│   grouping   │    │   checks     │    │              │
└──────────────┘    └──────────────┘    └──────────────┘
```

## Startup Sequence

The service follows a strict boot sequence:

1. **Print Banner** - Display service name and version
2. **Validate Environment** - Check required and optional configuration
3. **Start Poll Loop** - Begin continuous polling

### Boot Flow

```javascript
boot()
  ├── printBanner()
  ├── validateEnv()
  │   ├── Load .env file
  │   ├── Check required vars (LINEAR_API_KEY, ASSIGNEE_ID)
  │   ├── Validate configuration values
  │   └── Return config object
  ├── logConfig(config)  // Mask sensitive values
  └── startPollLoop(config)
      ├── Set log level
      ├── Perform initial poll
      └── Start interval timer
```

## Polling Loop

### Overview

The polling loop is the core of the service, running continuously to:

1. Check Linear API for assigned issues
2. Create tmux sessions for projects with issues
3. Check health of existing sessions
4. Optionally kill unhealthy sessions

### Serialized Polling

**Key Feature**: No overlapping polls - if a poll is still running when the interval fires, that tick is skipped with a warning log.

```javascript
┌─────────────────────────────────────────────────┐
│ Poll Interval (e.g., 300 seconds)             │
└─────────────────────────────────────────────────┘
    │                │                │
    ▼                ▼                ▼
┌──────┐        ┌──────┐        ┌──────┐
│ Poll │        │ Poll │        │ Poll │
│ 1    │        │ 2    │        │ 3    │
└──────┘        └──────┘        └──────┘
(5s)          (5s)            (5s)
                                        │
                                        ▼
                                   ┌──────────┐
                                   │  Skip    │  <-- Previous poll still running
                                   │  warning  │
                                   └──────────┘
```

### Poll Loop Implementation

```javascript
export async function startPollLoop(config) {
  let isPolling = false;
  const pollIntervalMs = config.pollIntervalSec * 1000;

  // 1. Initial poll on startup
  isPolling = true;
  try {
    await performPoll(config);
  } catch (err) {
    logError('Initial poll failed', { error: err.message });
  } finally {
    isPolling = false;
  }

  // 2. Set up interval for continuous polling
  const intervalId = setInterval(() => {
    if (isPolling) {
      // Skip this tick - previous poll still running
      warn('Skipping poll tick - previous poll still in progress');
      return;
    }

    isPolling = true;
    performPoll(config)
      .catch(err => logError('Poll failed', { error: err.message }))
      .finally(() => { isPolling = false; });
  }, pollIntervalMs);
}
```

### Single Poll Execution

Each poll performs the following operations:

```javascript
async function performPoll(config) {
  // 1. Linear API smoke test (INN-159)
  try {
    await runSmokeQuery(config.linearApiKey);
  } catch (err) {
    logError('Linear API smoke query failed', { error: err.message });
    // Poll continues - error isolation
  }

  // 2. Fetch assigned issues (INN-160)
  let byProject = new Map();
  try {
    const { issues, truncated } = await fetchAssignedIssues(...);
    byProject = groupIssuesByProject(issues);
  } catch (err) {
    logError('Failed to fetch assigned issues', { error: err.message });
    // Poll continues - error isolation
  }

  // 3. Create sessions for projects (INN-166)
  try {
    const createdCount = await createSessionsForProjects(byProject, config);
    info('Session creation completed', { createdCount });
  } catch (err) {
    logError('Failed to create sessions', { error: err.message });
    // Poll continues - error isolation
  }

  // 4. Health check and kill (INN-168)
  try {
    const healthCheckResult = await checkAndKillUnhealthySessions(config);
    info('Health check completed', healthCheckResult);
  } catch (err) {
    logError('Failed to check/kill unhealthy sessions', { error: err.message });
    // Poll continues - error isolation
  }
}
```

## Error Isolation

All operations are wrapped in try-catch blocks to ensure transient failures don't stop future polls:

- Linear API errors: caught and logged, polling continues
- Tmux errors: caught and logged, polling continues
- Session creation errors: caught and logged, polling continues
- Health check errors: caught and logged, polling continues

**Result**: The daemon stays running indefinitely, recovering from transient failures automatically.

## Session Management

### Session Naming Convention

```
Session Name Format: ${TMUX_PREFIX}${projectId}
Example: pi_project_ABC-123 where TMUX_PREFIX="pi_project_"
```

### Ownership Rule

A session is considered "owned" by this service if:

1. It starts with `TMUX_PREFIX`
2. The suffix after the prefix is a valid project ID (alphanumeric or hyphen)
3. The suffix is non-empty

**Examples**:
- ✓ `pi_project_ABC-123` - Owned
- ✓ `pi_project_TEST` - Owned
- ✗ `my_project_ABC-123` - Not owned (different prefix)
- ✗ `pi_project_` - Not owned (no project ID)
- ✗ `pi_project_!@#$` - Not owned (invalid characters)

### Idempotent Session Creation

The service ensures sessions are created only once:

```javascript
async function ensureSession(sessionName, projectName) {
  // Check if session exists
  if (await hasSession(sessionName)) {
    return { created: false, existed: true, sessionName };
  }

  // Create session with pi prompt
  const command = `pi --prompt "pi [${projectName}] > "`;
  const success = await createSession(sessionName, command);

  if (success) {
    return { created: true, existed: false, sessionName };
  } else {
    return { created: false, existed: false, sessionName };
  }
}
```

**Result**: Repeated polls do not create duplicate sessions.

### Session Creation per Project

For each project with qualifying issues:

```javascript
for (const [projectId, { projectName }] of byProject) {
  const sessionName = `${config.tmuxPrefix}${projectId}`;
  const result = await ensureSession(sessionName, projectName);

  if (result.created) {
    debug('Session created this poll', { sessionName, projectName });
  } else if (result.existed) {
    debug('Session already exists', { sessionName, projectName });
  }
}
```

## Health Checking

### Health Modes

1. **none**: No health checks - all sessions considered healthy
2. **basic** (default): Check for dead/empty sessions

### Basic Health Check Criteria

A session is **unhealthy** if:

1. Session does not exist
2. Session has no panes
3. Any pane process has exited (pane_dead === 1)

```javascript
export async function checkSessionHealth(sessionName, healthMode) {
  // Health mode 'none' - always healthy
  if (healthMode === 'none') {
    return { healthy: true, exists: true, paneCount: 0, hasDeadPanes: false, panes: [], reason: null };
  }

  // Check if session exists
  if (!await hasSession(sessionName)) {
    return { healthy: false, exists: false, paneCount: 0, hasDeadPanes: false, panes: [], reason: 'Session does not exist' };
  }

  // Get pane information
  const panes = await listPanes(sessionName);
  const paneCount = panes.length;
  const hasDeadPanes = panes.some(pane => pane.isDead);

  // Check for no panes
  if (paneCount === 0) {
    return { healthy: false, exists: true, paneCount, hasDeadPanes, panes, reason: 'Session has no panes' };
  }

  // Check for dead panes
  if (hasDeadPanes) {
    const deadPanes = panes.filter(p => p.isDead).map(p => p.paneId);
    return { healthy: false, exists: true, paneCount, hasDeadPanes, panes, reason: `Session has dead pane(s): ${deadPanes.join(', ')}` };
  }

  // Healthy
  return { healthy: true, exists: true, paneCount, hasDeadPanes, panes, reason: null };
}
```

## Kill/Restart Gating

### Overview

The service can automatically kill unhealthy sessions, but includes cooldown protection to prevent kill/restart loops.

### Kill Process Flow

```javascript
async function attemptKillUnhealthySession(sessionName, prefix, config) {
  // 1. Check ownership
  if (!isOwnedSession(sessionName, prefix)) {
    return { killed: false, reason: 'Session not owned by this service' };
  }

  // 2. Check health
  const healthResult = await checkSessionHealth(sessionName, config.sessionHealthMode);
  if (healthResult.healthy) {
    return { killed: false, reason: 'Session is healthy' };
  }

  // 3. Log unhealthy detection
  warn('Unhealthy session detected', {
    sessionName,
    reason: healthResult.reason,
    paneCount: healthResult.paneCount,
    hasDeadPanes: healthResult.hasDeadPanes
  });

  // 4. Check if kill enabled
  if (!config.sessionKillOnUnhealthy) {
    return { killed: false, reason: 'SESSION_KILL_ON_UNHEALTHY is disabled' };
  }

  // 5. Check cooldown
  if (isWithinCooldown(sessionName, config.sessionRestartCooldownSec)) {
    const remainingSec = getRemainingCooldown(sessionName, config.sessionRestartCooldownSec);
    info('Kill skipped: session within cooldown period', {
      sessionName,
      remainingSec,
      cooldownSec: config.sessionRestartCooldownSec
    });
    return { killed: false, reason: `Within cooldown period (${remainingSec}s remaining)` };
  }

  // 6. Attempt to kill
  const killed = await killSession(sessionName);
  if (killed) {
    recordKillAttempt(sessionName);
    info('Unhealthy session killed', { sessionName });
    return { killed: true, reason: 'Session killed successfully' };
  } else {
    return { killed: false, reason: 'Failed to kill session' };
  }
}
```

### Cooldown Mechanism

In-memory map tracks last kill attempt timestamps:

```javascript
const lastKillAttempts = new Map(); // sessionName -> timestamp

// Record kill attempt
recordKillAttempt(sessionName); // Sets timestamp

// Check if in cooldown
isWithinCooldown(sessionName, cooldownSec); // Returns true if < cooldownSec

// Get remaining time
getRemainingCooldown(sessionName, cooldownSec); // Returns seconds remaining
```

**Purpose**: Prevents kill/restart loops for sessions that fail to start properly.

Example:
```
Time 0s:   Unhealthy detected, killed, cooldown recorded
Time 1s:   Unhealthy detected, SKIPPED (in cooldown, 59s remaining)
Time 2s:   Unhealthy detected, SKIPPED (in cooldown, 58s remaining)
...
Time 60s:  Unhealthy detected, killed (cooldown expired)
```

## Configuration

### Required Environment Variables

```bash
LINEAR_API_KEY=lin_api_your_api_key_here    # Linear API authentication
ASSIGNEE_ID=user_id_here                    # Linear user ID to filter issues
```

### Optional Configuration

```bash
# Polling Behavior
POLL_INTERVAL_SEC=300                        # Poll interval in seconds (default: 300)
LINEAR_PAGE_LIMIT=100                        # Max issues to fetch (default: 100)
LINEAR_OPEN_STATES=Todo,In Progress         # States considered "open" (default: Todo,In Progress)

# tmux Session Management
TMUX_PREFIX=pi_project_                     # Session prefix (default: pi_project_)

# Health & Recovery
SESSION_HEALTH_MODE=basic                    # Health check mode (default: basic)
SESSION_KILL_ON_UNHEALTHY=false             # Kill unhealthy sessions (default: false)
SESSION_RESTART_COOLDOWN_SEC=60             # Cooldown before re-kill (default: 60)

# Logging
LOG_LEVEL=info                              # Log level: error, warn, info, debug (default: info)
```

## Logging

### Log Levels

1. **debug**: Verbose output for troubleshooting
2. **info**: Normal operational messages
3. **warn**: Warning messages (e.g., skipped poll, unhealthy session)
4. **error**: Error messages (e.g., API failure, session creation failed)

### Log Format

All logs are structured JSON:

```json
{
  "timestamp": "2026-02-07T15:57:32.348Z",
  "level": "INFO",
  "message": "Configuration loaded",
  "linearApiKey": "***masked***",
  "assigneeId": "user_id_here",
  "pollIntervalSec": 300,
  ...
}
```

### Key Logs by Category

**Startup**:
- Startup banner
- Configuration loaded (with sensitive values masked)
- Poll loop started

**Polling**:
- Initial poll on startup
- Skipping poll tick (if previous poll still running)

**Linear API**:
- Smoke query success/failure
- Fetching assigned issues
- Issues fetched with count
- Projects with qualifying issues

**Session Management**:
- Session created
- Session already exists
- Session creation completed

**Health Checks**:
- Unhealthy session detected
- Kill skipped (within cooldown)
- Unhealthy session killed
- Health check completed (with statistics)

**Errors**:
- Linear API failures
- Tmux command failures
- Session creation failures
- Health check failures

## Linear Integration

### GraphQL Queries

#### Smoke Test Query

```graphql
query Viewer {
  viewer {
    id
    name
  }
}
```

Purpose: Verify API key is valid on startup.

#### Fetch Assigned Issues Query

```graphql
query FetchAssignedIssues($assigneeId: String!, $states: [String!], $first: Int!) {
  issues(filter: { assignee: { id: { eq: $assigneeId } }, state: { name: { in: $states } }}, first: $first) {
    nodes {
      id
      identifier
      title
      state {
        id
        name
      }
      project {
        id
        name
      }
    }
    pageInfo {
      hasNextPage
    }
  }
}
```

Purpose: Fetch issues assigned to the user in open states.

### Issue Grouping

Issues are grouped by project:

```javascript
function groupIssuesByProject(issues) {
  const byProject = new Map();

  for (const issue of issues) {
    const project = issue.project;

    if (!project) {
      debug('Ignoring issue without project', { issueId: issue.id });
      continue;
    }

    if (!byProject.has(project.id)) {
      byProject.set(project.id, {
        projectId: project.id,
        projectName: project.name,
        issueCount: 0,
        issues: []
      });
    }

    const projectData = byProject.get(project.id);
    projectData.issueCount++;
    projectData.issues.push(issue);
  }

  return byProject;
}
```

## Tmux Integration

### Command Execution

All tmux commands use `child_process.spawn`:

```javascript
export function execTmux(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('tmux', args);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code });
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}
```

### Supported Tmux Operations

| Operation | Command | Purpose |
|-----------|----------|---------|
| Check session | `tmux has-session -t <name>` | Check if session exists |
| Create session | `tmux new-session -d -s <name> <cmd>` | Create detached session |
| Kill session | `tmux kill-session -t <name>` | Kill a session |
| List sessions | `tmux list-sessions -F '#{session_name}'` | List all sessions |
| List panes | `tmux list-panes -t <name> -F '#{pane_id}:#{pane_pid}:#{pane_current_command}:#{pane_dead}'` | Get pane info for health checks |

## Test Scripts

The project includes several test scripts to verify functionality:

- **test-skip-behavior.js**: Verifies serialized polling skip behavior
- **test-session-ownership.js**: Verifies session naming and ownership rules
- **test-idempotent-session.js**: Verifies idempotent session creation
- **test-health-check.js**: Verifies health check functionality
- **test-kill-restart-gating.js**: Verifies kill/restart gating with cooldown
- **test-error-isolation.js**: Verifies errors don't stop future polls

Run tests:
```bash
node test-skip-behavior.js
node test-session-ownership.js
# etc.
```

## Deployment

The service is designed to run as a systemd user unit at `~/.config/systemd/user/pi-linear.service`.

### Start the Service

```bash
# Manual start
node index.js

# Via systemd
systemctl --user start pi-linear
systemctl --user enable pi-linear  # Start on boot
```

### Stop the Service

```bash
# Ctrl+C (manual)
systemctl --user stop pi-linear  # systemd
```

## Troubleshooting

### Service not creating sessions

Check logs for:
- `"Fetching assigned issues"` - Are issues being fetched?
- `"Projects with qualifying issues"` - Do any projects have issues?
- `"Session created"` - Are sessions being created?

### Sessions being killed unexpectedly

Check configuration:
- `SESSION_KILL_ON_UNHEALTHY` - Is this true?
- `SESSION_RESTART_COOLDOWN_SEC` - Is cooldown appropriate?

### Polling appears stuck

Check logs:
- `"Skipping poll tick - previous poll still in progress"` - Is a poll taking too long?
- Check for Linear API timeouts or network issues
- Check for tmux command failures

### All polls failing with errors

Check environment:
- `LINEAR_API_KEY` - Is it valid?
- `ASSIGNEE_ID` - Is it correct?
- Is tmux installed and working?

## Data Flow Summary

```
┌─────────────────┐
│   Config       │  LINEAR_API_KEY, ASSIGNEE_ID, etc.
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│                  Poll Loop (every N seconds)          │
└─────────────────────────────────────────────────────────┘
         │
         ├──────────────────────────────────────────────┐
         │                                              │
         ▼                                              ▼
┌────────────────┐                           ┌────────────────┐
│  Linear API    │                           │   Tmux         │
│                │                           │                │
│ 1. Smoke test │                           │ 1. List       │
│ 2. Fetch       │   byProject Map            │   sessions     │
│    issues       │◄───────────────────────────│ 2. Create     │
│ 3. Group by    │                           │   sessions     │
│    project      │                           │ 3. Health     │
│                │                           │   check       │
└────────────────┘                           └────────────────┘
         │                                              │
         │                 Unhealthy                       │
         └─────────────────────┬─────────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │  Kill Decision      │
                    │                     │
                    │ 1. Check ownership  │
                    │ 2. Check health    │
                    │ 3. Check cooldown  │
                    │ 4. Kill if ok      │
                    └─────────────────────┘
```
