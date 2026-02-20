# PLAN - INN-201 Phase 2: installable pi package

## Goal
Make `pi-linear-service` installable with `pi install` (global and local), expose package resources (at least one extension), and keep existing npm/CLI behavior unchanged.

## Scope from issue
- Add `pi` manifest in `package.json`
- Add extension resource layout for discovery
- Ensure git/npm package consumption remains valid
- Keep `pi-linear-service` CLI backward compatible
- Update README with explicit `pi install` flows
- No regression in `npm test`

## Repo areas involved
- `package.json` (pi manifest + packaged files)
- `extensions/` (new extension entrypoint)
- `README.md` (install docs for global/local pi install)
- Existing runtime/CLI code should remain untouched unless needed

## Implementation outline
1. Add package metadata for pi package discovery/loading.
2. Add a minimal extension file under `extensions/`.
3. Update README with `pi install` flows (`global` and `-l` local).
4. Run tests and basic runtime check.
