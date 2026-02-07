# TODO - INN-173: Document start-on-boot for user

## Definition of Done
- README includes exact commands ✓
- Log viewing instructions (`journalctl --user -u pi-linear.service`) ✓

## Verification Steps

- [x] 1. Verify `loginctl enable-linger` guidance:
    - Command present: `loginctl enable-linger $USER`
    - Context: How to check if lingering is enabled
    - Context: How to enable if not already enabled

- [x] 2. Verify what linger implies is documented:
    - "If Linger=yes, user services will start on boot"
    - Clear explanation of the command's purpose

- [x] 3. Verify journalctl commands:
    - `journalctl --user -u pi-linear.service -n 50` (view recent logs)
    - `journalctl --user -u pi-linear.service -f` (follow logs in real-time)
    - `journalctl --user -u pi-linear.service -b` (view since last boot)
    - All documented in "Check status and logs" section

- [x] 4. Verify commands are exact and copy-pasteable:
    - All commands use single-line format
    - No placeholders requiring substitution ($USER is standard shell variable)
    - Commands work as-is

- [>] 5. Update Linear issue (Done + comment), commit, merge to main
