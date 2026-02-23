# pi-linear-service Agent Configuration

## Before Any Implementation Work

1. **ALWAYS** ensure with "git status" if on main and in sync with origin
2. **ALWAYS** use linear to start new issue and ensure correct git branch
3. Verify you understand the requirements and architecture decisions (see PRD.md and TODO.md)

## Running the Service

**NEVER** run `node index.js` or `node index.js --help` without a timeout - the service runs forever as a daemon. Use:
```bash
timeout 5 node index.js --help 2>&1 || true
```
Or just check syntax/errors with:
```bash
node --check index.js
```
4. Follow the exact structure and guidelines outlined
5. Implement according to specifications
6. Respect the defined scope and non-goals
7. **ALWAYS** run `npm install` after package.json changes, and verify the service starts
8. **ALWAYS** perform a reality check with `node index.js --help` or manual test

## Before Committing and Marking Issue as Done

**CRITICAL:** Verify the implementation before final commit:
```bash
# Test that the service runs without errors (with required env)
LINEAR_API_KEY="test" ASSIGNEE_ID="test" node index.js
```

### Testing Overview

This project uses manual testing and integration testing:

- **Manual Testing**: Verify core functionality works as expected
- **Integration Testing**: Test with real Linear API and tmux sessions
- **End-to-End Testing**: Verify systemd user unit deployment

**Note:** This project does not currently have automated unit tests. Tests are performed manually according to the acceptance criteria in each issue.

## Linear Workflow

### Project Scope

**CRITICAL RULE:** Work is strictly limited to issues within the current project only.

- **STRICTLY** work only on issues that are in the current project (pi-linear-service):
  ```bash
  linear issue list --all-states --unassigned --project pi-linear-service
  ```
- **NEVER** work on issues from other projects
- **ALWAYS** list also unassigned issues
- If changes in other projects are required, create a new issue in that other project
- Always verify the issue's project context before starting work

### Strict Flow

**ALWAYS** follow this flow:

1. `linear issue start <issue-id>` - Create/switch to branch and mark as In Progress
2. Implement changes according to issue requirements
3. Verify implementation works (manual testing)
4. `linear issue update <issue-id> -s Done` - Mark issue as Done
5. `linear issue comment add <issue-id> -b "<text>"` - Add comment describing changes
6. Commit feature branch and push to main

⚠️ **IMPORTANT:** Step 5 is REQUIRED - you MUST add a comment describing what changes were made before considering the issue complete. Even if you think it's trivial, always add a comment.

### Comment Guidelines

When adding a comment to a completed issue, include:
- Summary of changes made
- Files modified/created
- Testing performed
- Any relevant notes or edge cases

**Example:**
```bash
linear issue comment add INN-155 -b "Changes made:
- Created package.json with ESM type and Node 18+ engine requirement
- Created index.js entrypoint with boot → validate env → start poll loop structure
- Created src/config.js with environment validation
- Created src/poller.js with poll loop initialization
- Tested: exits with clear error when env missing, starts successfully with env
- Definition of done met: node index.js starts and exits with clear error when env is missing"
```

### Issue Completion Checklist

Before considering an issue complete:
- [ ] All code changes completed and tested
- [ ] Definition of done for the specific issue is met
- [ ] Issue state updated to Done
- [ ] Comment added with changes summary
- [ ] TODO.md updated (if applicable)

## Git Workflow

### 1. Start: Isolation
**Always** work on a feature branch to keep the main codebase safe:
```bash
linear issue start INN-XXX  # This creates and switches to the branch automatically
```

### 2. Dev Loop: Secure Progress
Perform this loop frequently to save incremental steps:
```bash
git status          # See what files changed
git add .           # Stage all files
git commit -m "Brief description of changes"  # Save snapshot
```

### 3. Safety: Discard Changes
If the recent code (since the last commit) is bad:
```bash
git reset --hard HEAD  # Warning: permanently deletes uncommitted work
```

### 4. Finish: Merge to Main
Once the feature is complete and tested:
```bash
git status          # Ensure all files are committed
git checkout main   # Switch to main
git pull origin main  # Get latest updates
git merge <feature-branch>  # Merge your work
git push            # Push to origin
```

## Project-Specific Guidelines

### Technology Stack
- **Language:** Node.js (ESM modules, type: "module")
- **Node Version:** >=18.0.0
- **Deployment:** systemd user unit (~/.config/systemd/user/)
- **Package Manager:** npm

### Code Organization
- Entry point: `index.js`
- Source code: `src/*.js` modules
- Configuration: `.env` file (documented in `.env.example`)
- Documentation: `README.md`, `PRD.md`, `TODO.md`

### Key Dependencies (will be added as project progresses)
- Environment variable loading
- GraphQL client for Linear API
- tmux interaction via child_process
- systemd integration (user unit file)

### Acceptance Criteria Validation
For each issue, verify the acceptance criteria as defined in TODO.md and PRD.md:
- Local run with valid `.env` works as expected
- Error handling is robust
- Logging is appropriate
- systemd user unit can be deployed (later milestones)

## Quick Tips for Working with Linear

1. **Never Use Browser Commands**: `-w` and `-a` flags will fail in headless environments. Use `linear issue url` for manual access.

2. **State Names**: Use exact state names configured in your workspace (e.g., "Done", "In Progress"). View the issue first to see available states.

3. **Branch Naming**: The `linear issue start` command auto-creates branches with format like `fink-andreas/inn-XXX-issue-title`.

4. **Config File**: The project uses `.linear.toml` with team configuration for proper Linear CLI integration.

5. **Listing Issues**: Always use `--sort priority` flag to sort issues by priority.
