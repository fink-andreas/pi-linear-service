# TODO - INN-171: Debug logging controls (optional)

## Definition of Done
- Support LOG_LEVEL to reduce noise ✓
- Debug logs for "issues with no project" are suppressible ✓

## Verification Steps

- [x] 1. Verify LOG_LEVEL support in logger.js:
    - LOG_LEVEL environment variable is read from process.env
    - Default level is 'info'
    - Valid levels: debug, info, warn, error
    - shouldLog() function filters based on level
    - setLogLevel() function to change level dynamically

- [x] 2. Verify LOG_LEVEL validation in config.js:
    - Valid log levels are defined: ['error', 'warn', 'info', 'debug']
    - LOG_LEVEL is validated on startup
    - Invalid levels throw error with message
    - Default is 'info' if not set

- [x] 3. Verify debug log for "issues with no project":
    - src/linear.js line 181: debug('Ignoring issue with no project', ...)
    - Logs issueId, title, and state
    - Only shown when LOG_LEVEL=debug

- [x] 4. Verify LOG_LEVEL documentation in README:
    - Logging section includes LOG_LEVEL
    - Default value: info
    - Valid levels: error | warn | info | debug
    - Configuration summary shows current LOG_LEVEL

- [x] 5. Verify suppressibility:
    - When LOG_LEVEL=info (default), debug logs are hidden
    - When LOG_LEVEL=debug, all logs including "issues with no project" are shown
    - This reduces noise for normal operation while allowing debug when needed

- [x] 6. Test LOG_LEVEL behavior:
    - Default (info) doesn't show debug logs
    - LOG_LEVEL=debug shows all logs including "Ignoring issue with no project"
    - Invalid LOG_LEVEL throws clear error

- [>] 7. Update Linear issue (Done + comment), commit, merge to main
