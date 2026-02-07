# TODO - INN-172: Create pi-linear.service unit file

## Implementation Steps

- [x] 1. Create pi-linear.service systemd user unit file:
    - Add [Unit] section with Description
    - Add [Service] section with:
      - Type=simple
      - Restart=on-failure
      - RestartSec=5s (backoff delay)
      - WorkingDirectory=/path/to/pi-linear-service (placeholder)
      - EnvironmentFile=/path/to/.env (placeholder)
      - ExecStart=/usr/bin/env node index.js
    - Add [Install] section with WantedBy=default.target

- [x] 2. Add installation script or documentation:
    - Document how to create ~/.config/systemd/user/ directory
    - Document how to copy unit file to correct location
    - Document how to update WorkingDirectory and EnvironmentFile paths
    - Document systemctl commands: daemon-reload, start, enable, status

- [x] 3. Test the unit file:
    - Create a test .env file in the project directory
    - Copy unit file to ~/.config/systemd/user/
    - Run systemctl --user daemon-reload
    - Run systemctl --user start pi-linear.service
    - Run systemctl --user status pi-linear.service
    - Run journalctl --user -u pi-linear.service -n 20
    - Run systemctl --user stop pi-linear.service

- [x] 4. Update README.md with systemd installation section:
    - Add "Systemd User Unit Installation" section
    - Include step-by-step installation instructions
    - Include systemctl commands for starting/stopping/enabling
    - Include troubleshooting tips

- [>] 5. Update Linear issue (Done + comment), commit, merge to main
