A Node.js daemon that polls the Linear GraphQL API on an interval and manages **per-project `tmux` sessions** running a `pi` command for projects that currently have assigned issues in configurable “open” states. Deploy it as a **systemd user unit** on Ubuntu (under `~/.config/systemd/user/`), and include a **basic session health check** with an optional **kill/restart** mechanism limited to sessions created by this service.

### Goal

* Create a Node.js daemon to run indefinitely under **systemd --user** (not a system-wide unit).
* Ensure idempotent per-project tmux session creation for qualifying projects.
* Detect unhealthy sessions (exited process/no live panes) and optionally kill them safely (cooldown-gated) so they can be recreated on later polls.

### Environment

* Ubuntu + systemd user services.
* `tmux` installed and available to the service user.
* `pi` installed and available to the service user.
* Linear GraphQL endpoint: `https://api.linear.app/graphql`.

### Deliverables

1. **Node project**

   * `package.json` with required dependencies.
   * Entry script (e.g., `index.js`) implementing polling, tmux orchestration, health checks, and recovery gating.
   * `.env.example` documenting all required/optional config keys (no secrets).
   * `README.md` with: install, config, local run, and systemd user-unit deployment (including lingering requirement if needed).

2. **systemd user unit**

   * File: `~/.config/systemd/user/pi-linear.service` 
   * Managed via: `systemctl --user {daemon-reload,enable,start,status}`.
   * Uses `EnvironmentFile=` (preferred) or equivalent; do not embed secrets in the unit.
   * `Restart=on-failure` (or `always`) with sensible backoff.
   * Document how to ensure it starts on boot for the user (e.g., `loginctl enable-linger <user>` if applicable).

### Configuration (environment variables)

Required:

* `LINEAR_API_KEY`
* `ASSIGNEE_ID`

Optional defaults:

* `POLL_INTERVAL_SEC=300`
* `TMUX_PREFIX=pi_project_` (ownership marker; only sessions with this prefix are eligible for kill/restart)
* `LINEAR_OPEN_STATES=Todo,In Progress` (comma-separated; must be configurable)
* `LINEAR_PAGE_LIMIT=100` (limit acceptable; warn if truncated)

Health & recovery:

* `SESSION_HEALTH_MODE=basic` (support at least `none|basic`, default `basic`)
* `SESSION_KILL_ON_UNHEALTHY=false` (default false for safety)
* `SESSION_RESTART_COOLDOWN_SEC` (set a reasonable default; prevents kill/restart loops)

### Required Behavior

#### 1) Polling loop

* Run once immediately on startup, then every `POLL_INTERVAL_SEC`.
* No overlapping polls: serialize runs (skip the next tick if the previous poll is still running).

#### 2) Linear query & filtering (limit acceptable)

* Fetch up to `LINEAR_PAGE_LIMIT` issues assigned to `ASSIGNEE_ID` where the issue state name is in `LINEAR_OPEN_STATES`.
* If results hit the limit, log a warning about possible truncation.
* For each issue, if it has a `project`, group by `project.id` and keep `project.name`.
* Ignore issues with no project (log at debug/info).

#### 3) tmux session creation (idempotent)

For each project with ≥1 qualifying issue:

* Session name: `${TMUX_PREFIX}${projectId}`.
* If session exists (`tmux has-session -t <name>`), do nothing.
* Otherwise create a detached session that runs `pi` with a prompt including the project name.

#### 4) Basic health check + optional recovery (prefix-owned only)

**Health definition (must implement):**

* A session is unhealthy if it exists but its pane process has exited / there are no live panes/processes. Treat this as unhealthy immediately.

**Recovery (must implement, gated by config):**

* Only act on sessions whose names start with `TMUX_PREFIX` and follow the `${TMUX_PREFIX}${projectId}` pattern (i.e., created/owned by this service).
* If `SESSION_KILL_ON_UNHEALTHY=true` and the session is unhealthy, and it is not within `SESSION_RESTART_COOLDOWN_SEC` since last kill attempt:

  * Kill the session via tmux.
  * It is acceptable to rely on the next poll to recreate it if still needed.
* Log unhealthy detections and kill/cooldown decisions.

### Logging & reliability

* Log startup configuration summary (mask secrets), poll start/end, issue count, project count, sessions started, unhealthy sessions detected, kills performed, and errors.
* Transient API failures should not crash the process; keep polling.
* Fail fast on startup if required env vars are missing.

### Non-Goals

* Full pagination beyond the configured limit.
* Cleaning up sessions for projects that no longer have issues (except unhealthy kill if enabled).
* Any UI or database work.

### Acceptance Criteria

* Local run (`node index.js`) with a valid `.env`:

  * Immediate poll occurs.
  * One tmux session per qualifying project is created (up to limit), no duplicates on subsequent polls.
  * Exited pane/process ⇒ unhealthy immediately.
  * If `SESSION_KILL_ON_UNHEALTHY=true`, unhealthy sessions owned by this service are killed and will be recreated on later polls if still required, respecting cooldown.

* User unit deployment:

  * `~/.config/systemd/user/pi-linear.service` works with `systemctl --user`.
  * Uses `EnvironmentFile=`.
  * Restarts on failure.
  * README shows how to view logs with `journalctl --user -u pi-linear.service` and how to ensure start-on-boot for the user.

### Summary of what was improved for clarity (include verbatim in your output)

* Removed all references to any pre-existing daemon and reframed the task as creating a new Node.js service from scratch.
* Specified the deployment target as a systemd **user unit** with the exact unit path and management commands.
* Locked in health semantics: an exited pane/process is unhealthy immediately.
* Constrained recovery actions to sessions created by this service via the `TMUX_PREFIX` ownership rule.
* Replaced pagination with an explicit limit + truncation warning to keep scope bounded but observable.
* Converted goals into concrete deliverables and acceptance criteria.

Assumptions (only if made):

* A1: Exited pane/process can be detected using tmux introspection without modifying `pi`.
