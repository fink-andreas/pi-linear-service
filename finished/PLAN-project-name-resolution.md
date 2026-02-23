# PLAN: Project Name Resolution and Interactive Project Selection

## Problem Statement
Current daemon commands (`linear-daemon-status`, `linear-daemon-setup`, etc.) require `--id` which exposes users to cryptic Linear project IDs (UUIDs). This is not user-friendly.

## Solution
1. **Accept project name as alternative to project ID**
   - Add `--name` flag as alternative to `--id`
   - Automatically resolve project name to project ID via Linear API

2. **Interactive project selection**
   - When no project reference is provided in interactive mode, fetch and display available projects
   - Allow user to select from a list
   - Support search/filtering if UI supports it

## Files Involved

### src/linear.js
- Add `fetchProjects(apiKey)` - Query all accessible projects from Linear API
- Add `resolveProjectRef(apiKey, ref)` - Resolve project name or ID to canonical project ID

### extensions/pi-linear-service.js
- Add helper `collectProjectRefWithUI(ctx, args)` - Interactive project selection
- Modify command handlers to:
  - Accept `--name` as alternative to `--id`
  - Use interactive selection when no reference provided
  - Resolve project name to ID before proceeding

## High-Level TODO

1. Add `fetchProjects` and `resolveProjectRef` functions to `src/linear.js`
2. Add interactive project selection helper to extension
3. Update `linear-daemon-setup` command
4. Update `linear-daemon-status` command
5. Update `linear-daemon-reconfigure` command
6. Update `linear-daemon-disable` command
7. Update `linear-daemon-help` command documentation
8. Test with manual verification

## Technical Details

### Linear API Query for Projects
```graphql
query Projects {
  projects(first: 50) {
    nodes {
      id
      name
      key
      teams {
        nodes {
          key
        }
      }
    }
  }
}
```

### Resolution Logic
- If `--id` is provided, use it directly
- If `--name` is provided, resolve via API:
  - First try exact match on name
  - Then try case-insensitive match on name
  - Then try match on project key
- In interactive mode, show list of projects if no reference provided
