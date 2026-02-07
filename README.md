# pi-linear-service

A Node.js daemon that polls the Linear GraphQL API and manages per-project tmux sessions with the pi coding assistant.

## Features

- **Automated session creation**: Creates tmux sessions for projects where you have assigned issues
- **Polling**: Continuously polls Linear API for new issues (default: every 5 minutes)
- **Batch processing**: Each session runs pi in non-interactive mode to process one task at a time
- **Health checking**: Monitors session health and optionally kills unhealthy sessions
- **Error isolation**: Transient failures don't stop the daemon
- **Cooldown protection**: Prevents kill/restart loops for failing sessions

## Quick Start

### 1. Clone and Install

```bash
cd pi-linear-service
npm install
```

### 2. Create Configuration File

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
nano .env  # or your preferred editor
```

### 3. Configure Required Variables

Edit `.env` and set at minimum:

```bash
# REQUIRED: Get from https://linear.app/settings/api
LINEAR_API_KEY=lin_api_your_actual_key_here

# REQUIRED: Your Linear user ID
ASSIGNEE_ID=your_user_id_here
```

### 4. Run the Service

```bash
# Run in foreground (for testing)
node index.js

# Or run in background
nohup node index.js &
```

## Configuration

### Required Environment Variables

| Variable | Description | How to Get |
|----------|-------------|--------------|
| `LINEAR_API_KEY` | Linear API authentication key | Go to https://linear.app/settings/api |
| `ASSIGNEE_ID` | Linear user ID to filter issues | Run: `linear issue view` or check Linear UI settings |

### Optional Configuration

#### Polling Behavior

```bash
# Poll interval in seconds (default: 300, minimum: 5)
POLL_INTERVAL_SEC=300

# Maximum number of issues to fetch per poll (default: 100)
LINEAR_PAGE_LIMIT=100

# Comma-separated list of Linear issue states considered "open"
LINEAR_OPEN_STATES=Todo,In Progress
```

#### Tmux Session Management

```bash
# Prefix for tmux sessions (default: pi_project_)
# Sessions with this prefix are considered "owned" by this service
TMUX_PREFIX=pi_project_

# Command template for sessions with placeholders (see below)
SESSION_COMMAND_TEMPLATE=pi -p "You are working on project: ${projectName} list issues and choose one to work on, if an issue is already in progress - continue"
```

#### Session Command Template Placeholders

The `SESSION_COMMAND_TEMPLATE` supports these placeholders:

| Placeholder | Description | Example |
|------------|-------------|---------|
| `${projectName}` | Name of the project | "Frontend App" |
| `${projectId}` | Project ID | "ABC-123" |
| `${sessionId}` | Full session name | "pi_project_ABC-123" |
| `${issueCount}` | Number of qualifying issues | `5` |

**Template Examples:**

```bash
# Default
SESSION_COMMAND_TEMPLATE=pi -p "You are working on project: ${projectName} list issues and choose one to work on, if an issue is already in progress - continue"

# Simpler version
SESSION_COMMAND_TEMPLATE=pi -p "Work on project ${projectName}"

# Include issue count
SESSION_COMMAND_TEMPLATE=pi -p "Project ${projectName} has ${issueCount} issues available"

# Include project details
SESSION_COMMAND_TEMPLATE=pi -p "Working on ${projectName} (${projectId}) in session ${sessionId}"
```

#### Health & Recovery

```bash
# Health check mode: none | basic (default: basic)
# - none: No health checks
# - basic: Check for dead/empty sessions
SESSION_HEALTH_MODE=basic

# Kill unhealthy sessions (default: false)
# WARNING: Can cause session termination
SESSION_KILL_ON_UNHEALTHY=false

# Cooldown period in seconds before re-killing a session (default: 60)
SESSION_RESTART_COOLDOWN_SEC=60
```

#### Logging

```bash
# Log level: error | warn | info | debug (default: info)
LOG_LEVEL=info
```

## How It Works

### 1. Polling Loop

The service polls Linear API at regular intervals:

```
┌────────────────────────────────────────────┐
│  Poll every POLL_INTERVAL_SEC seconds    │
└──────────────┬─────────────────────────┘
               │
               ▼
        ┌────────────┐
        │ Linear API │
        │            │
        │ Get issues │
        └─────┬──────┘
              │
              ▼
    ┌──────────────────┐
    │ Group by project │
    └──────┬──────────┘
           │
           ▼
    ┌──────────────────┐
    │ Create session  │
    │ per project     │
    └──────┬──────────┘
           │
           ▼
    ┌──────────────────┐
    │ pi -p "..."     │  <- Non-interactive
    └──────┬──────────┘
           │
           ▼
      Pi exits
           │
           ▼
    Session considered
    "finished" (unhealthy)
```

### 2. Session Creation Workflow

For each project with qualifying issues:

1. **Check if session exists** - Uses `TMUX_PREFIX` for ownership
2. **If missing, create session** - Runs pi with configured template
3. **Pi processes in non-interactive mode** - Uses `-p` flag
4. **Pi exits** - After processing the prompt
5. **Session is "finished"** - Health check detects it as unhealthy
6. **Next poll recreates** - If project still has qualifying issues

### 3. Session Naming

```
Session Name: ${TMUX_PREFIX}${projectId}
Example: pi_project_ABC-123
```

Attach to a session:
```bash
tmux attach -t pi_project_ABC-123
```

List all sessions:
```bash
tmux list-sessions
```

## Example .env File

```bash
# -----------------------------------------------------------------------------
# REQUIRED CONFIGURATION
# -----------------------------------------------------------------------------

# Linear API authentication key
LINEAR_API_KEY=lin_api_abc123yourkeyhere...

# Linear user ID to filter issues by assignee
ASSIGNEE_ID=USER-ABC-123

# -----------------------------------------------------------------------------
# OPTIONAL CONFIGURATION - Polling Behavior
# -----------------------------------------------------------------------------

# Polling interval in seconds (default: 300)
POLL_INTERVAL_SEC=300

# Maximum number of issues to fetch per poll (default: 100)
LINEAR_PAGE_LIMIT=100

# Comma-separated list of Linear issue states to consider "open"
LINEAR_OPEN_STATES=Todo,In Progress

# -----------------------------------------------------------------------------
# OPTIONAL CONFIGURATION - tmux Session Management
# -----------------------------------------------------------------------------

# Prefix for tmux sessions created by this service (default: pi_project_)
TMUX_PREFIX=pi_project_

# Command template for sessions with placeholders
SESSION_COMMAND_TEMPLATE=pi -p "You are working on project: ${projectName} list issues and choose one to work on, if an issue is already in progress - continue"

# -----------------------------------------------------------------------------
# OPTIONAL CONFIGURATION - Health & Recovery
# -----------------------------------------------------------------------------

# Health check mode (default: basic)
SESSION_HEALTH_MODE=basic

# Kill unhealthy sessions (default: false)
SESSION_KILL_ON_UNHEALTHY=false

# Cooldown period in seconds before re-killing a session (default: 60)
SESSION_RESTART_COOLDOWN_SEC=60

# -----------------------------------------------------------------------------
# OPTIONAL CONFIGURATION - Logging
# -----------------------------------------------------------------------------

# Log level (default: info)
LOG_LEVEL=info
```

## Running as Systemd Service

To run the service automatically on boot:

### 1. Create systemd user unit file

```bash
mkdir -p ~/.config/systemd/user/
nano ~/.config/systemd/user/pi-linear.service
```

### 2. Create unit file content

```ini
[Unit]
Description=pi-linear-service - Linear + tmux + pi integration
After=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/node %h/pi-linear-service/index.js
WorkingDirectory=%h/pi-linear-service
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
```

### 3. Reload systemd and enable service

```bash
systemctl --user daemon-reload
systemctl --user enable pi-linear.service
systemctl --user start pi-linear.service
```

### 4. Check status and logs

```bash
# Check status
systemctl --user status pi-linear.service

# View logs
journalctl --user -u pi-linear.service -f
```

## Testing

Run the included test scripts:

```bash
# Test polling skip behavior
node test-skip-behavior.js

# Test error isolation
node test-error-isolation.js

# Test session ownership rules
node test-session-ownership.js

# Test session command template
node test-session-command-template.js

# Test recovery behavior (requires tmux)
node test-recovery-behavior.js
```

## Troubleshooting

### Service doesn't create sessions

**Check logs for:**
- `"Fetching assigned issues"` - Are issues being fetched?
- `"Projects with qualifying issues"` - Do any projects have issues?
- `"Session created"` - Are sessions being created?

**Common causes:**
- Wrong `ASSIGNEE_ID` - Check you have the correct user ID
- No issues in open states - Check if you have issues in Todo/In Progress
- Wrong `LINEAR_OPEN_STATES` - Verify the state names match your Linear workspace

### All polls failing with errors

**Check environment:**
- `LINEAR_API_KEY` - Is it valid and active?
- `ASSIGNEE_ID` - Is it correct?

**Check logs for:**
- `"GraphQL query returned errors"` - API errors
- `"Failed to fetch assigned issues"` - Network or permission issues

### Sessions being killed unexpectedly

**Check configuration:**
- `SESSION_KILL_ON_UNHEALTHY` - Is this true? Set to `false` to disable
- `SESSION_RESTART_COOLDOWN_SEC` - Is this too short?

**Check logs for:**
- `"Unhealthy session detected"` - Why is session considered unhealthy?
- `"Unhealthy session killed"` - Confirm kills are expected

### Polling appears stuck

**Check logs for:**
- `"Skipping poll tick - previous poll still in progress"` - Is a poll taking too long?
- Check for Linear API timeouts
- Check for tmux command failures

### Can't attach to session

**Check:**
- `tmux` is installed: `tmux -V`
- Session exists: `tmux list-sessions`

**Attach command:**
```bash
tmux attach -t pi_project_ABC-123
```

## Getting Help

### View All Options

```bash
node index.js --help
```

### View Configuration Summary

The service prints a configuration summary on startup (with secrets masked):

```
╔════════════════════════════════════════════════════════════╗
║              pi-linear-service v1.0.0                          ║
║  Node.js daemon for Linear + tmux + pi integration             ║
╚══════════════════════════════════════════════════════════════╝

Configuration Summary:
  Required:
    LINEAR_API_KEY: ***masked***
    ASSIGNEE_ID: USER-ABC-123
  Polling:
    POLL_INTERVAL_SEC: 300
    TMUX_PREFIX: pi_project_
    LINEAR_OPEN_STATES: Todo,In Progress
    LINEAR_PAGE_LIMIT: 100
  Health & Recovery:
    SESSION_HEALTH_MODE: basic
    SESSION_KILL_ON_UNHEALTHY: false
    SESSION_RESTART_COOLDOWN_SEC: 60
  Session Command:
    SESSION_COMMAND_TEMPLATE: pi -p "You are working on project: ${projectName} list issues and choose one to work on, if an issue is already in progress - continue"
  Logging:
    LOG_LEVEL: info
```

## Development

### Project Structure

```
pi-linear-service/
├── index.js              # Entry point
├── package.json           # Dependencies
├── .env.example          # Configuration template
├── src/
│   ├── config.js        # Configuration validation
│   ├── poller.js        # Polling loop
│   ├── linear.js        # Linear GraphQL client
│   ├── tmux.js         # Tmux session management
│   ├── health.js        # Health check helpers
│   └── logger.js        # Logging
├── test-*.js            # Test scripts
├── README.md             # This file
├── FUNCTIONALITY.md      # Implementation details
├── PRD.md               # Product requirements
└── TODO.md              # Development tasks
```

### Running Tests

```bash
# Run all tests
for test in test-*.js; do
    echo "Running $test..."
    node "$test" || echo "Test failed: $test"
done
```

## License

MIT

## Contributing

Contributions welcome! Please submit issues and pull requests on GitHub.
