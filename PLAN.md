# Plan - INN-177: Add dry-run mode

## Overview
Add a dry-run mode that logs intended tmux actions without executing them. This is helpful for first-time setup to verify what the service would do without actually creating/managing tmux sessions.

## Files Involved

### src/config.js
- Add DRY_RUN environment variable (default: false)
- Pass dry-run flag to tmux module

### src/tmux.js
- Accept dry-run parameter in session management functions
- Log intended actions instead of executing when dry-run is enabled
- Functions to modify: createSession, killSession, maybe execTmux

### src/poller.js
- Pass dry-run flag to tmux operations
- Log when dry-run mode is active

## Implementation Plan

### 1. Add DRY_RUN Configuration
- Add DRY_RUN environment variable (default: false)
- Document in config summary
- Add to .env.example

### 2. Update tmux Module for Dry-Run
- Pass dry-run flag to session management functions
- In createSession: log "Would create session" instead of creating
- In killSession: log "Would kill session" instead of killing
- Ensure other tmux operations (listSessions, hasSession) still work in dry-run

### 3. Update Poller
- Log when dry-run mode is active
- Pass dry-run flag from config to tmux operations

### 4. Update Documentation
- Add DRY_RUN to README configuration section
- Explain usage for first-time setup

## High-Level TODO

- [ ] 1. Add DRY_RUN environment variable to config.js
- [ ] 2. Update tmux.js functions to support dry-run mode
- [ ] 3. Update poller.js to pass dry-run flag
- [ ] 4. Update .env.example and README.md
- [ ] 5. Test dry-run mode logs intended actions
- [ ] 6. Test normal mode still executes actions

## Behavior in Dry-Run Mode

### What Still Runs
- Linear API queries (to fetch issues)
- Polling loop (to check for changes)
- Session listing and health checks (to see current state)

### What Gets Skipped/Logged Only
- Creating new tmux sessions (logs "Would create session...")
- Killing tmux sessions (logs "Would kill session...")

### Example Log Output
```
{"level":"INFO","message":"DRY-RUN MODE: Skipping tmux session creation","sessionName":"pi_project_ABC-123","projectName":"My Project","command":"pi -p ..."}
```

## Non-Goals

- Dry-run for Linear API operations (already safe/read-only)
- Simulating tmux session state (assumes sessions don't exist in dry-run)
- Undo capabilities (dry-run is one-way preview)
