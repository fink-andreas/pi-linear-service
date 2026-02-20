# TODO - Hybrid pi extension for project-scoped Linear daemon

- [x] Confirm product decisions: repo mapping policy, UI flow shape, and single-vs-multi daemon config model (explicit mapping, separate UI actions, one config per project)
- [x] Define and document hybrid extension contract (setup, reconfigure, status, lifecycle)
- [x] Design/update settings schema for project-scoped daemon configuration
- [x] Implement config validation + migration path for new schema
- [x] Implement control-plane operations for daemon lifecycle and runtime reconfiguration (INN-195)
- [x] Integrate scope configuration into poller selection/filter logic (INN-196)
- [x] Implement repo-directory resolution strategy according to chosen policy (INN-197)
- [x] Add/extend tests for schema, reconfigure behavior, and scope enforcement (INN-198)
- [x] Update README.md and FUNCTIONALITY.md for hybrid extension usage (INN-199)
- [x] Run verification (npm test + manual Linux/systemd scenario) and capture outcomes (INN-200)
