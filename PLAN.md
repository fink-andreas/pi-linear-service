# PLAN: Migrate to Linear TypeScript SDK

## Goal
Replace the raw GraphQL implementation in `src/linear.js` with the official `@linear/sdk` package.

## Decisions Made
- **Error handling**: Adopt SDK error types (`LinearError`, `InvalidInputLinearError`, etc.)
- **Metrics**: Remove custom `measureTimeAsync()`, rely on SDK
- **Timeouts**: Accept SDK defaults, remove per-query timeout handling
- **Testing**: Mock LinearClient directly (Option B) - create mock client with stubbed methods
- **Compatibility**: Update consumers to use SDK patterns directly (no backward compat wrappers)

---

## Testing Strategy

### Approach: Mock the LinearClient
Create a mock client object with stubbed methods, similar to existing `createMockPi()` pattern.

### Test File: `test-linear-sdk.js`

```javascript
#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  fetchViewer,
  fetchIssues,
  fetchProjects,
  resolveIssue,
  getTeamWorkflowStates,
  setIssueState,
  addIssueComment,
  updateIssue,
  fetchIssueDetails,
  groupIssuesByProject,
  formatIssueAsMarkdown,
} from './src/linear.js';

/**
 * Create a mock LinearClient for testing
 * @param {Object} overrides - Override specific client methods
 */
function createMockLinearClient(overrides = {}) {
  const mockIssue = (id) => ({
    id,
    identifier: `TEST-${id}`,
    title: `Test Issue ${id}`,
    description: null,
    url: `https://linear.app/issue/TEST-${id}`,
    branchName: null,
    priority: 0,
    estimate: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    state: Promise.resolve({ id: 'state-1', name: 'Todo', color: '#gray', type: 'unstarted' }),
    team: Promise.resolve({ id: 'team-1', key: 'TEST', name: 'Test Team' }),
    project: Promise.resolve({ id: 'proj-1', name: 'Test Project' }),
    assignee: Promise.resolve({ id: 'user-1', name: 'Test User', displayName: 'Test User' }),
    creator: Promise.resolve({ id: 'user-1', name: 'Test User', displayName: 'Test User' }),
    labels: async () => ({ nodes: [] }),
    parent: null,
    children: async () => ({ nodes: [] }),
    comments: async () => ({ nodes: [] }),
    attachments: async () => ({ nodes: [] }),
    update: async (input) => ({ success: true, issue: mockIssue(id) }),
  });

  const base = {
    viewer: Promise.resolve({ id: 'user-1', name: 'Test User', displayName: 'Test User' }),

    issues: async (options = {}) => ({
      nodes: [],
      pageInfo: { hasNextPage: false, endCursor: null }
    }),

    issue: (id) => mockIssue(id),

    projects: async () => ({
      nodes: [
        { id: 'proj-1', name: 'Project One' },
        { id: 'proj-2', name: 'Project Two' },
      ]
    }),

    project: (id) => Promise.resolve({ id, name: `Project ${id}` }),

    team: (id) => Promise.resolve({
      id,
      key: 'TEST',
      name: 'Test Team',
      states: async () => ({
        nodes: [
          { id: 'state-1', name: 'Todo', type: 'unstarted' },
          { id: 'state-2', name: 'In Progress', type: 'started' },
          { id: 'state-3', name: 'Done', type: 'completed' },
        ]
      })
    }),

    teams: async () => ({ nodes: [] }),

    createComment: async (input) => ({
      success: true,
      comment: { id: 'comment-1', body: input.body, createdAt: '2024-01-01T00:00:00Z' }
    }),

    createIssue: async (input) => ({
      success: true,
      issue: mockIssue('new')
    }),
  };

  return { ...base, ...overrides };
}

// ===== TESTS =====

async function testFetchViewer() {
  const client = createMockLinearClient();
  const viewer = await fetchViewer(client);
  assert.equal(viewer.id, 'user-1');
  assert.equal(viewer.name, 'Test User');
}

async function testFetchIssuesWithAssignee() {
  const client = createMockLinearClient({
    issues: async (options) => {
      // Verify filter is passed correctly
      assert.deepEqual(options.filter.assignee, { id: { eq: 'user-1' } });
      assert.deepEqual(options.filter.state, { name: { in: ['Todo', 'In Progress'] } });
      return {
        nodes: [
          { id: 'i1', title: 'Issue 1', state: { name: 'Todo' }, assignee: { id: 'user-1' }, project: { id: 'p1', name: 'P1' } },
          { id: 'i2', title: 'Issue 2', state: { name: 'In Progress' }, assignee: { id: 'user-1' }, project: { id: 'p1', name: 'P1' } },
        ],
        pageInfo: { hasNextPage: false }
      };
    }
  });

  const result = await fetchIssues(client, 'user-1', ['Todo', 'In Progress'], 50);
  assert.equal(result.issues.length, 2);
  assert.equal(result.truncated, false);
}

async function testFetchIssuesWithoutAssignee() {
  const client = createMockLinearClient({
    issues: async (options) => {
      assert.equal(options.filter.assignee, undefined);
      return { nodes: [], pageInfo: { hasNextPage: false } };
    }
  });

  const result = await fetchIssues(client, null, ['Todo'], 50);
  assert.equal(result.issues.length, 0);
}

async function testFetchProjects() {
  const client = createMockLinearClient();
  const projects = await fetchProjects(client);
  assert.equal(projects.length, 2);
  assert.equal(projects[0].name, 'Project One');
}

async function testResolveIssueById() {
  const client = createMockLinearClient({
    issue: (id) => {
      if (id === 'uuid-123') {
        return {
          id: 'uuid-123',
          identifier: 'TEST-456',
          title: 'Found by ID',
          state: { name: 'Todo' },
          team: { id: 'team-1', key: 'TEST' },
        };
      }
      return null;
    }
  });

  const issue = await resolveIssue(client, 'uuid-123');
  assert.equal(issue.identifier, 'TEST-456');
}

async function testResolveIssueByIdentifier() {
  const client = createMockLinearClient({
    issue: () => null, // Direct lookup fails
    issues: async (options) => {
      if (options.filter?.identifier?.eq === 'TEST-789') {
        return {
          nodes: [{ id: 'uuid-789', identifier: 'TEST-789', title: 'Found by Identifier' }],
          pageInfo: { hasNextPage: false }
        };
      }
      return { nodes: [], pageInfo: { hasNextPage: false } };
    }
  });

  const issue = await resolveIssue(client, 'TEST-789');
  assert.equal(issue.id, 'uuid-789');
}

async function testResolveIssueNotFound() {
  const client = createMockLinearClient({
    issue: () => null,
    issues: async () => ({ nodes: [], pageInfo: { hasNextPage: false } })
  });

  await assert.rejects(
    () => resolveIssue(client, 'NONEXISTENT'),
    /Issue not found/
  );
}

async function testSetIssueState() {
  let updateCalled = false;
  const client = createMockLinearClient({
    issue: (id) => ({
      id,
      identifier: 'TEST-1',
      update: async (input) => {
        updateCalled = true;
        assert.equal(input.stateId, 'state-2');
        return { success: true, issue: { id, identifier: 'TEST-1', state: { name: 'In Progress' } } };
      }
    })
  });

  const result = await setIssueState(client, 'issue-1', 'state-2');
  assert.ok(updateCalled);
  assert.equal(result.state.name, 'In Progress');
}

async function testAddIssueComment() {
  const client = createMockLinearClient({
    issue: () => ({ id: 'issue-1', identifier: 'TEST-1', title: 'Test' }),
    issues: async () => ({ nodes: [], pageInfo: { hasNextPage: false } }),
    createComment: async (input) => {
      assert.equal(input.issueId, 'issue-1');
      assert.equal(input.body, 'Test comment');
      return { success: true, comment: { id: 'c1', body: input.body } };
    }
  });

  const result = await addIssueComment(client, 'issue-1', 'Test comment');
  assert.equal(result.comment.id, 'c1');
}

async function testGroupIssuesByProject() {
  // Pure function - no mock needed
  const issues = [
    { id: '1', project: { id: 'p1', name: 'Project 1' } },
    { id: '2', project: { id: 'p1', name: 'Project 1' } },
    { id: '3', project: { id: 'p2', name: 'Project 2' } },
    { id: '4', project: null }, // Should be ignored
  ];

  const grouped = groupIssuesByProject(issues);
  assert.equal(grouped.size, 2);
  assert.equal(grouped.get('p1').issueCount, 2);
  assert.equal(grouped.get('p2').issueCount, 1);
}

async function main() {
  await testFetchViewer();
  await testFetchIssuesWithAssignee();
  await testFetchIssuesWithoutAssignee();
  await testFetchProjects();
  await testResolveIssueById();
  await testResolveIssueByIdentifier();
  await testResolveIssueNotFound();
  await testSetIssueState();
  await testAddIssueComment();
  await testGroupIssuesByProject();

  console.log('✓ test-linear-sdk.js passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

### Test Coverage

| Function | Test Cases |
|----------|------------|
| `fetchViewer` | Returns viewer id and name |
| `fetchIssues` | With assignee filter, without assignee, pagination |
| `fetchProjects` | Returns project list |
| `resolveIssue` | By UUID, by identifier, not found error |
| `getTeamWorkflowStates` | Returns states for team |
| `setIssueState` | Updates state, handles failure |
| `addIssueComment` | Creates comment, with parent reply |
| `updateIssue` | Update title/priority/state |
| `fetchIssueDetails` | Returns nested relations |
| `groupIssuesByProject` | Groups correctly, ignores no-project |
| `formatIssueAsMarkdown` | Formats output correctly |

---

## Current State

### File: `src/linear.js` (~430 lines)

### Exported Functions → SDK Mapping

| Current Function | SDK Equivalent | Consumer | Notes |
|-----------------|----------------|----------|-------|
| `executeQuery(apiKey, query, vars, opts)` | `new LinearClient({ apiKey })` + methods | internal, tests | **REMOVE** - replaced by SDK client |
| `runSmokeQuery(apiKey)` | `client.viewer` | poller.js | Simple |
| `fetchIssues(apiKey, assigneeId, states, limit)` | `client.issues({ filter, first })` | poller.js | Map filter syntax |
| `fetchAssignedIssues(...)` | — | deprecated | **REMOVE** |
| `groupIssuesByProject(issues)` | — (pure JS) | poller.js | **KEEP** unchanged |
| `resolveIssue(apiKey, issue)` | `client.issue(id)` or filter | internal | Simplify |
| `getTeamWorkflowStates(apiKey, teamId)` | `client.team(id).states` | internal | Simple |
| `prepareIssueStart(apiKey, issue)` | SDK combo | extension | Refactor |
| `setIssueState(apiKey, issueId, stateId)` | `issue.update({ stateId })` | extension | Via SDK |
| `startIssue(apiKey, issue)` | SDK combo | unused? | **KEEP or REMOVE** |
| `addIssueComment(apiKey, issue, body, parent)` | `client.createComment({ input })` | extension | Simple |
| `fetchProjects(apiKey)` | `client.projects()` | extension | Simple |
| `resolveProjectRef(apiKey, ref)` | Project lookup | extension | Refactor |
| `updateIssue(apiKey, issue, patch)` | `issue.update({ ...patch })` | extension | Via SDK |
| `fetchIssueDetails(apiKey, issue, opts)` | `client.issue(id)` with nested | extension | Map fields |
| `formatIssueAsMarkdown(issueData)` | — (pure JS) | extension | **KEEP** unchanged |

### Consumers
1. **src/poller.js**
   - `runSmokeQuery` → `client.viewer`
   - `fetchIssues` → `client.issues({ filter })`
   - `groupIssuesByProject` → unchanged (pure JS)

2. **extensions/pi-linear-service.js**
   - `prepareIssueStart`, `setIssueState`, `addIssueComment`
   - `updateIssue`, `fetchProjects`, `resolveProjectRef`
   - `fetchIssueDetails`, `formatIssueAsMarkdown`

---

## Implementation Design

### New File: `src/linear-client.js`
SDK client factory - creates configured LinearClient instance.

```javascript
import { LinearClient } from '@linear/sdk';

export function createLinearClient(apiKey) {
  return new LinearClient({ apiKey });
}
```

### Refactored: `src/linear.js`
All functions now receive `LinearClient` instance instead of raw `apiKey`.

**New signature pattern:**
```javascript
// OLD
export async function fetchIssues(apiKey, assigneeId, openStates, limit) { ... }

// NEW
export async function fetchIssues(client, assigneeId, openStates, limit) {
  const result = await client.issues({
    first: limit,
    filter: {
      assignee: assigneeId ? { id: { eq: assigneeId } } : undefined,
      state: { name: { in: openStates } }
    }
  });

  return {
    issues: result.nodes.map(node => ({
      id: node.id,
      title: node.title,
      state: { name: node.state?.name },
      assignee: { id: node.assignee?.id },
      project: { id: node.project?.id, name: node.project?.name }
    })),
    truncated: result.pageInfo?.hasNextPage ?? false
  };
}
```

### Consumer Updates

**src/poller.js:**
```javascript
// OLD
import { runSmokeQuery, fetchIssues, groupIssuesByProject } from './linear.js';

// NEW
import { createLinearClient } from './linear-client.js';
import { fetchIssues, groupIssuesByProject, fetchViewer } from './linear.js';

const client = createLinearClient(config.linearApiKey);
const viewer = await fetchViewer(client);
const { issues } = await fetchIssues(client, viewerId, states, limit);
```

**extensions/pi-linear-service.js:**
```javascript
// OLD - each function takes apiKey
await setIssueState(apiKey, issueId, stateId);

// NEW - create client once, pass to functions
const client = createLinearClient(apiKey);
await setIssueState(client, issueId, stateId);
```

---

## Functions to Remove
- `executeQuery` - replaced by SDK
- `fetchAssignedIssues` - deprecated wrapper

## Functions to Keep Unchanged
- `groupIssuesByProject` - pure JS helper
- `formatIssueAsMarkdown` - pure JS helper

---

## Files to Modify

| File | Changes |
|------|---------|
| `package.json` | Add `@linear/sdk` dependency |
| `src/linear-client.js` | **NEW** - client factory |
| `src/linear.js` | Refactor all functions to use SDK |
| `src/poller.js` | Update imports, create client, pass to functions |
| `extensions/pi-linear-service.js` | Update imports, create client per-command |
| `test-linear-sdk.js` | **NEW** - SDK-based tests |
| `README.md` | Document SDK dependency |

---

## Detailed Migration Per Function

### `runSmokeQuery` → `fetchViewer`
```javascript
export async function fetchViewer(client) {
  const viewer = await client.viewer;
  return { id: viewer.id, name: viewer.name };
}
```

### `fetchIssues`
```javascript
export async function fetchIssues(client, assigneeId, openStates, limit) {
  const filter = {
    state: { name: { in: openStates } }
  };
  if (assigneeId) {
    filter.assignee = { id: { eq: assigneeId } };
  }

  const result = await client.issues({
    first: limit,
    filter
  });

  return {
    issues: result.nodes.map(transformIssue),
    truncated: result.pageInfo?.hasNextPage ?? false
  };
}
```

### `fetchProjects`
```javascript
export async function fetchProjects(client) {
  const result = await client.projects();
  return result.nodes.map(p => ({ id: p.id, name: p.name }));
}
```

### `resolveIssue`
```javascript
export async function resolveIssue(client, issueRef) {
  // Try direct ID lookup first
  if (isLinearId(issueRef)) {
    const issue = await client.issue(issueRef);
    if (issue) return transformIssue(issue);
  }

  // Try identifier lookup (ABC-123)
  const result = await client.issues({
    filter: { identifier: { eq: issueRef } },
    first: 1
  });

  if (result.nodes[0]) return transformIssue(result.nodes[0]);
  throw new Error(`Issue not found: ${issueRef}`);
}
```

### `getTeamWorkflowStates`
```javascript
export async function getTeamWorkflowStates(client, teamRef) {
  const team = await client.team(teamRef);
  if (!team) throw new Error(`Team not found: ${teamRef}`);
  const states = await team.states;
  return states.nodes.map(s => ({
    id: s.id,
    name: s.name,
    type: s.type
  }));
}
```

### `setIssueState`
```javascript
export async function setIssueState(client, issueId, stateId) {
  const issue = await client.issue(issueId);
  if (!issue) throw new Error(`Issue not found: ${issueId}`);
  const result = await issue.update({ stateId });

  if (!result.success) {
    throw new Error('Failed to update issue state');
  }

  return transformIssue(result.issue);
}
```

### `addIssueComment`
```javascript
export async function addIssueComment(client, issueRef, body, parentId) {
  const issue = await resolveIssue(client, issueRef);
  const result = await client.createComment({
    issueId: issue.id,
    body,
    ...(parentId && { parentId })
  });

  if (!result.success) {
    throw new Error('Failed to create comment');
  }

  return { issue, comment: result.comment };
}
```

### `updateIssue`
```javascript
export async function updateIssue(client, issueRef, patch) {
  const issue = await resolveIssue(client, issueRef);
  const updateInput = {};

  if (patch.title !== undefined) updateInput.title = patch.title;
  if (patch.description !== undefined) updateInput.description = patch.description;
  if (patch.priority !== undefined) updateInput.priority = patch.priority;

  if (patch.state !== undefined) {
    const team = await issue.team;
    const states = await team.states;
    const stateId = resolveStateId(states.nodes, patch.state);
    updateInput.stateId = stateId;
  }

  const result = await issue.update(updateInput);
  if (!result.success) throw new Error('Failed to update issue');

  return { issue: transformIssue(result.issue), changed: Object.keys(updateInput) };
}
```

### `fetchIssueDetails`
```javascript
export async function fetchIssueDetails(client, issueRef, options = {}) {
  const issue = await resolveIssue(client, issueRef);

  // Fetch nested relations
  const [team, project, assignee, creator, labels, parent, children, comments, attachments] =
    await Promise.all([
      issue.team,
      issue.project,
      issue.assignee,
      issue.creator,
      issue.labels(),
      issue.parent,
      issue.children(),
      options.includeComments !== false ? issue.comments() : null,
      issue.attachments()
    ]);

  return {
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description,
    url: issue.url,
    branchName: issue.branchName,
    priority: issue.priority,
    estimate: issue.estimate,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    state: { name: (await issue.state)?.name, color: (await issue.state)?.color, type: (await issue.state)?.type },
    team: team ? { id: team.id, key: team.key, name: team.name } : null,
    project: project ? { id: project.id, name: project.name } : null,
    assignee: assignee ? { id: assignee.id, name: assignee.name, displayName: assignee.displayName } : null,
    creator: creator ? { id: creator.id, name: creator.name, displayName: creator.displayName } : null,
    labels: labels?.nodes?.map(l => ({ id: l.id, name: l.name, color: l.color })) || [],
    parent: parent ? { identifier: parent.identifier, title: parent.title } : null,
    children: children?.nodes?.map(c => ({ identifier: c.identifier, title: c.title })) || [],
    comments: comments?.nodes || [],
    attachments: attachments?.nodes || []
  };
}
```

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| SDK field names differ from raw GraphQL | Transform SDK responses to match expected shapes |
| Missing `measureTimeAsync` metrics | Accept trade-off per decision |
| Different error message format | Update consumers to handle `LinearError` types |
| SDK async relations (team, project, etc.) | Use `await` for nested relations |
