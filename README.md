# pi-linear-service

A Node.js daemon that polls the Linear GraphQL API and runs the **pi** coding agent **per Linear project**.

Default behavior is **RPC mode**: one persistent `pi --mode rpc` process per project, driven via NDJSON RPC over stdin/stdout.

## Features

- **RPC mode (default):** persistent `pi --mode rpc` per Linear project
- **One-at-a-time prompting:** only sends a new prompt when the project session is idle
- **Repo-aware execution:** start `pi` in the right repo directory via `rpc.workspaceRoot` + optional overrides
- **Model/provider selection:** pass `--provider/--model` to `pi`
- **Error isolation:** Linear/API failures don’t crash the daemon
- **Timeout + recovery:** abort + cooldown + restart if RPC calls hang (default 120s)

## Quick start

### 1) Install

```bash
npm install
```

### 2) Configure env

```bash
cp .env.example .env
$EDITOR .env
```

Required:
- `LINEAR_API_KEY`
- `ASSIGNEE_ID`

### 3) (Recommended) Configure settings.json

```bash
mkdir -p ~/.pi/agent/extensions/pi-linear-service
cp settings.json.example ~/.pi/agent/extensions/pi-linear-service/settings.json
$EDITOR ~/.pi/agent/extensions/pi-linear-service/settings.json
```

### 4) Run

```bash
node index.js
```

## Configuration

### Environment variables (.env)

#### Required
- `LINEAR_API_KEY`
- `ASSIGNEE_ID`

#### Polling / filtering
- `POLL_INTERVAL_SEC`
- `LINEAR_PAGE_LIMIT`
- `LINEAR_OPEN_STATES` (e.g. `Todo,In Progress`)
- `PROJECT_FILTER` (comma-separated; matches **project name or project id**)
- `PROJECT_BLACKLIST` (comma-separated; matches **project name or project id**)

#### RPC mode toggles (optional)
- `PI_LINEAR_MODE` = `rpc` (default) or `legacy`
- `RPC_TIMEOUT_MS` (default `120000`)
- `RPC_WORKSPACE_ROOT` (e.g. `~/dvl`)
- `RPC_PROVIDER` (passed as `pi --provider <value>`)
- `RPC_MODEL` (passed as `pi --model <value>`)

#### Legacy-only (when `PI_LINEAR_MODE=legacy`)
- `TMUX_PREFIX`
- `SESSION_COMMAND_TEMPLATE`
- `SESSION_HEALTH_MODE`, `SESSION_KILL_ON_UNHEALTHY`, `SESSION_RESTART_COOLDOWN_SEC`

### settings.json

Location:

```
~/.pi/agent/extensions/pi-linear-service/settings.json
```

#### RPC mode config (default)

Example:

```json
{
  "mode": "rpc",
  "rpc": {
    "timeoutMs": 120000,
    "restartCooldownSec": 60,

    "piCommand": "pi",
    "piArgs": [],

    "provider": "cerebras",
    "model": "zai-glm-4.7",

    "workspaceRoot": "~/dvl",
    "projectDirOverrides": {
      "some-linear-project-name": "different-folder-name",
      "97ec7cae-e252-493d-94d3-6910aa28cacf": "pi-linear-test-repo"
    }
  },
  "legacy": {
    "sessionManager": {
      "type": "tmux",
      "tmux": { "prefix": "pi_project_" },
      "process": { "command": "node", "args": [], "prefix": "pi_project_" }
    }
  }
}
```

Repo directory resolution:
- If `projectDirOverrides` contains a match (by projectName or projectId), use that directory.
- Otherwise use `<workspaceRoot>/<LinearProjectName>` if it exists.
- Otherwise fall back to `workspaceRoot`.

`projectDirOverrides` values:
- can be **relative** to `workspaceRoot` (e.g. `different-folder-name`)
- or an **absolute** path.

#### Legacy mode

Legacy mode uses the older tmux/process session-manager approach.

Enable:
- `.env`: `PI_LINEAR_MODE=legacy`
- or `settings.json`: `{ "mode": "legacy", ... }`

In legacy mode, `settings.json` controls the session manager via `legacy.sessionManager`.

## Notes

- RPC protocol is **newline-delimited JSON (NDJSON)**, not JSON-RPC 2.0.
- “Done” detection is not performed by this daemon; the agent is expected to transition issues via Linear tooling.
