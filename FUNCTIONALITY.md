# pi-linear-service Functionality

## Overview

`pi-linear-service` is a Node.js daemon that polls the Linear GraphQL API for issues and runs the **pi** coding agent per Linear project.

Phase 2 adds a **pi-native extension control plane** so daemon setup, reconfigure, status, and lifecycle operations can be handled directly from inside pi.

The service supports two runtime modes:

- **RPC mode (default)**: one persistent `pi --mode rpc` process per Linear project, controlled via NDJSON RPC.
- **Legacy mode**: tmux/process session manager compatibility path.

## Phase 2 architecture

### Components

1. **Daemon runtime (polling + orchestration)**
   - Polls Linear for scoped issues.
   - Maintains per-project agent sessions.
   - Enforces one-at-a-time prompting by idle-state checks.

2. **Settings model (project-scoped daemon config)**
   - `settings.projects.<projectId>` is the source of truth per project.
   - Explicit repo mapping is required (`repo.path`).
   - One logical daemon config per project.

3. **Control plane (CLI + extension commands)**
   - CLI command surface (`pi-linear-service daemon ...`) remains supported.
   - Extension slash-command surface mirrors the same operations inside pi.
   - Both paths delegate to the same control logic (`src/daemon-control.js`).

### Extension responsibilities

The packaged extension (`extensions/pi-linear-service.js`) provides:

- interactive setup flow (`/linear-daemon-setup`)
- interactive reconfigure flow (`/linear-daemon-reconfigure`)
- status/disable commands
- lifecycle start/stop/restart commands
- validation feedback before write/apply
- LLM-callable Linear issue tools (`linear_issue_start`, `linear_issue_comment_add`, `linear_issue_update`) using direct GraphQL API

Validation in extension flow includes:
- required project ID
- required explicit repo path
- absolute + existing repo path
- valid assignee mode (`me` or `all`)
- non-empty open states
- valid numeric runtime values

## Command surface (Phase 2)

### In-pi extension commands

- `/linear-daemon-setup`
- `/linear-daemon-reconfigure`
- `/linear-daemon-status --id <id>`
- `/linear-daemon-disable --id <id>`
- `/linear-daemon-start [--unit-name <name>] [--no-systemctl]`
- `/linear-daemon-stop [--unit-name <name>] [--no-systemctl]`
- `/linear-daemon-restart [--unit-name <name>] [--no-systemctl]`
- `/linear-daemon-help`

### Extension tools (LLM-callable)

- `linear_issue_start` (params: `issue`, optional `branch`, `fromRef`, `onBranchExists`)
- `linear_issue_comment_add` (params: `issue`, `body`, optional `parentCommentId`)
- `linear_issue_update` (params: `issue`, optional `title`, `description`, `priority`, `state`)

Tool behavior:
- Uses `LINEAR_API_KEY` and direct Linear GraphQL API calls.
- Resolves issue by identifier/id before mutation.
- `linear_issue_start` also executes git branch flow:
  - default branch from Linear `issue.branchName`
  - supports source ref override (`fromRef`)
  - handles existing branch by `switch` or suffixed create (`onBranchExists=suffix`)
- Resolves workflow state by team when needed (`start` and `update.state`).

### CLI control plane (backward compatible)

- `pi-linear-service daemon setup ...`
- `pi-linear-service daemon reconfigure ...`
- `pi-linear-service daemon disable ...`
- `pi-linear-service daemon status ...`
- `pi-linear-service daemon start|stop|restart ...`

## RPC runtime behavior (default)

For each poll tick:

1. Run Linear smoke query.
2. Build effective project scope from `settings.projects`.
3. Fetch issues using assignee/open-state scope.
4. Apply per-project enable/scope filters.
5. Group issues by project.
6. For each project with qualifying issues:
   - ensure project RPC session exists
   - send prompt only if session is idle

### One-at-a-time prompt gating

A project is prompt-eligible only when:
- `isStreaming === false`
- `pendingMessageCount === 0`

### Timeout/recovery

Each RPC command has timeout (default `120000ms`). On failure/timeout:
- send `abort`
- enforce restart cooldown
- kill process
- recreate after cooldown

## Repo mapping policy (final)

Project-scoped mode enforces **explicit mapping**:
- required: `projects.<projectId>.repo.path`
- no project-name fallback in strict project-scoped flow

## Lifecycle and deployment

Linux/systemd user service is the primary deployment target.

Service controls:
- install/uninstall/status via `service` commands
- start/stop/restart via `daemon` lifecycle commands

## Legacy mode

Legacy mode remains available for compatibility:
- tmux session manager
- process session manager

Enable with:
- `.env`: `PI_LINEAR_MODE=legacy`
- or settings mode: `legacy`

## Key modules

- `index.js`: boot + config summary + start poll loop
- `src/config.js`: env parsing + settings integration
- `src/settings.js`: schema/defaults/validation/migration
- `src/linear.js`: GraphQL issue fetch/grouping
- `src/poller.js`: polling loop and orchestration
- `src/pi-rpc.js`: RPC client for `pi --mode rpc`
- `src/rpc-session-manager.js`: per-project process/session lifecycle
- `src/daemon-control.js`: shared control-plane logic (CLI + extension)
- `extensions/pi-linear-service.js`: in-pi command UX + pre-write validation
