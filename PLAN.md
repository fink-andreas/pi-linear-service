# PLAN - INN-202 native pi extension commands

## Goal
Add native pi slash commands that wrap existing daemon control/service logic so users can configure and operate `pi-linear-service` from inside pi.

## Issue requirements
- Commands to add:
  - `/linear-daemon-setup`
  - `/linear-daemon-reconfigure`
  - `/linear-daemon-status`
  - `/linear-daemon-disable`
  - `/linear-daemon-start`
  - `/linear-daemon-stop`
  - `/linear-daemon-restart`
- Preserve current validation and one-project-daemon-config model.
- Keep existing CLI behavior unchanged.
- Support non-interactive args and interactive prompts where useful.
- Provide clear success/failure notifications.

## Affected files
- `extensions/pi-linear-service.js` (implement command wrappers)
- `test-*.js` (add extension command tests)
- `package.json` (include new test in npm test script)

## Implementation steps
1. Implement reusable argument parsing in extension command handlers.
2. Wrap existing daemon/service functions from `src/daemon-control.js`.
3. Add interactive fallback prompts for missing required setup/reconfigure/status/disable values.
4. Add success/error notifications and printable status output.
5. Add tests for command registration, argument mode, interactive mode, and error paths.
6. Run full test suite + runtime check.
