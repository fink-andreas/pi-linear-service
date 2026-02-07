# TODO - INN-174: Write README

## Definition of Done
- Install steps ✓
- Config ✓
- Local run ✓
- Deployment as user unit ✓
- Include commands (single-line commands; no backslash continuations) ✓
- Explain logs, troubleshooting, and safe defaults (kill disabled by default) ✓
- A new machine/user can follow README to get it running ✓

## Verification Steps

- [x] 1. Verify install steps are clear:
    - Clone and install section present
    - Copy .env.example to .env
    - Configure required variables
    - Run service commands

- [x] 2. Verify config documentation:
    - Required variables (LINEAR_API_KEY, ASSIGNEE_ID)
    - Optional configuration with defaults
    - Clear descriptions for each variable
    - Example .env file included

- [x] 3. Verify local run instructions:
    - Run in foreground (node index.js)
    - Run in background (nohup)
    - View logs and troubleshoot

- [x] 4. Verify user unit deployment:
    - Copy unit file to ~/.config/systemd/user/
    - Edit paths (WorkingDirectory, ExecStart, EnvironmentFile)
    - systemctl --user commands (daemon-reload, start, enable)
    - Check status and logs with journalctl

- [x] 5. Verify commands are single-line:
    - No backslash continuations found
    - All commands can be copied and pasted directly

- [x] 6. Verify logs documentation:
    - How to view logs (journalctl commands)
    - How to follow logs in real-time
    - How to check status

- [x] 7. Verify troubleshooting section:
    - Service doesn't create sessions
    - All polls failing with errors
    - Sessions being killed unexpectedly
    - Polling appears stuck
    - Can't attach to session

- [x] 8. Verify safe defaults documented:
    - SESSION_KILL_ON_UNHEALTHY=false is default
    - WARNING note about session termination
    - Guidance on disabling kills

- [x] 9. Verify new user can get it running:
    - Quick Start section with step-by-step instructions
    - Clear path from install to running service
    - All required information is present
    - Acceptance Criteria Verification section for validation

- [>] 10. Update Linear issue (Done + comment), commit, merge to main
