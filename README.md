# pi-linear-service

A Node.js daemon that polls the Linear GraphQL API and runs the **pi** coding agent **per Linear project**.

Default behavior is **RPC mode**: one persistent `pi --mode rpc` process per project, driven via NDJSON RPC over stdin/stdout.

## Features

- **RPC mode (default):** persistent `pi --mode rpc` per Linear project
- **One-at-a-time prompting:** only sends a new prompt when the project session is idle
- **Repo-aware execution:** start `pi` in the right repo directory via `rpc.workspaceRoot` + optional overrides
- **Model/provider selection:** pass `--provider/--model` to `pi`
- **npm package + CLI:** install as `@fink-andreas/pi-linear-service` and run via `pi-linear-service`
- **systemd user service support:** install/uninstall/status commands for background operation
- **Timeout + recovery:** abort + cooldown + restart if RPC calls hang (default 120s)
- **Graceful shutdown:** handles `SIGINT`/`SIGTERM`, stops polling, and cleans up managed sessions

## Install

```bash
npm i @fink-andreas/pi-linear-service
```

After install, a **best-effort postinstall** attempts to set up the user systemd service.
If that fails (common in CI/headless shells), run setup manually:

```bash
npx pi-linear-service service install
```

To disable postinstall auto-attempt:

```bash
SKIP_PI_LINEAR_POSTINSTALL=1 npm i @fink-andreas/pi-linear-service
```

## CLI usage

```bash
pi-linear-service start
pi-linear-service service install [--working-dir <dir>] [--env-file <path>] [--unit-name <name>] [--node-path <path>] [--no-systemctl]
pi-linear-service service uninstall [--unit-name <name>] [--no-systemctl]
pi-linear-service service status [--unit-name <name>]

# Hybrid extension control-plane (separate actions)
pi-linear-service daemon setup --project-id <id> --repo-path <path> [--project-name <name>] [--open-states "Todo,In Progress"] [--assignee me|all]
pi-linear-service daemon reconfigure --project-id <id> [--repo-path <path>] [--project-name <name>] [--open-states "Todo,In Progress"] [--assignee me|all]
pi-linear-service daemon disable --project-id <id>
pi-linear-service daemon status --project-id <id>
pi-linear-service daemon start|stop|restart [--unit-name <name>]
```

### Install service defaults (elaborated)

`service install` infers defaults and also supports overrides:

- `workingDir`: current working directory
- `envFile`: `<workingDir>/.env`
- `unitName`: `pi-linear-service.service`
- `nodePath`: current `process.execPath`

Use explicit flags when your runtime paths differ.

## Background service (systemd user)

Default unit location:

- `~/.config/systemd/user/pi-linear-service.service`

`service install` performs:

- writes/updates unit file
- `systemctl --user daemon-reload`
- `systemctl --user enable --now <unit>`

`service uninstall` performs:

- `systemctl --user disable --now <unit>`
- remove unit file
- `systemctl --user daemon-reload`

A static `pi-linear.service` file is still included in the package as reference/fallback documentation.

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
- `PI_LINEAR_MODE` = `rpc` (default) or `legacy` (invalid values fail fast at startup)
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

Example:

```json
{
  "schemaVersion": 2,
  "mode": "rpc",
  "projects": {
    "97ec7cae-e252-493d-94d3-6910aa28cacf": {
      "enabled": true,
      "projectName": "pi-linear-test-repo",
      "scope": {
        "assignee": "me",
        "openStates": ["Todo", "In Progress"]
      },
      "repo": {
        "path": "/home/afi/dvl/pi-linear-test-repo"
      },
      "runtime": {
        "timeoutMs": 120000,
        "restartCooldownSec": 60
      }
    }
  }
}
```

## Testing

```bash
npm test
```

Runs baseline deterministic checks (config validation, Linear query error handling, RPC client, service CLI, ownership/template checks, and tmux runner checks).

## Notes

- RPC protocol is **NDJSON**, not JSON-RPC 2.0.
- Hybrid flow is auto-processing by default (no manual approval gate before prompting).
- “Done” detection is not done by this daemon; the agent is expected to transition issue state in Linear.
