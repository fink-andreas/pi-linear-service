# Packaging Verification Plan (INN-204)

This plan separates **automated** checks (run by `npm test`) from **manual** checks (needed for interactive UI and environment-specific behavior).

## Automated checks (headless)

### 1) Package manifest/resource assumptions
Command:
```bash
node test-package-manifest.js
```
Expected:
- `package.json` has `pi.extensions` including `./extensions`
- `extensions/` is in publish `files`
- `pi-package` keyword exists
- extension entrypoint exists and registers daemon commands

### 2) Global/local install/remove smoke
Command:
```bash
node test-pi-install-smoke.js
```
Expected:
- Global install writes package source to `~/.pi/agent/settings.json`
- Global remove removes the package source
- Local install (`-l`) writes package source to `<project>/.pi/settings.json`
- Local remove (`-l`) removes the package source
- If `pi` binary is unavailable, test is skipped with explicit message

## Manual checks

### A) Global install visibility
Commands:
```bash
pi install /absolute/path/to/pi-linear-service
pi list
pi config
```
Expected:
- package appears in `pi list`
- extension resource is shown in `pi config` and can be enabled/disabled

### B) Local install visibility
Commands (inside a target repo):
```bash
pi install /absolute/path/to/pi-linear-service -l
pi list
pi config
```
Expected:
- package appears in local package list
- resource is scoped to project-local settings

### C) Fresh session command availability
Commands:
```bash
pi
/reload
/linear-daemon-help
```
Expected:
- slash commands are available after install/reload
- `/linear-daemon-help` prints command list

### D) Remove/uninstall cleanup behavior
Commands:
```bash
pi remove /absolute/path/to/pi-linear-service
pi list

# local scope
pi remove /absolute/path/to/pi-linear-service -l
pi list
```
Expected:
- package disappears from corresponding list
- existing already-running pi session is not broken; removed resources are not available after reload/new session

### E) Linux/systemd-dependent lifecycle check
Commands:
```bash
/linear-daemon-start
/linear-daemon-stop
/linear-daemon-restart
```
Expected:
- commands succeed on Linux with user-systemd configured
- actionable failure when systemd user service is unavailable

## Notes
- Automated tests validate install/remove and packaging assumptions deterministically.
- Manual checks cover interactive runtime UX (`pi config`, slash-command visibility, and live session behavior), which are environment/session dependent.
