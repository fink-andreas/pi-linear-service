# PLAN - INN-205 documentation refresh for pi-native flow

## Goal
Refresh documentation for Phase 2 so new users can install via `pi install`, configure in-pi daemon setup/reconfigure flows, and understand migration from npm-only usage.

## Required outcomes
- README:
  - global + local install copy/paste commands
  - quickstart happy path
  - full example from install -> active monitoring
  - legacy CLI-only path vs pi-native path
  - Linux/systemd prerequisites + troubleshooting
- FUNCTIONALITY:
  - extension architecture and control-plane responsibilities
  - final command surface
- migration notes for npm-only users
- verification notes recorded in issue comment

## Files involved
- `README.md`
- `FUNCTIONALITY.md`
- `PLAN.md`
- `TODO.md`

## Implementation steps
1. Restructure README with quickstart + full end-to-end example.
2. Add explicit migration section (npm-only to pi-native package flow).
3. Add troubleshooting section with required cases.
4. Update FUNCTIONALITY architecture/control-plane command surface details.
5. Run docs sanity check (commands align with implemented CLI/extension behavior).
6. Run test + runtime check and include clean-host style walkthrough notes in issue comment.
