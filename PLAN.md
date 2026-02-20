# PLAN - Reliability hardening + Linear issue tracking

## Feature goal
Address the identified flaws in `pi-linear-service` reliability and maintainability, and create Linear issues in project `pi-linear-service` for tracked follow-up work.

## Project exploration summary

### Current structure (relevant)
- Runtime entry: `index.js`, `src/app.js`, `src/poller.js`
- Linear API client: `src/linear.js`
- Config/settings: `src/config.js`, `src/settings.js`
- Session management:
  - RPC mode: `src/pi-rpc.js`, `src/rpc-session-manager.js`
  - Legacy mode: `src/session-manager.js`, `src/tmux-manager.js`, `src/process-manager.js`
  - Legacy helper/duplicate path: `src/tmux.js`, `src/health.js`
- Service CLI: `src/cli.js`, `src/service-cli.js`, `bin/*`
- Tests: `test-*.js` scripts (manual/integration style)

### Key flaws to address
1. `src/linear.js` timeout/network path crashes due to misuse of `measureTimeAsync` return shape.
2. Missing `npm test` script + inconsistent test coverage alignment to runtime codepaths.
3. Duplicate tmux/session logic in `src/tmux.js` and `src/tmux-manager.js`.
4. Expected tmux states are logged as errors (noisy observability).
5. `PI_LINEAR_MODE` env override is not validated.
6. Missing graceful shutdown handling for long-running daemon.

## Questions / decisions resolved for this implementation
- Scope now: implement critical reliability fixes first, and create separate Linear issues for larger refactors.
- Keep refactor-heavy work (tmux dedup + test redesign) as tracked backlog to avoid risky broad rewrite in one change.

## High-level TODO
1. Create Linear issues in project `pi-linear-service` for each flaw bucket.
2. Start a new Linear issue for immediate hardening implementation and switch to the generated branch.
3. Fix Linear API execution error handling (`src/linear.js`) and add regression test.
4. Add config validation for effective mode (`rpc|legacy`) after settings/env merge.
5. Improve tmux logging severity for expected non-error states.
6. Add graceful shutdown hooks for daemon loop/session cleanup.
7. Add `npm test` script to run current stable tests and verify locally.
8. Update docs (`README.md`/`FUNCTIONALITY.md`) for reliability behavior changes.
9. Run verification and update TODO/issue comments with results.
