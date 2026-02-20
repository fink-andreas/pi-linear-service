# PLAN - INN-203 interactive extension UI flow

## Goal
Add guided in-pi interactive flows for daemon setup and reconfigure, while preserving existing command-line argument mode.

## Requirements
- Separate interactive actions for setup and reconfigure.
- Collect fields in UI:
  - project ID (+ optional project name)
  - repo path (required)
  - assignee (me|all)
  - open states
  - optional runtime fields (timeout, cooldown, provider, model)
- Show validation feedback before persisting changes.
- Keep one-project-per-flow behavior.
- Trigger existing runtime apply path (daemon-control restart/reconfigure behavior).
- Add manual verification steps documentation.

## Files involved
- `extensions/pi-linear-service.js`
- `test-extension-commands.js`
- `README.md` (step list for setup/reconfigure flow)

## Implementation outline
1. Build interactive prompt helpers (input/select/confirm) with defaults.
2. Add pre-write validation (required project id, repo path absolute+exists, assignee/open-state checks, numeric runtime checks).
3. Enhance setup flow to gather full config interactively when flags are missing.
4. Enhance reconfigure flow to load existing values and use them as prompt defaults.
5. Extend tests for interactive setup/reconfigure and validation errors.
6. Add README step list for both UI flows.
7. Run full verification and reality check.
