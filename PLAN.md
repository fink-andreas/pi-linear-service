# Plan: Configurable Session Manager

## Goal
Extend pi-linear-service to support configurable session managers instead of being hardcoded to use tmux. The service should be able to run any command with configurable arguments and maintain control of the process until it exits.

## Requirements
1. Read configuration from `~/.pi/agent/extensions/pi-linear-service/settings.json`
2. Support replacing tmux with any command
3. Keep control of the command process - no duplicate processes should start until it exits
4. Maintain backward compatibility with tmux as default

## Current State Analysis

### Existing Architecture
- `src/tmux.js`: Handles all tmux operations (create, kill, list, health check)
- `src/poller.js`: Uses tmux.js to manage sessions
- `src/config.js`: Loads environment variables only

### Key Functions in tmux.js
- `execTmux()` - Execute tmux commands via child_process.spawn
- `hasSession()` - Check if session exists
- `createSession()` - Create a new detached tmux session
- `killSession()` - Kill a tmux session
- `listSessions()` - List all tmux sessions
- `listPanes()` - Get session pane information
- `checkSessionHealth()` - Health check on session
- `isOwnedSession()` - Check ownership via session name pattern
- `attemptKillUnhealthySession()` - Kill unhealthy sessions with cooldown

## Proposed Architecture

### Settings JSON Schema
```json
{
  "sessionManager": {
    "type": "tmux" | "process",
    "tmux": {
      "prefix": "pi_project_"
    },
    "process": {
      "command": "/path/to/command",
      "args": ["--flag1", "value1"],
      "prefix": "pi_project_"
    }
  }
}
```

### New Module Structure
```
src/
├── config.js           - Environment variables loader (existing)
├── settings.js         - NEW: settings.json loader
├── session-manager.js  - NEW: Abstract interface for session management
├── tmux-manager.js     - NEW: Tmux implementation of session manager
├── process-manager.js  - NEW: Generic process implementation
└── poller.js           - Updated to use session-manager
```

### Session Manager Interface
```javascript
// Abstract interface that all session managers must implement
class SessionManager {
  async hasSession(sessionName) { }
  async createSession(sessionName, command, dryRun) { }
  async killSession(sessionName, dryRun) { }
  async listSessions() { }
  async checkSessionHealth(sessionName, healthMode) { }
  isOwnedSession(sessionName, prefix) { }
}
```

### Process Manager Implementation
The process manager will:
1. Track running processes in memory (`Map<sessionName, ChildProcess>`)
2. Use `child_process.spawn` to start commands
3. Monitor process status via `spawn().on('exit')` events
4. Support cleanup of zombie processes
5. Health check based on process running status

### Session Manager Factory
```javascript
function createSessionManager(settings) {
  switch (settings.sessionManager.type) {
    case 'tmux':
      return new TmuxSessionManager(settings.sessionManager.tmux);
    case 'process':
      return new ProcessSessionManager(settings.sessionManager.process);
    default:
      return new TmuxSessionManager({}); // Default fallback
  }
}
```

## Implementation Steps

### 1. Create settings.js module
- Load `~/.pi/agent/extensions/pi-linear-service/settings.json`
- Provide default settings if file doesn't exist
- Validate settings schema
- Export settings object

### 2. Create session-manager.js abstract interface
- Define the abstract SessionManager class/interface
- Provide documentation for required methods

### 3. Create tmux-manager.js
- Move existing tmux.js logic into a new class
- Implement SessionManager interface
- Keep all existing health check logic

### 4. Create process-manager.js
- Implement SessionManager interface for generic processes
- Process tracking with Map
- Health check based on process status
- Support for graceful process termination

### 5. Update poller.js
- Use session manager factory to get appropriate manager
- Pass session manager instance to functions instead of importing tmux module directly
- Keep all existing polling logic intact

### 6. Update config.js
- Add settings loader integration
- Merge settings with environment variables
- Provide backward compatibility (tmux by default if no settings)

### 7. Update documentation
- Document settings.json format
- Provide example settings.json
- Update README.md with new configuration options
- Update FUNCTIONALITY.md

### 8. Create example settings.json
- Default configuration using tmux
- Example configuration using a custom command

## Backward Compatibility
- If `settings.json` doesn't exist, default to tmux behavior
- If `sessionManager.type` is not specified, default to "tmux"
- All existing environment variables continue to work
- Session naming conventions remain unchanged

## Testing Considerations
- Test with tmux manager (existing functionality)
- Test with process manager (new functionality)
- Test health checks for both managers
- Test kill/restart for both managers
- Test cooldown mechanism for both managers
- Test missing settings.json (backward compatibility)

## Files to Modify
1. NEW: `src/settings.js` - Settings loader
2. NEW: `src/session-manager.js` - Abstract interface
3. NEW: `src/tmux-manager.js` - Tmux implementation
4. NEW: `src/process-manager.js` - Process implementation
5. MODIFY: `src/poller.js` - Use session manager factory
6. MODIFY: `src/config.js` - Integrate settings
7. MODIFY: `README.md` - Update documentation
8. MODIFY: `FUNCTIONALITY.md` - Update docs
9. NEW: `settings.json.example` - Example settings file

## Non-Goals
- Multi-process concurrency (one session per project only)
- Cross-machine session management (local only)
- Persistent process tracking (lost on service restart)
- Remote command execution