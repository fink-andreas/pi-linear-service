# INN-175: Acceptance Criteria Walkthrough - Implementation Plan

## Current State

README.md exists with installation, configuration, and troubleshooting sections. No explicit acceptance criteria verification section exists.

## Requirements

Create a checklist-style section mapping each acceptance criterion to a quick verification step. All criteria must be explicitly covered and reproducible.

## Acceptance Criteria from PRD

### Local Run (`node index.js`) with valid `.env`

1. Immediate poll occurs on startup
2. One tmux session per qualifying project created, no duplicates on subsequent polls
3. Exited pane/process ⇒ unhealthy immediately
4. If `SESSION_KILL_ON_UNHEALTHY=true`, unhealthy sessions owned by this service are killed and recreated on later polls if still required, respecting cooldown

### User Unit Deployment

1. `~/.config/systemd/user/pi-linear.service` works with `systemctl --user`
2. Uses `EnvironmentFile=`
3. Restarts on failure
4. README shows how to view logs with `journalctl --user -u pi-linear.service`
5. README shows how to ensure start-on-boot for user

## Implementation Plan

### 1. Create Acceptance Criteria Verification section

Add a new section to README.md after "Troubleshooting" with:
- Overview of the verification process
- Two main sections: Local Run Verification and User Unit Deployment Verification
- Each criterion mapped to concrete verification steps
- Commands to run
- Expected output to look for

### 2. Verification Structure

**Local Run Verification:**
- Verify environment setup
- Verify immediate poll on startup
- Verify session creation (idempotence)
- Verify health detection
- Verify kill/restart with cooldown

**User Unit Deployment Verification:**
- Verify unit file installation
- Verify systemd commands work
- Verify EnvironmentFile usage
- Verify restart on failure
- Verify log viewing
- Verify start-on-boot configuration

## Definition of Done

- [ ] Acceptance criteria section added to README.md
- [ ] All local run criteria covered with verification steps
- [ ] All user unit deployment criteria covered with verification steps
- [ ] Each criterion has clear commands to run
- [ ] Each criterion has expected output indicators
- [ ] All verification steps are reproducible
