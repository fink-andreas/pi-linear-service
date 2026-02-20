# PLAN - INN-181: RPC mode for pi process handling (per Linear project)

## Goal
Switch `pi-linear-service` from one-shot `pi -p ...` execution to a **persistent** `pi --mode rpc` process per Linear project, controlled via **NDJSON RPC** over stdin/stdout.

Key constraints from issue discussion:
- One persistent pi process **per Linear project**.
- **tmux is disallowed** in RPC mode; only process manager.
- No automatic "Done" detection needed. The agent will set the Linear issue state to Done via Linear tools.
- Polling behavior: **one issue at a time per project** (no queueing multiple issues).
- Timeout: default **120 seconds**. On timeout: send `abort` → cooldown → restart.
- RPC should be the **default** behavior; legacy remains optional. No mixed mode.
- Logging: use existing logger; no extra event log persistence.
- Design should allow later extension to detect "agent has a question" (hook point).

## Repository exploration (current pi-linear-service)

Top-level:
- `index.js`: service entry
- `src/config.js`: env + settings loader, config summary
- `src/poller.js`: polling loop, creates sessions
- `src/session-manager.js`: abstraction used by poller
- `src/process-manager.js`: in-memory process tracking
- `src/tmux-manager.js`: tmux implementation (legacy)
- `src/health.js`: health/cooldown logic
- tests: various session + health behaviors

## pi RPC protocol (from ../pi-mono)
Source of truth:
- `../pi-mono/packages/coding-agent/src/modes/rpc/rpc-types.ts`

Important: this is **not JSON-RPC 2.0**. It is newline-delimited JSON commands and responses/events.

Commands (stdin): objects with `type`, optional `id`.
Responses/events (stdout): objects with `type` (e.g. `response`, `extension_ui_request`, etc.).

Commands we need initially:
- `{ type: "new_session", id? }`
- `{ type: "prompt", message, id? }`
- `{ type: "get_state", id? }`
- `{ type: "abort", id? }`

Future hook for "agent has a question":
- stdout events include `{ type: "extension_ui_request", ... }` which indicates an extension needs user input.

## Proposed design

### High-level flow (per project)
- Ensure an RPC session exists for the project:
  - spawn `pi --mode rpc` (process manager)
  - send `new_session`
- When an issue is eligible to be processed for a project:
  - if project session is *idle* (not streaming, no pending messages): send `prompt` for that issue
  - else: do nothing (one-at-a-time policy)
- Health monitoring:
  - periodically call `get_state` for each project session
  - if a command call exceeds `RPC_TIMEOUT_MS` (default 120s) or process is dead:
    - send `abort`
    - apply cooldown
    - kill process
    - restart (next poll)

### Modules / files
- NEW `src/pi-rpc.js`:
  - spawn helper + NDJSON encoder/decoder
  - request/response correlation by `id`
  - timeout handling
  - event emitter for non-response events (e.g. `extension_ui_request`)
- Update `src/process-manager.js` or create NEW `src/rpc-process-manager.js`:
  - Manage ChildProcess + associated PiRpcClient per session
  - Expose `getClient(sessionName)`
- Update `src/poller.js`:
  - default to RPC mode
  - disallow tmux when RPC enabled
  - integrate `get_state` / idle checks before sending prompt
- Update `src/config.js`, `settings.json.example`, `.env.example?` (if exists):
  - Add RPC mode settings:
    - `pi.mode`: `rpc|legacy`
    - `rpc.timeoutMs` default 120000
- Update docs: `README.md` and `FUNCTIONALITY.md`

### Idle definition
A project session is considered idle when:
- process alive
- `get_state` returns `isStreaming === false` AND `pendingMessageCount === 0`

### Extension point for questions
- In `PiRpcClient`, surface `extension_ui_request` events via callback/hook.
- Poller can later react (e.g. mark project as blocked, notify).
- For now: log and mark session as "needsInput" in memory.

## Acceptance checks (manual)
- With required env vars set, `node index.js` starts.
- Service spawns one `pi --mode rpc` per eligible Linear project.
- Service sends `prompt` only when session is idle.
- If `get_state` hangs >120s: service aborts, cools down, restarts session.
- tmux mode rejected when rpc is enabled.

