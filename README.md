# pi-linear-service

A Node.js daemon that polls the Linear GraphQL API and manages per-project pi sessions (RPC mode by default) for the pi coding assistant.

## Features

- **Automated session creation**: Creates one persistent `pi --mode rpc` process per Linear project (default), optionally configured with `--provider/--model`
- **Polling**: Continuously polls Linear API for new issues
- **One-at-a-time prompting**: Sends a prompt to a project session only when it is idle
- **Timeout handling**: Aborts + restarts stuck RPC sessions (default timeout: 120s)
- **Error isolation**: Transient failures don't stop the daemon
- **Cooldown protection**: Prevents restart loops for failing sessions

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

#### Dry-run Mode

```bash
# Dry-run mode (default: false)
# If true, the service logs intended session actions without executing them
# Useful for first-time setup to verify configuration before making actual changes
# Linear API calls still work normally in dry-run mode
DRY_RUN=false
```

**Use case:** First-time setup
- Set `DRY_RUN=true` when you first configure the service
- Run the service and verify that:
  - Linear API calls work (issues are fetched correctly)
  - Session creation would happen for the right projects
  - Health checks detect sessions properly
- Once verified, set `DRY_RUN=false` to start actual session management

### Mode Configuration (settings.json)

The service supports two modes:
- **RPC mode (default)**: runs `pi --mode rpc` as a persistent process per Linear project.
- **Legacy mode**: uses the previous tmux/process session manager logic.

Settings file location:
```
~/.pi/agent/extensions/pi-linear-service/settings.json
```

#### RPC workspace directory (start pi in the correct repo)

If your GitHub repos are cloned under a base directory (e.g. `~/dvl`) and the folder name matches the Linear project name, set:
- `rpc.workspaceRoot` in `settings.json`, or
- `RPC_WORKSPACE_ROOT` env var.

Then `pi` is spawned with `cwd = <workspaceRoot>/<LinearProjectName>`.

If the repo folder name differs from the Linear project name, use:
- `rpc.projectDirOverrides` (map of `projectName` or `projectId` → directory)
  - value can be relative to `rpc.workspaceRoot` or an absolute path.

#### Settings File Location

```
~/.pi/agent/extensions/pi-linear-service/settings.json
```

#### Supported Session Managers

**1. Tmux Manager (Default)**
- Uses tmux to create and manage sessions
- Backward compatible with existing configurations
- Best for interactive terminal-based workflows

**2. Process Manager (New)**
- Runs any command as a standalone process
- Keeps control of the process - no duplicate processes until it exits
- Health checks based on process status
- Useful for non-terminal workflows or custom integrations

#### Creating settings.json

If the file doesn't exist, the service uses default configuration (tmux manager).

Create the directory and file:
```bash
mkdir -p ~/.pi/agent/extensions/pi-linear-service
cp settings.json.example ~/.pi/agent/extensions/pi-linear-service/settings.json
```

#### Configuration Examples

**Example 1: Default Tmux Configuration**

```json
{
  "sessionManager": {
    "type": "tmux",
    "tmux": {
      "prefix": "pi_project_"
    }
  }
}
```

**Example 2: Custom Prefix**

```json
{
  "sessionManager": {
    "type": "tmux",
    "tmux": {
      "prefix": "my_work_"
    }
  }
}
```

**Example 3: Process Manager with Custom Command**

```json
{
  "sessionManager": {
    "type": "process",
    "process": {
      "command": "pi",
      "args": [],
      "prefix": "pi_project_"
    }
  }
}
```

**Example 4: Process Manager with Arguments**

```json
{
  "sessionManager": {
    "type": "process",
    "process": {
      "command": "/usr/bin/python3",
      "args": ["--project", "${projectName}", "--issues", "${issueCount}"],
      "prefix": "my_project_"
    }
  }
}
```

#### Process Manager Placeholders

The `args` array supports the same placeholders as `SESSION_COMMAND_TEMPLATE`:

| Placeholder | Description |
|------------|-------------|
| `${projectName}` | Name of the project |
| `${projectId}` | Project ID |
| `${sessionId}` | Full session name |
| `${issueCount}` | Number of qualifying issues |

#### Process Manager Behavior

When using the process manager:

1. **Single instance guarantee** - Only one process per session name is tracked
2. **Process monitoring** - Service monitors process status and detects exits
3. **Automatic cleanup** - Dead processes are removed from tracking
4. **Graceful shutdown** - Processes are terminated with SIGTERM followed by SIGKILL
5. **Command validation** - The service logs output from stdout/stderr for debugging

#### Configuration Precedence

1. `settings.json` - Base configuration
2. Environment variables - Override settings.json (e.g., `TMUX_PREFIX`)

This means you can use settings.json for the main configuration and override specific values via environment variables.

#### Backward Compatibility

- If `settings.json` doesn't exist, the service defaults to tmux manager
- All existing environment variables continue to work
- No migration required - service works with or without settings.json

#### Verifying Configuration

The service prints the session manager type and configuration on startup:

```
Configuration Summary:
  ...
  Session Manager:
    Type: process
    Command: pi
    Args: []
    Prefix: pi_project_
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

To run the service automatically on boot and restart on failure:

### 1. Copy the systemd user unit file

The project includes a `pi-linear.service` file in the root directory.

```bash
# Create the systemd user directory
mkdir -p ~/.config/systemd/user/

# Copy the unit file
cp pi-linear.service ~/.config/systemd/user/
```

### 2. Edit the unit file

Update the paths to match your installation:

```bash
nano ~/.config/systemd/user/pi-linear.service
```

**Important:** You MUST edit these two paths:

1. **WorkingDirectory** - Path to your pi-linear-service directory:
   ```ini
   WorkingDirectory=/home/user/pi-linear-service
   ```

2. **ExecStart** - Full path to your Node.js binary:
   ```ini
   ExecStart=/home/user/.nvm/versions/node/v24.11.1/bin/node index.js
   ```

   To find your Node.js path, run:
   ```bash
   which node
   ```

3. **EnvironmentFile** (optional) - Path to your .env file (same as WorkingDirectory):
   ```ini
   EnvironmentFile=/home/user/pi-linear-service/.env
   ```

**Note:** You can use systemd specifiers like `%h` (home directory) for portability:
```ini
WorkingDirectory=%h/pi-linear-service
EnvironmentFile=%h/pi-linear-service/.env
```

**Common Node.js installation paths:**
- **nvm**: `/home/user/.nvm/versions/node/v24.11.1/bin/node`
- **system**: `/usr/bin/node`
- **Homebrew**: `/usr/local/bin/node`
- **snap**: `/snap/node/current/bin/node`

### 3. Reload systemd and enable service

```bash
# Reload systemd daemon to pick up new unit file
systemctl --user daemon-reload

# Start the service
systemctl --user start pi-linear.service

# Enable the service to start on boot
systemctl --user enable pi-linear.service
```

### 4. Check status and logs

```bash
# Check service status
systemctl --user status pi-linear.service

# View recent logs
journalctl --user -u pi-linear.service -n 50

# Follow logs in real-time
journalctl --user -u pi-linear.service -f

# View logs since last boot
journalctl --user -u pi-linear.service -b
```

### 5. Managing the service

```bash
# Stop the service
systemctl --user stop pi-linear.service

# Restart the service
systemctl --user restart pi-linear.service

# Disable auto-start on boot
systemctl --user disable pi-linear.service

# Check if service is enabled
systemctl --user is-enabled pi-linear.service
```

### Unit File Features

The `pi-linear.service` unit file includes:

- **Restart on failure**: Automatically restarts if the service crashes
- **Restart backoff**: Waits 5 seconds between restart attempts
- **Environment file**: Loads configuration from `.env` (no secrets in unit file)
- **Security**: `NoNewPrivileges=true` and `PrivateTmp=true` for hardening
- **Logging**: Logs to systemd journal with `pi-linear` identifier
- **Standard paths**: Installs to `~/.config/systemd/user/` for user services

### Troubleshooting

**Service fails to start:**
```bash
# Check detailed error
journalctl --user -u pi-linear.service -n 100 --no-pager

# Verify paths in unit file
systemctl --user cat pi-linear.service
```

**Service not starting on boot:**
```bash
# Check if systemd user session is lingering
loginctl show-user $USER | grep Linger

# Enable lingering (if not enabled)
loginctl enable-linger $USER
```

**Environment variables not loaded:**
```bash
# Verify .env file exists and is readable
cat ~/.config/systemd/user/pi-linear.service | grep EnvironmentFile
ls -la /path/to/.env
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

## Acceptance Criteria Verification

This section provides a checklist to verify that all acceptance criteria from the PRD are met.

### Local Run Verification

#### 1. Verify Environment Setup

**Criterion:** Local run (`node index.js`) with a valid `.env`

**Steps:**
```bash
# Verify .env file exists
ls -la .env

# Verify required variables are set
grep -E "^(LINEAR_API_KEY|ASSIGNEE_ID)" .env
```

**Expected output:**
```
LINEAR_API_KEY=lin_api_...
ASSIGNEE_ID=your_user_id
```

**Interpretation:** If both variables are set with non-empty values, environment setup is verified.

---

#### 2. Verify Immediate Poll on Startup

**Criterion:** Immediate poll occurs on startup

**Steps:**
```bash
# Run the service and check startup logs
node index.js 2>&1 | head -20
```

**Expected output:**
```
{"timestamp":"...","level":"INFO","message":"Performing initial poll on startup"}
{"timestamp":"...","level":"INFO","message":"Poll started"}
```

**Interpretation:** If you see "Performing initial poll on startup" followed by "Poll started", the immediate poll criterion is met.

---

#### 3. Verify Session Creation (Idempotence)

**Criterion:** One tmux session per qualifying project is created, no duplicates on subsequent polls

**Steps:**
```bash
# First poll - check sessions created
node index.js &
sleep 2
tmux list-sessions | grep pi_project_
pkill -f "node index.js"

# Second poll - verify no duplicates
node index.js &
sleep 2
tmux list-sessions | grep pi_project_
pkill -f "node index.js"
```

**Expected output:**
```
# First poll: Sessions appear (e.g., 1 session)
pi_project_ABC-123

# Second poll: Same sessions (no increase in count)
pi_project_ABC-123
```

**Interpretation:** If session count doesn't increase on second poll, idempotence is verified.

---

#### 4. Verify Health Detection (Exited Pane)

**Criterion:** Exited pane/process ⇒ unhealthy immediately

**Steps:**
```bash
# Create a test session with a command that exits immediately
tmux new-session -d -s pi_test_123 "exit"

# Run the service with health check enabled
SESSION_HEALTH_MODE=basic SESSION_KILL_ON_UNHEALTHY=false node index.js &
sleep 5
journalctl --user -u pi-linear 2>&1 | grep -E "(unhealthy|Unhealthy)" | tail -5
pkill -f "node index.js"
```

**Expected output:**
```
{"level":"INFO","message":"Unhealthy session detected","sessionName":"pi_test_123","reason":"Session has dead pane(s): %0"}
```

**Interpretation:** If the session is detected as unhealthy immediately after the pane exits, health detection is verified.

---

#### 5. Verify Kill/Restart with Cooldown

**Criterion:** If `SESSION_KILL_ON_UNHEALTHY=true`, unhealthy sessions are killed and recreated, respecting cooldown

**Steps:**
```bash
# Create a test unhealthy session
tmux new-session -d -s pi_test_456 "exit"

# Run service with kill enabled and short cooldown
SESSION_HEALTH_MODE=basic SESSION_KILL_ON_UNHEALTHY=true SESSION_RESTART_COOLDOWN_SEC=10 node index.js &
sleep 5

# Check logs for kill
journalctl --user -u pi-linear 2>&1 | grep -E "(killed|kill)" | tail -5

# Check cooldown (should skip kill if within cooldown)
sleep 3
journalctl --user -u pi-linear 2>&1 | grep -i cooldown | tail -3

pkill -f "node index.js"
```

**Expected output:**
```
# First detection (kill)
{"level":"INFO","message":"Unhealthy session killed","sessionName":"pi_test_456"}

# Within cooldown (skip)
{"level":"INFO","message":"Unhealthy session (within cooldown)","sessionName":"pi_test_456","reason":"Within cooldown period"}
```

**Interpretation:** If kill happens once and then is skipped during cooldown, the kill/restart gating is verified.

---

### User Unit Deployment Verification

#### 1. Verify Unit File Installation

**Criterion:** `~/.config/systemd/user/pi-linear.service` works with `systemctl --user`

**Steps:**
```bash
# Check unit file exists
ls -la ~/.config/systemd/user/pi-linear.service

# Verify unit file is valid
systemctl --user cat pi-linear.service
```

**Expected output:**
```
[Unit]
Description=pi-linear-service - Node.js daemon for Linear + tmux + pi integration
...
```

**Interpretation:** If `systemctl --user cat` shows the unit file content without errors, installation is verified.

---

#### 2. Verify EnvironmentFile Usage

**Criterion:** Uses `EnvironmentFile=`

**Steps:**
```bash
# Check that EnvironmentFile is configured
systemctl --user cat pi-linear.service | grep EnvironmentFile
```

**Expected output:**
```
EnvironmentFile=/home/user/pi-linear-service/.env
```

**Interpretation:** If `EnvironmentFile=` points to your `.env` file (not inline environment variables), this criterion is met.

---

#### 3. Verify Restart on Failure

**Criterion:** Restarts on failure

**Steps:**
```bash
# Check restart configuration
systemctl --user cat pi-linear.service | grep -E "(Restart|RestartSec)"

# Start the service
systemctl --user start pi-linear.service

# Check current status
systemctl --user status pi-linear.service | grep -i restart

# Stop the service
systemctl --user stop pi-linear.service
```

**Expected output:**
```
Restart=on-failure
RestartSec=5s
```

**Interpretation:** If `Restart=on-failure` and `RestartSec=` are configured, restart on failure is verified.

---

#### 4. Verify Log Viewing

**Criterion:** README shows how to view logs with `journalctl --user -u pi-linear.service`

**Steps:**
```bash
# View recent logs
journalctl --user -u pi-linear.service -n 20

# Follow logs in real-time (Ctrl+C to exit)
journalctl --user -u pi-linear.service -f
```

**Expected output:**
```
Feb 07 17:50:01 hostname pi-linear[123]: {"timestamp":"...","level":"INFO","message":"Poll started"}
...
```

**Interpretation:** If logs from the pi-linear service are displayed with timestamps and JSON entries, log viewing is verified.

---

#### 5. Verify Start-on-Boot for User

**Criterion:** README shows how to ensure start-on-boot for user

**Steps:**
```bash
# Check if lingering is enabled (allows user services to start on boot)
loginctl show-user $USER | grep Linger

# If not enabled, enable lingering
loginctl enable-linger $USER

# Verify it's enabled
loginctl show-user $USER | grep Linger
```

**Expected output:**
```
Linger=yes
```

**Interpretation:** If `Linger=yes`, user services will start on boot. The command `loginctl enable-linger $USER` is documented in README.

---

### Verification Summary

Use this checklist to ensure all acceptance criteria are verified:

**Local Run:**
- [ ] Environment setup (`.env` with `LINEAR_API_KEY` and `ASSIGNEE_ID`)
- [ ] Immediate poll on startup
- [ ] Session creation is idempotent (no duplicates)
- [ ] Exited pane is detected as unhealthy
- [ ] Kill/restart respects cooldown

**User Unit Deployment:**
- [ ] Unit file works with `systemctl --user`
- [ ] Uses `EnvironmentFile=`
- [ ] Restarts on failure
- [ ] Logs viewable with `journalctl --user -u pi-linear.service`
- [ ] Start-on-boot configured (`loginctl enable-linger`)

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
