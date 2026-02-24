# PLAN: Add linear_milestone Tool

## Overview
Add support for Linear milestones via a new `linear_milestone` tool in the extension, following the pattern established by `linear_issue` and `linear_project` tools.

## Linear SDK Milestone API

The Linear SDK provides the following milestone capabilities:

### Queries
- `Project.projectMilestones()` - Get milestones for a project
- `client.projectMilestone(id)` - Get a single milestone

### Model: ProjectMilestone
- Fields: `id`, `name`, `description`, `progress`, `order`, `targetDate`, `status`
- Relations: `project`, `issues()`

### Mutations
- `client.createProjectMilestone(input)` - Create milestone
- `milestone.update(input)` - Update milestone
- `client.deleteProjectMilestone(id)` - Delete milestone

### Status Types
- `ProjectMilestoneStatus` enum: backlogged, planned, inProgress, paused, completed, cancelled

## Implementation Plan

### 1. Add milestone functions to `src/linear.js`
- `fetchProjectMilestones(client, projectId)` - List milestones for a project
- `fetchMilestoneDetails(client, milestoneId)` - Get milestone details with issues
- `createProjectMilestone(client, input)` - Create a new milestone
- `updateProjectMilestone(client, milestoneId, input)` - Update milestone
- `transformMilestone()` - Helper to transform SDK milestone to plain object

### 2. Register `linear_milestone` tool in extension
Actions:
- **list**: List milestones for a project (requires project)
- **view**: View milestone details with associated issues
- **create**: Create a new milestone (requires project, name)
- **update**: Update milestone properties

### 3. Update FUNCTIONALITY.md
Document the new tool and its capabilities.

## Files to Modify
1. `src/linear.js` - Add milestone functions
2. `extensions/pi-linear-service.js` - Add linear_milestone tool registration
3. `FUNCTIONALITY.md` - Document the new tool

## Definition of Done
- [ ] Can list milestones for a project
- [ ] Can view milestone details with issues
- [ ] Can create new milestones
- [ ] Can update milestone properties
- [ ] Works with existing project resolution logic
- [ ] FUNCTIONALITY.md updated
