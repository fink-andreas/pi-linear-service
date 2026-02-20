# pi-linear-service Functionality

## Overview

`pi-linear-service` is a Node.js daemon that polls the Linear GraphQL API for issues assigned to a configured user and runs the **pi** coding agent per Linear project.

The service supports two modes:

- **RPC mode (default)**: one persistent `pi --mode rpc` process per Linear project, controlled via NDJSON RPC over stdin/stdout.
- **Legacy mode**: the previous tmux/process session-manager mechanism.

## Current default: RPC mode

### High-level behavior

For every poll:

1. Run a Linear smoke query (viewer)
2. Fetch assigned issues in configured open states (`LINEAR_OPEN_STATES`)
3. Group qualifying issues by Linear project
4. For each project (respecting filter/blacklist):
   - ensure there is a running `pi --mode rpc` process for that project
   - if the project session is **idle**, send a prompt for the **first** qualifying issue (one-at-a-time)

### “One-at-a-time” prompting

A project session is considered **idle** when `get_state` returns:

- `isStreaming === false`
- `pendingMessageCount === 0`

Only then the daemon will send a `prompt` for a new issue.

### Timeout + recovery

Each RPC command uses a timeout (default: **120s** via `rpc.timeoutMs` / `RPC_TIMEOUT_MS`).

If an RPC call fails or times out:

- send `abort`
- record a restart attempt timestamp (cooldown)
- kill the `pi` process
- recreate on next poll after cooldown

Linear HTTP timeout/network failures are also surfaced with explicit errors (instead of generic runtime failures).

### Repo working directory (cwd)

To run `pi` inside the correct Git repo:

- Set `rpc.workspaceRoot` (or env `RPC_WORKSPACE_ROOT`) to the directory containing your cloned repos (e.g. `~/dvl`).
- The daemon will spawn `pi` with:
  - `cwd = <workspaceRoot>/<LinearProjectName>` if it exists
  - or `cwd = <workspaceRoot>` as fallback

If the repo folder name differs from the Linear project name, configure:

- `rpc.projectDirOverrides`: map of `projectName` or `projectId` → directory (relative to `workspaceRoot` or absolute).

### Provider/model selection

If configured, the daemon starts pi as:

- `pi --provider <provider> --model <model> --mode rpc`

Config keys:
- `rpc.provider` / env `RPC_PROVIDER`
- `rpc.model` / env `RPC_MODEL`

### Future extension point: agent questions

Pi emits `extension_ui_request` events in RPC mode when extensions require user input.

The daemon currently:
- logs these events
- tracks an in-memory `needsInput` flag per session

This is the intended hook point for a future feature to detect and surface “agent has a question / needs input”.

### Graceful shutdown behavior

On `SIGINT` or `SIGTERM`, the daemon:
- stops scheduling new poll ticks
- waits briefly for an active poll to finish
- runs session-manager cleanup (`shutdown`) when implemented (RPC/process managers)
- logs shutdown completion and lets the process exit cleanly

## Legacy mode

Legacy mode uses the older session-manager abstraction:

- tmux session manager (default in legacy)
- process session manager

In legacy mode the daemon:
- creates a session per qualifying project
- runs a one-shot command template (`SESSION_COMMAND_TEMPLATE`) inside that session
- performs health checks via tmux pane inspection or process liveness

Enable legacy mode via:
- `.env`: `PI_LINEAR_MODE=legacy`
- or `settings.json`: `{"mode": "legacy", ...}`

Mode is validated at startup; only `rpc` and `legacy` are accepted.

## Configuration sources and precedence

1. `.env` (environment) is loaded first and provides:
   - Linear API key + assignee
   - polling settings, open states
   - filters/blacklists
   - optional RPC overrides

2. `settings.json` (optional) at:

```
~/.pi/agent/extensions/pi-linear-service/settings.json
```

Environment variables override relevant settings where supported.

## Project filtering

- `PROJECT_FILTER` / `config.projectFilter`: whitelist
- `PROJECT_BLACKLIST` / `config.projectBlacklist`: blacklist

Both accept either **projectId** or **projectName**.

## Implementation modules (key files)

- `index.js`: boot + config summary + start poll loop
- `src/config.js`: env parsing + loads settings.json
- `src/settings.js`: settings.json schema/defaults/merge
- `src/linear.js`: GraphQL client, fetch issues, group by project
- `src/poller.js`: polling loop + per-project processing

RPC mode:
- `src/pi-rpc.js`: NDJSON RPC client for `pi --mode rpc`
- `src/rpc-session-manager.js`: per-project pi process lifecycle, cwd resolution, abort/restart

Legacy mode:
- `src/session-manager.js`: session manager interface + factory
- `src/tmux-manager.js`, `src/process-manager.js`
- `src/tmux.js`: low-level tmux utilities
