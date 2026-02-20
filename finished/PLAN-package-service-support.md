# PLAN - Package and Service Installation for npm Distribution

## Feature goal
Make this project publishable/consumable as `@fink-andreas/pi-linear-service` so users can run:

- `npm i @fink-andreas/pi-linear-service`

and then configure/install a systemd user service with a command (or optional install-time helper), so the daemon can run in background.

## Project exploration summary

### Current repository structure (relevant)
- `package.json` - currently named `pi-linear-service`, no `bin`, no package files whitelist, no install/setup scripts.
- `index.js` - app entrypoint (`#!/usr/bin/env node`) starts daemon logic.
- `pi-linear.service` - static service file with hard-coded absolute paths for a specific machine.
- `src/config.js`, `src/settings.js`, `src/poller.js` - runtime behavior.
- `README.md` - documents local/dev usage, not npm package install/publish flow.

### Current gaps for npm package validity
1. Package name is not scoped (`pi-linear-service` vs required `@fink-andreas/pi-linear-service`).
2. No CLI executable exposed through `bin` for service management.
3. Service unit template is machine-specific (hard-coded paths), not generated per install/user.
4. No install command to place unit into `~/.config/systemd/user/` and enable/start it.
5. No uninstall command to disable/remove service unit.
6. No packaging guardrails (`files`, `publishConfig`, `.npmignore`/included artifacts).
7. README does not document npm usage + service lifecycle commands.

### Existing tests
- Multiple manual/integration JS test scripts (`test-*.js`) and `test-pi-rpc-client.js`.
- No dedicated tests yet for packaging/CLI/service-installer behavior.

## Key implementation decisions (confirmed)
1. **Systemd setup mechanism**
   - Keep explicit command: `pi-linear-service service install`.
   - Also add install-time attempt via `postinstall` (best-effort, non-fatal when unavailable).
2. **CLI surface**
   - Provide `pi-linear-service` bin with subcommands:
     - `start` (run daemon)
     - `service install`
     - `service uninstall`
     - `service status` (optional)
3. **Service file strategy**
   - Keep static `pi-linear.service` in the package.
   - Add generated user-unit output for machine-specific paths (node path, env file, working dir).
4. **Install defaults (elaborated)**
   - `service install` should infer defaults from current environment/cwd:
     - `workingDir`: current cwd when command is run (or package dir fallback)
     - `envFile`: `<workingDir>/.env` by default
   - Also allow explicit overrides via flags (e.g. `--working-dir`, `--env-file`) for production setups.
   - Use systemd **user** unit path: `~/.config/systemd/user/pi-linear-service.service`.
   - Run `systemctl --user daemon-reload`, `enable --now`.
5. **Exec style**
   - Service should execute the package **bin wrapper** (not raw `node index.js`) for consistency across installs.
6. **Backward compatibility**
   - Keep `node index.js` working for existing setups.

## High-level TODO
1. Define npm packaging metadata for scoped publish (`name`, `bin`, publish/include rules).
2. Add CLI entrypoint and command parser for daemon run + systemd management.
3. Implement service unit generation/installation for user systemd (`install` command).
4. Implement `uninstall`/`status` helper commands for service lifecycle.
5. Update docs for npm install, configuration, and systemd command usage.
6. Validate with reality checks (`node index.js --help`/CLI help, install command dry-run/manual) and existing tests.
7. Prepare release checklist for npm publish (`npm pack` verification, versioning, publish instructions).
