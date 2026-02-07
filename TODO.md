# TODO - INN-175: Acceptance Criteria Walkthrough

## Implementation Steps

- [x] 1. Create ACCEPTANCE_CRITERIA.md section in README.md:
    - Add new section after "Troubleshooting"
    - Include overview of verification process
    - Create two subsections: Local Run and User Unit Deployment

- [x] 2. Add Local Run Verification criteria:
    - Verify environment setup
    - Verify immediate poll on startup
    - Verify session creation (idempotence)
    - Verify health detection (exited pane = unhealthy)
    - Verify kill/restart with cooldown

- [x] 3. Add User Unit Deployment Verification criteria:
    - Verify unit file installation
    - Verify systemctl --user commands work
    - Verify EnvironmentFile usage
    - Verify restart on failure
    - Verify log viewing with journalctl
    - Verify start-on-boot (loginctl enable-linger)

- [x] 4. For each criterion add:
    - Clear description of what is being verified
    - Commands to run
    - Expected output/log messages to look for
    - How to interpret results

- [x] 5. Test verification steps:
    - Run through all local run verification steps
    - Run through all user unit deployment verification steps
    - Verify each step is clear and reproducible

- [>] 6. Update Linear issue (Done + comment), commit, merge to main
