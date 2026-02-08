# TODO - INN-181: RPC mode for pi process handling (per Linear project)

## Steps

- [x] 1. Explore current session + poller flow (where command is built, where sessions are created) and identify exact integration points for RPC.
- [x] 2. Implement NDJSON RPC client for `pi --mode rpc` (`src/pi-rpc.js`): spawn, send command with id, await response, stream events, timeout.
- [x] 3. Add RPC session manager (process-based only) that maintains one PiRpcClient per project session and exposes `getState()/prompt()/abort()` helpers.
- [x] 4. Update config/settings/docs to make RPC default and legacy optional; disallow tmux when RPC enabled.
- [x] 5. Update poller logic for one-at-a-time behavior: only `prompt` when session is idle (`isStreaming=false && pendingMessageCount=0`).
- [x] 6. Implement timeout handling (default 120s): abort → cooldown → restart.
- [x] 7. Add hook point for future "agent question" detection by capturing/logging `extension_ui_request` events.
- [x] 8. Update/extend tests for RPC client + poller behavior (mock spawn/stdout NDJSON).
- [x] 9. Manual reality check: `LINEAR_API_KEY="test" ASSIGNEE_ID="test" node index.js` (should start and log config + not crash).
- [x] 10. Manual integration test against Linear test project (pi-linear-test-repo): verify it only processes that project and sends prompt for the Todo issue.
- [x] 11. Spawn pi with correct cwd based on rpc.workspaceRoot + Linear project name (e.g. ~/dvl/<projectName>).
- [x] 12. Add rpc.projectDirOverrides mapping and rpc.provider/rpc.model support (pass as --provider/--model args).

