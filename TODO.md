# TODO - INN-177: Add dry-run mode

## Implementation Steps

- [x] 1. Add DRY_RUN configuration to src/config.js:
    - Add parseEnvBool for DRY_RUN (default: false)
    - Include dryRun in config object
    - Display in configuration summary
    - Add to .env.example

- [x] 2. Update tmux.js functions for dry-run support:
    - Modify createSession to accept dryRun parameter
    - Modify killSession to accept dryRun parameter
    - In dry-run mode, log "Would create session" or "Would kill session" instead of executing
    - Ensure listSessions, hasSession, listPanes still work in dry-run (read-only operations)

- [x] 3. Update poller.js to pass dry-run flag:
    - Add dry-run mode startup log
    - Pass config.dryRun to tmux operations

- [x] 4. Update documentation:
    - Add DRY_RUN to .env.example
    - Add DRY_RUN to README.md configuration section
    - Explain usage for first-time setup

- [x] 5. Test dry-run mode:
    - Run service with DRY_RUN=true
    - Verify Linear API calls still work
    - Verify tmux create actions are logged but not executed
    - Verify tmux kill actions are logged but not executed

- [x] 6. Test normal mode:
    - Run service with DRY_RUN=false (default)
    - Verify tmux sessions are created as expected
    - Verify dry-run mode doesn't affect normal operation

- [>] 7. Update Linear issue (Done + comment), commit, merge to main
