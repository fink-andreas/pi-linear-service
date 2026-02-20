# PLAN - Hybrid pi extension for project-scoped Linear daemon

## Feature goal
Build a **hybrid pi extension** for this project:
- User interacts via extension UI to configure/reconfigure a background daemon
- Daemon monitors Linear for new issues in selected scope
- Daemon can automatically pick/process issues for the configured project scope
- Linux-only deployment (systemd user service)

## Requirements clarified with user
1. Hybrid extension (UI setup + background daemon) ✅
2. Scope configurable in extension UI, and reconfigurable later ✅
3. No manual approval gate before prompting agent ✅
4. No session-state persistence required (ephemeral in-memory runtime state acceptable) ✅
5. Linux only ✅
6. Repo mapping policy: explicit-only mapping ✅
7. Agent transitions issue to Done at own discretion ✅

## Project exploration summary

### Relevant structure
- Entrypoints/boot:
  - `index.js`
  - `src/app.js`
  - `src/cli.js`
- Runtime loop:
  - `src/poller.js`
- Linear integration:
  - `src/linear.js`
- RPC agent integration:
  - `src/pi-rpc.js`
  - `src/rpc-session-manager.js`
- Config/settings:
  - `src/config.js`
  - `src/settings.js`
  - `settings.json.example`
- Service management:
  - `src/service-cli.js`
  - `bin/pi-linear-service.js`
  - `bin/postinstall.js`
- Docs:
  - `README.md`
  - `FUNCTIONALITY.md`

### Existing tests
- `test-config-mode-validation.js`
- `test-linear-execute-query.js`
- `test-pi-rpc-client.js`
- `test-service-cli.js`
- plus legacy/session/tmux behavior checks (`test-session-*`, `test-tmux-runner.js`, etc.)
- `npm test` already wired in `package.json`

## Architecture direction

### Hybrid model
- Keep daemon core in this package (polling + Linear + RPC orchestration)
- Add/expand extension-facing control plane:
  - setup flow
  - scope config
  - reconfigure/update
  - status/health
- Persist only configuration; runtime session state remains in-memory

### Configuration model (target)
- Global extension settings file remains primary config store
- Add project-scoped daemon config blocks (scope + policy + repo mapping)
- Support reconfiguration via UI without manual file editing

### Scope model (target)
- Per-daemon scope options selectable from UI (project IDs/names, assignee behavior)
- Blacklist/filter logic remains available but surfaced as UI options

### Repo mapping policy (decided)
- **Explicit-only mapping** (strict/deterministic)
- No name-based fallback for unresolved projects
- Setup/reconfigure UI must enforce mapping presence before enabling daemon for that project

## Extension contract (v1 draft)

### UI actions (separate)
1. **Setup daemon**
   - Inputs:
     - Linear project (single project)
     - Scope options (open states, assignee mode, optional include/exclude labels if added later)
     - Repo mapping (required absolute path or workspace-root + explicit projectDir override)
     - Runtime options (poll interval, model/provider optional)
   - Behavior:
     - Validate inputs and config
     - Persist project config
     - Install/start systemd user unit if needed
     - Trigger runtime reload/restart for that project config

2. **Reconfigure scope**
   - Inputs: existing project daemon config + changed scope/runtime fields
   - Behavior:
     - Validate diff
     - Persist config update
     - Apply live reconfigure (or controlled restart)

3. **Status**
   - Returns:
     - Service health (running/stopped)
     - Per-project daemon status (enabled, last poll, active session, last error)

4. **Lifecycle controls**
   - Per project: start / stop / restart / disable
   - Global service: install / uninstall / status

### Runtime behavior constraints
- Linux + systemd user service only
- No approval gate before prompting the agent
- No runtime session persistence requirement across restarts (rebuild from config + Linear state)
- Agent may set issue state to Done at its own discretion
- Repo mapping must be explicit for each configured project (no fallback by project name)

## Settings schema draft (project-scoped)

```json
{
  "mode": "rpc",
  "projects": {
    "<linearProjectId>": {
      "enabled": true,
      "projectName": "optional cached name",
      "scope": {
        "assignee": "me",
        "openStates": ["Todo", "In Progress"]
      },
      "repo": {
        "path": "/absolute/path/to/repo"
      },
      "runtime": {
        "pollIntervalSec": 30,
        "provider": null,
        "model": null,
        "timeoutMs": 120000,
        "restartCooldownSec": 60
      }
    }
  }
}
```

Validation rules:
- `projects` key is required for hybrid mode
- each project entry must include explicit `repo.path`
- no implicit project-name-to-directory resolution
- `scope.assignee` defaults to `me`
- missing runtime keys inherit global defaults

## High-level TODO
1. Define extension UX contract and config schema for setup/reconfigure/status
2. Implement project-scoped config persistence + schema validation/migration
3. Add control-plane commands/APIs for daemon lifecycle and reconfiguration
4. Wire scope handling from UI config into poller selection logic
5. Harden repo-directory resolution policy based on chosen mapping mode
6. Ensure no-approval auto-processing behavior is explicit and documented
7. Extend tests for config schema, scope updates, lifecycle/reconfigure flows
8. Update `README.md` and `FUNCTIONALITY.md` with hybrid extension workflow
9. Manual Linux/systemd verification: setup, reconfigure, restart, process issue

## Finalized product decisions
1. Repo mapping: **explicit-only**
2. UI placement: **separate actions** (`Setup daemon`, `Reconfigure scope`)
3. Daemon model: **one logical daemon config per project**
