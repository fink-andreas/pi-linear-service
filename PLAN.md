# PLAN - Linear API issue actions as agent tools in pi extension

## Goal
Add extension tools (LLM-callable) to `pi-linear-service` so the pi coding agent can execute Linear issue actions with behavior aligned to linear-cli workflows, but implemented via direct Linear GraphQL API calls:
- start issue (`linear issue start` equivalent)
- add comment (`linear issue comment add` equivalent)
- update issue (`linear issue update` equivalent)

## Scope
- Add new extension tools exposed via `pi.registerTool(...)`.
- Implement direct Linear GraphQL mutations/queries in project code (no dependency on local `linear` binary).
- Reuse existing API client patterns in `src/linear.js` (`executeQuery`, timeout, logging).
- Return concise structured tool outputs for the agent.
- Add tests for tool registration + mutation execution paths (success/error).
- Update docs for newly available tools and required env/auth behavior.

## Out of scope
- Shelling out to linear-cli.
- Full feature parity with every linear-cli flag in first iteration.
- Replacing existing daemon setup/status/lifecycle commands.

## Project exploration summary
Relevant files:
- `extensions/pi-linear-service.js` - extension entrypoint; currently only slash commands.
- `src/linear.js` - existing GraphQL transport helper (`executeQuery`) and issue querying.
- `src/config.js` / env usage in runtime - source of existing credential expectations.
- `test-extension-commands.js` - extension behavior tests; to extend for tools.
- `README.md` / `FUNCTIONALITY.md` - feature documentation.

Current state findings:
- No extension tools currently registered.
- Linear GraphQL request infra already exists and should be extended with issue mutation helpers.
- Existing project already depends on `LINEAR_API_KEY` and has logging/error handling conventions.

## Design direction
1. Extend `src/linear.js` with focused helpers for issue mutations:
   - `startIssue(apiKey, issueIdentifier)` (maps to setting workflow state to started/in-progress)
   - `commentIssue(apiKey, issueIdentifier, body)`
   - `updateIssue(apiKey, issueIdentifier, patch)`
2. Add issue lookup helper (by id/key) to resolve identifiers before mutation when needed.
3. Register 3 extension tools:
   - `linear_issue_start`
   - `linear_issue_comment_add`
   - `linear_issue_update`
4. Use structured tool parameters (explicit fields) instead of raw CLI arg passthrough:
   - deterministic and API-native
   - can still mirror linear-cli intent and naming
5. Validate required inputs + env (`LINEAR_API_KEY`) and provide actionable errors.
6. Keep existing slash commands unchanged.

## Finalized tool API + GraphQL mapping (Step 1)

### `linear_issue_start`
Parameters:
- `issue` (string, required) — issue key (`ABC-123`) or Linear issue id.

Mapping:
1. Resolve issue node (id, identifier, team id, current state).
2. Resolve team workflow states and select first `type === "started"` state (fallback name `In Progress`).
3. Mutation: `issueUpdate(id: <issueId>, input: { stateId: <startedStateId> })`.

### `linear_issue_comment_add`
Parameters:
- `issue` (string, required) — issue key or id.
- `body` (string, required) — markdown comment text.
- `parentCommentId` (string, optional) — for threaded replies.

Mapping:
1. Resolve issue id from `issue`.
2. Mutation: `commentCreate(input: { issueId, body, parentId? })`.

### `linear_issue_update`
Parameters:
- `issue` (string, required) — issue key or id.
- `title` (string, optional)
- `description` (string, optional)
- `priority` (number, optional, 0-4)
- `state` (string, optional) — state name (e.g., `Done`, `In Progress`) or state id.

Mapping:
1. Resolve issue id (+ team id for state lookup).
2. Build `IssueUpdateInput` patch from supplied fields.
3. If `state` provided by name, resolve to state id within team first.
4. Mutation: `issueUpdate(id: <issueId>, input: <patch>)`.

### Shared behavior
- Auth source: `LINEAR_API_KEY` env var.
- Identifier resolution helper supports key and id.
- All tools return concise result text + structured details (`issueId`, `identifier`, changed fields, API response id/success).
- Failures return actionable messages (missing env, issue/state not found, API errors).

## Open questions / assumptions
No blocking questions remain for v1 scope.

Assumed defaults for implementation:
- Resolve issue by key and support UUID/id fallback.
- For start: use team `started` workflow state.
- `linear_issue_update` supports `title`, `description`, `priority`, and `state` in v1.

## High-level TODO
1. Finalize tool API + GraphQL mutation mapping for start/comment/update.
2. Implement Linear API helpers in `src/linear.js` (lookup + mutations).
3. Register 3 tools in `extensions/pi-linear-service.js` using new helpers.
4. Add tests for tool registration and mutation success/failure handling.
5. Update README/FUNCTIONALITY with new tool docs and usage examples.
6. Run verification (`npm test` and `node index.js --help`).

## Follow-up: linear-cli parity for issue start git operation
Goal: make `linear_issue_start` also perform git branch start behavior like `linear issue start`.

Planned behavior:
- Use Linear issue `branchName` as default branch name.
- Support optional tool params:
  - `fromRef` (default `HEAD`)
  - `branch` override
  - `onBranchExists`: `switch` or `suffix` (suffix appends `-1`, `-2`, ...)
- Git flow:
  - check branch existence (`git rev-parse --verify <branch>`)
  - if exists: switch or create suffixed branch per strategy
  - if missing: create and checkout from ref (`git checkout -b <branch> <fromRef>`)
- After git operation succeeds, move issue to started state via GraphQL mutation.
