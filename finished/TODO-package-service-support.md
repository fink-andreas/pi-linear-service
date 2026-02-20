# TODO - npm package + systemd background service support

## Detailed steps

- [x] 1. Package metadata plan: update `package.json` for scoped package readiness (`@fink-andreas/pi-linear-service`), `bin`, `files`, and publish settings.
- [x] 2. Add CLI entrypoint (`bin/pi-linear-service.js`) with commands: `start`, `service install`, `service uninstall`, `service status`.
- [x] 3. Implement systemd user-unit generator/installer in `src/` with inferred defaults (`cwd`, `.env`) plus explicit overrides (`--working-dir`, `--env-file`).
- [x] 4. Wire install command to run `systemctl --user daemon-reload` + `enable --now`, and add best-effort `postinstall` setup attempt.
- [x] 5. Implement uninstall command: `disable --now`, remove unit file, `daemon-reload`.
- [x] 6. Keep static `pi-linear.service` in package and use it as reference/fallback docs while generated unit remains default install behavior.
- [x] 7. Update `README.md` with npm installation flow, CLI usage examples, and background service management.
- [x] 8. Add/adjust tests or manual validation scripts for CLI + service file generation.
- [x] 9. Run verification: existing project tests, CLI help/reality check, and `npm pack` contents validation.
