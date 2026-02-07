# TODO - INN-180: Add configurable session manager (replace tmux with any command)

## Implementation Steps

### Phase 1: Settings Infrastructure

- [x] 1. Create `src/settings.js` module:
    - Add `loadSettings()` function to read `~/.pi/agent/extensions/pi-linear-service/settings.json`
    - Add `getDefaultSettings()` function with default tmux configuration
    - Add `validateSettings()` function to validate settings schema
    - Handle missing file gracefully (use defaults)
    - Parse and return settings object with sessionManager configuration

### Phase 2: Session Manager Interface

- [x] 2. Create `src/session-manager.js` abstract interface:
    - Define base SessionManager class with required methods:
      - `async hasSession(sessionName)`
      - `async createSession(sessionName, command, dryRun)`
      - `async killSession(sessionName, dryRun)`
      - `async listSessions()`
      - `async checkSessionHealth(sessionName, healthMode)`
      - `isOwnedSession(sessionName, prefix)`
    - Document the interface with JSDoc

### Phase 3: Tmux Session Manager

- [x] 3. Create `src/tmux-manager.js`:
    - Create TmuxSessionManager class implementing SessionManager interface
    - Move existing functions from `src/tmux.js` into the class
    - Adapt functions to use instance variables instead of module exports
    - Keep all existing logic (health checks, ownership, cooldown)
    - Export `createTmuxManager()` factory function

### Phase 4: Process Session Manager

- [x] 4. Create `src/process-manager.js`:
    - Create ProcessSessionManager class implementing SessionManager interface
    - Add `processes` Map to track running processes by session name
    - Implement `hasSession()` - check if process is in Map and still running
    - Implement `createSession()` - spawn process with command, track in Map, monitor exit
    - Implement `killSession()` - kill process (SIGTERM then SIGKILL), remove from Map
    - Implement `listSessions()` - return keys from processes Map
    - Implement `checkSessionHealth()` - check if process is still running (killed, exited, or null = unhealthy)
    - Implement `isOwnedSession()` - use same logic as tmux (prefix + projectId pattern)
    - Add process cleanup on exit to remove from Map
    - Handle process spawning errors gracefully

### Phase 5: Integration with Config

- [x] 5. Update `src/config.js`:
    - Load settings using `loadSettings()`
    - Merge settings with environment variables
    - Add sessionManager object to config
    - Backward compatibility: if no settings, default to tmux
    - Update `printConfigSummary()` to show session manager type and config

### Phase 6: Poller Integration

- [x] 6. Update `src/poller.js`:
    - Import session manager factory functions
    - Create appropriate session manager based on config.sessionManager.type
    - Replace direct tmux imports with session manager instance
    - Update `createSessionsForProjects()` to use session manager methods
    - Update `checkAndKillUnhealthySessions()` to use session manager methods
    - Pass session manager to functions that need it

- [x] Also update `index.js` to use `loadConfig()` instead of `validateEnv()`

### Phase 7: Documentation

- [x] 7. Create `settings.json.example`:
    - Example using tmux (default behavior)
    - Example using process manager with custom command
    - Document all configuration options

- [x] 8. Update `README.md`:
    - Add section about settings.json configuration
    - Explain session manager types (tmux vs process)
    - Provide example settings.json
    - Document backward compatibility

- [x] 9. Update `FUNCTIONALITY.md`:
    - Add session manager architecture section
    - Document TmuxSessionManager class
    - Document ProcessSessionManager class
    - Update diagrams to show new architecture

### Phase 8: Testing

- [x] 10. Test tmux manager (existing functionality):
    - Verify service works with tmux manager (default)
    - Test session creation, health checks, kill/restart
    - Test that all existing functionality still works

- [x] 11. Test process manager (new functionality):
    - Set up settings.json with process manager type
    - Test process creation with custom command
    - Test health check (detects exited processes)
    - Test process killing
    - Test that no duplicate processes start

- [x] 12. Test backward compatibility:
    - Run without settings.json file
    - Verify defaults to tmux behavior
    - Verify all environment variables still work

- [x] 13. Test configuration validation:
    - Test invalid settings.json (should use defaults or error)
    - Test missing sessionManager.type (should default to tmux)
    - Test invalid command/args in process config

### Phase 9: Documentation and Release

- [x] 14. Update Linear issue with progress ✓
- [x] 15. Final review and commit changes ✓
- [x] 16. Add comment to Linear issue with summary of changes ✓
- [x] 17. Mark issue as Done ✓

## Summary

All implementation steps for INN-180 have been completed:

✓ Settings loader with JSON schema validation
✓ Abstract SessionManager interface
✓ TmuxSessionManager implementation (existing functionality)
✓ ProcessSessionManager implementation (new functionality)
✓ Config integration with environment merging
✓ Poller updated to use session manager factory
✓ Documentation updates (README, FUNCTIONALITY.md)
✓ settings.json.example created
✓ All tests passing (tmux manager, process manager, backward compatibility)
✓ Linear issue updated with summary
✓ Issue marked as Done

**Key Features:**
- Configurable session manager via ~/.pi/agent/extensions/pi-linear-service/settings.json
- Support for 'tmux' (default) and 'process' session managers
- Process manager: run any command with configurable args
- Process tracking prevents duplicate processes
- Health checks work for both manager types
- Full backward compatibility (defaults to tmux without settings.json)