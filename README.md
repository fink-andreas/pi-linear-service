# pi-linear-service

A Node.js daemon that polls the Linear GraphQL API and runs the **pi** coding agent **per Linear project**.

Default behavior is **RPC mode**: one persistent `pi --mode rpc` process per project, driven via NDJSON RPC over stdin/stdout.

## Quickstart (fast happy path)

### 1) Install as a pi package (global)
```bash
pi install git:github.com/fink-andreas/pi-linear-service
```

### 2) Enable extension resource
```bash
pi config
```
Enable the `pi-linear-service` extension.

### 3) Configure required env for the daemon
```bash
export LINEAR_API_KEY="lin_xxx"
export ASSIGNEE_ID="<your-linear-user-id-or-slug>"
```

### 4) Open pi and run guided setup
```text
/linear-daemon-setup
```
Provide project id + repo path (absolute path required), then confirm success.

### 5) Start daemon service
```text
/linear-daemon-start
```

### 6) Confirm status
```text
/linear-daemon-status              # show all projects
/linear-daemon-status --name "My Project"  # show specific project
```

---

## Features

- **RPC mode (default):** persistent `pi --mode rpc` per Linear project
- **One-at-a-time prompting:** only sends a new prompt when the project session is idle
- **Repo-aware execution:** start `pi` in the right repo directory via explicit project mapping
- **Model/provider selection:** pass `--provider/--model` to `pi`
- **pi-native extension commands:** setup/reconfigure/status/lifecycle inside pi
- **pi-native Linear issue tools:** `linear_issue_start`, `linear_issue_comment_add`, `linear_issue_update` (direct GraphQL)
- **systemd user service support:** install/uninstall/status commands for background operation
- **Timeout + recovery:** abort + cooldown + restart if RPC calls hang (default 120s)
- **Graceful shutdown:** handles `SIGINT`/`SIGTERM`, stops polling, and cleans up managed sessions

## Install flows (global and local)

### Global install
```bash
pi install git:github.com/fink-andreas/pi-linear-service
pi list
```

### Project-local install
Run in your target repository:
```bash
pi install git:github.com/fink-andreas/pi-linear-service -l
pi list
```

After install, run `pi config` in the same scope (global or local) to enable/disable packaged resources.

## Full example: install -> configured -> active monitoring

1. Install package globally:
   ```bash
   pi install git:github.com/fink-andreas/pi-linear-service
   ```
2. Enable extension in `pi config`.
3. Ensure Linux user-systemd is available:
   ```bash
   systemctl --user status
   ```
4. Export daemon env:
   ```bash
   export LINEAR_API_KEY="lin_xxx"
   export ASSIGNEE_ID="<your-assignee>"
   ```
5. Open `pi` and run:
   ```text
   /linear-daemon-setup
   ```
   Fill in:
   - project id
   - optional project name
   - absolute repo path (required)
   - assignee mode (`me` or `all`)
   - open states
   - optional runtime overrides
6. Start daemon:
   ```text
   /linear-daemon-start
   ```
7. Check status:
   ```text
   /linear-daemon-status
   ```
8. Reconfigure later if needed:
   ```text
   /linear-daemon-reconfigure
   ```
9. Stop/restart daemon when needed:
   ```text
   /linear-daemon-stop
   /linear-daemon-restart
   ```

## In-pi extension commands

- `/linear-daemon-setup`
- `/linear-daemon-reconfigure`
- `/linear-daemon-status [--id <id> | --name <name>]`
- `/linear-daemon-disable --id <id> | --name <name>`
- `/linear-daemon-start [--unit-name <name>] [--no-systemctl]`
- `/linear-daemon-stop [--unit-name <name>] [--no-systemctl]`
- `/linear-daemon-restart [--unit-name <name>] [--no-systemctl]`
- `/linear-daemon-help`

## In-pi extension tools (LLM-callable)

These tools are available to the pi coding agent and use direct Linear GraphQL API calls (no local `linear` binary required):

- `linear_issue_start`
  - params: `issue`, optional `branch`, `fromRef`, `onBranchExists` (`switch` | `suffix`)
  - behavior: resolves issue + default `branchName`, performs git branch start flow (switch/create/suffix), then moves issue to started state
- `linear_issue_comment_add`
  - params: `issue`, `body`, optional `parentCommentId`
  - behavior: adds a comment to the issue
- `linear_issue_update`
  - params: `issue`, optional `title`, `description`, `priority`, `state`
  - behavior: applies selected field updates via `issueUpdate`

Required auth env:
- `LINEAR_API_KEY`

For `linear_issue_start` git branch operations:
- run inside a git repository
- `git` must be available on PATH

## Legacy CLI-only path (still supported)

You can still run purely via npm + shell commands:

```bash
npm i @fink-andreas/pi-linear-service
pi-linear-service daemon setup --id <id> --repo-path <path> --open-states "Todo,In Progress"
pi-linear-service daemon start
pi-linear-service daemon status --id <id>
```

CLI behavior remains backward compatible.

## Migration notes (npm-only -> pi-native)

If you previously used npm-only installation:

1. Keep existing `settings.json` and `.env` (no schema reset required).
2. Install package with `pi install` (global or local).
3. Enable extension via `pi config`.
4. Continue using existing project configs, or run `/linear-daemon-reconfigure` to update interactively.
5. Optionally keep using CLI commands; both paths share the same underlying daemon control logic.

## Linux/systemd prerequisites

- Linux host with user systemd available (`systemctl --user`)
- Node.js >= 18
- `pi` installed and available on PATH
- Valid `LINEAR_API_KEY` and `ASSIGNEE_ID`

## Troubleshooting

### 1) Missing Linear credentials
Symptoms:
- startup fails with missing env vars
- or API 401 errors during polling

Fix:
```bash
export LINEAR_API_KEY="lin_xxx"
export ASSIGNEE_ID="<your-id>"
```
Then restart daemon (`/linear-daemon-restart` or `pi-linear-service daemon restart`).

### 2) Invalid repo mapping
Symptoms:
- setup/reconfigure fails with repo-path validation
- status/setup logs show mapping errors

Fix:
- use an **absolute** path for `repo.path`
- ensure the path exists on disk
- re-run `/linear-daemon-setup` or `/linear-daemon-reconfigure`

### 3) Service not active
Symptoms:
- `/linear-daemon-status` shows inactive service

Fix:
```bash
systemctl --user daemon-reload
systemctl --user enable --now pi-linear-service.service
systemctl --user status pi-linear-service.service --no-pager
```
Or from pi:
```text
/linear-daemon-start
```

## App configuration

### Required environment vars
- `LINEAR_API_KEY`
- `ASSIGNEE_ID`

### Polling / filtering
- `POLL_INTERVAL_SEC`
- `LINEAR_PAGE_LIMIT`
- `LINEAR_OPEN_STATES` (e.g. `Todo,In Progress`)
- `PROJECT_FILTER` (comma-separated; matches project name or id)
- `PROJECT_BLACKLIST` (comma-separated; matches project name or id)

### RPC mode vars
- `PI_LINEAR_MODE` = `rpc` (default) or `legacy`
- `RPC_TIMEOUT_MS` (default `120000`)
- `RPC_WORKSPACE_ROOT` (e.g. `~/dvl`)
- `RPC_PROVIDER` (passed as `pi --provider <value>`)
- `RPC_MODEL` (passed as `pi --model <value>`)

### settings.json
Location:

`~/.pi/agent/extensions/pi-linear-service/settings.json`

Start from:

```bash
mkdir -p ~/.pi/agent/extensions/pi-linear-service
cp settings.json.example ~/.pi/agent/extensions/pi-linear-service/settings.json
```

Hybrid project-scoped model:
- one logical daemon config per Linear project (keyed by project ID)
- explicit repo mapping is required per project (`projects.<id>.repo.path`)
- no implicit project-name directory fallback in strict project-scoped mode

## Testing

```bash
npm test
```

Runs deterministic checks (including package manifest validation and `pi install` smoke checks in isolated temp dirs).

For full packaging verification (automated + manual checklist), see:
- `PACKAGING_TEST_PLAN.md`

## Notes

- RPC protocol is **NDJSON**, not JSON-RPC 2.0.
- Hybrid flow is auto-processing by default (no manual approval gate before prompting).
- “Done” detection is not done by this daemon; the agent is expected to transition issue state in Linear.
