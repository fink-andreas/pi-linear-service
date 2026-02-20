# PLAN - INN-204 packaging E2E tests and verification

## Goal
Provide automated + manual verification for `pi install` packaging flow and extension runtime integration.

## Scope mapping
- Automated:
  - package manifest/resource discovery assumptions
  - install/remove smoke for global + local (`-l`) scopes in isolated temp dirs
  - cleanup behavior validation in settings files
- Manual:
  - `pi list` / `pi config` visibility confirmation
  - extension command visibility in fresh pi session
  - systemd-dependent lifecycle checks

## Files to change
- `test-package-manifest.js` (new)
- `test-pi-install-smoke.js` (new)
- `package.json` (include tests)
- `PACKAGING_TEST_PLAN.md` (new command-by-command verification plan)
- `README.md` (link to verification plan)

## Implementation steps
1. Add deterministic manifest/resource test.
2. Add install/remove smoke test with isolated HOME and project dirs.
3. Add test plan documenting exact commands and expected outcomes for global/local installs.
4. Link verification plan from README.
5. Run full tests and runtime check.
