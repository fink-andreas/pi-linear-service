#!/usr/bin/env node

/**
 * Tests for Linear SDK-based functions
 *
 * Uses mock LinearClient to test function behavior without real API calls.
 */

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
  const mockIssue = (id) => {
    const issue = {
      id,
      identifier: `TEST-${id.slice(0, 4)}`,
      title: `Test Issue ${id}`,
      description: `Description for ${id}`,
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
      update: async (input) => {
        issue._updateInput = input;
        return { success: true, issue };
      },
    };
    return issue;
  };

  const base = {
    viewer: Promise.resolve({
      id: 'user-1',
      name: 'Test User',
      displayName: 'Test User',
    }),

    issues: async (options = {}) => ({
      nodes: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    }),

    issue: (id) => mockIssue(id),

    projects: async () => ({
      nodes: [
        { id: 'proj-1', name: 'Project One' },
        { id: 'proj-2', name: 'Project Two' },
      ],
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
        ],
      }),
    }),

    teams: async () => ({ nodes: [] }),

    createComment: async (input) => ({
      success: true,
      comment: { id: 'comment-1', body: input.body, createdAt: '2024-01-01T00:00:00Z' },
    }),

    createIssue: async (input) => ({
      success: true,
      issue: mockIssue('new'),
    }),
  };

  return { ...base, ...overrides };
}

// ===== TESTS =====

async function testFetchViewer() {
  const client = createMockLinearClient();
  const viewer = await fetchViewer(client);
  assert.equal(viewer.id, 'user-1', 'should return viewer id');
  assert.equal(viewer.name, 'Test User', 'should return viewer name');
  assert.equal(viewer.displayName, 'Test User', 'should return displayName');
}

async function testFetchIssuesWithAssignee() {
  const client = createMockLinearClient({
    issues: async (options) => {
      // Verify filter is passed correctly
      assert.deepEqual(options.filter.assignee, { id: { eq: 'user-1' } }, 'should filter by assignee');
      assert.deepEqual(options.filter.state, { name: { in: ['Todo', 'In Progress'] } }, 'should filter by states');
      return {
        nodes: [
          {
            id: 'i1',
            identifier: 'TEST-1',
            title: 'Issue 1',
            state: Promise.resolve({ id: 's1', name: 'Todo', type: 'unstarted' }),
            assignee: Promise.resolve({ id: 'user-1', name: 'User 1', displayName: 'User 1' }),
            project: Promise.resolve({ id: 'p1', name: 'P1' }),
          },
          {
            id: 'i2',
            identifier: 'TEST-2',
            title: 'Issue 2',
            state: Promise.resolve({ id: 's2', name: 'In Progress', type: 'started' }),
            assignee: Promise.resolve({ id: 'user-1', name: 'User 1', displayName: 'User 1' }),
            project: Promise.resolve({ id: 'p1', name: 'P1' }),
          },
        ],
        pageInfo: { hasNextPage: false },
      };
    },
  });

  const result = await fetchIssues(client, 'user-1', ['Todo', 'In Progress'], 50);
  assert.equal(result.issues.length, 2, 'should return 2 issues');
  assert.equal(result.truncated, false, 'should not be truncated');
}

async function testFetchIssuesWithoutAssignee() {
  const client = createMockLinearClient({
    issues: async (options) => {
      assert.equal(options.filter.assignee, undefined, 'should not have assignee filter');
      return { nodes: [], pageInfo: { hasNextPage: false } };
    },
  });

  const result = await fetchIssues(client, null, ['Todo'], 50);
  assert.equal(result.issues.length, 0, 'should return empty array');
}

async function testFetchIssuesPagination() {
  const client = createMockLinearClient({
    issues: async (options) => ({
      nodes: [],
      pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
    }),
  });

  const result = await fetchIssues(client, 'user-1', ['Todo'], 50);
  assert.equal(result.truncated, true, 'should be truncated when hasNextPage');
}

async function testFetchProjects() {
  const client = createMockLinearClient();
  const projects = await fetchProjects(client);
  assert.equal(projects.length, 2, 'should return 2 projects');
  assert.equal(projects[0].name, 'Project One', 'should have correct project name');
  assert.equal(projects[1].id, 'proj-2', 'should have correct project id');
}

async function testResolveIssueById() {
  const client = createMockLinearClient({
    issue: (id) => {
      if (id === '12345678-1234-5678-9abc-def012345678') {
        return {
          id: '12345678-1234-5678-9abc-def012345678',
          identifier: 'TEST-100',
          title: 'Found by ID',
          state: Promise.resolve({ id: 's1', name: 'Todo', type: 'unstarted' }),
          team: Promise.resolve({ id: 'team-1', key: 'TEST', name: 'Test Team' }),
          project: Promise.resolve(null),
          assignee: Promise.resolve(null),
        };
      }
      return null;
    },
  });

  const issue = await resolveIssue(client, '12345678-1234-5678-9abc-def012345678');
  assert.equal(issue.identifier, 'TEST-100', 'should find issue by UUID');
  assert.equal(issue.title, 'Found by ID', 'should have correct title');
  assert.equal(issue.state.name, 'Todo', 'should have state');
}

async function testResolveIssueByIdentifier() {
  const client = createMockLinearClient({
    issue: () => null, // Direct lookup fails
    issues: async (options) => {
      if (options.filter?.identifier?.eq === 'TEST-789') {
        return {
          nodes: [{
            id: 'uuid-789',
            identifier: 'TEST-789',
            title: 'Found by Identifier',
            state: Promise.resolve({ id: 's1', name: 'Todo', type: 'unstarted' }),
            team: Promise.resolve({ id: 'team-1', key: 'TEST', name: 'Test Team' }),
            project: Promise.resolve(null),
            assignee: Promise.resolve(null),
          }],
          pageInfo: { hasNextPage: false },
        };
      }
      return { nodes: [], pageInfo: { hasNextPage: false } };
    },
  });

  const issue = await resolveIssue(client, 'TEST-789');
  assert.equal(issue.id, 'uuid-789', 'should find issue by identifier');
}

async function testResolveIssueNotFound() {
  const client = createMockLinearClient({
    issue: () => null,
    issues: async () => ({ nodes: [], pageInfo: { hasNextPage: false } }),
  });

  await assert.rejects(
    () => resolveIssue(client, 'NONEXISTENT'),
    /Issue not found/,
    'should throw for non-existent issue'
  );
}

async function testGetTeamWorkflowStates() {
  const client = createMockLinearClient();
  const states = await getTeamWorkflowStates(client, 'team-1');

  assert.equal(states.length, 3, 'should return 3 states');
  assert.equal(states[0].name, 'Todo', 'first state should be Todo');
  assert.equal(states[1].type, 'started', 'In Progress should be started type');
  assert.equal(states[2].name, 'Done', 'third state should be Done');
}

async function testSetIssueState() {
  let updateInput = null;
  const client = createMockLinearClient({
    issue: (id) => ({
      id,
      identifier: 'TEST-1',
      state: Promise.resolve({ id: 'state-1', name: 'Todo', type: 'unstarted' }),
      team: Promise.resolve({ id: 'team-1', key: 'TEST', name: 'Test Team' }),
      project: Promise.resolve(null),
      assignee: Promise.resolve(null),
      update: async (input) => {
        updateInput = input;
        return {
          success: true,
          issue: {
            id,
            identifier: 'TEST-1',
            state: Promise.resolve({ id: 'state-2', name: 'In Progress', type: 'started' }),
            team: Promise.resolve({ id: 'team-1', key: 'TEST', name: 'Test Team' }),
            project: Promise.resolve(null),
            assignee: Promise.resolve(null),
          },
        };
      },
    }),
  });

  const result = await setIssueState(client, 'issue-1', 'state-2');
  assert.deepEqual(updateInput, { stateId: 'state-2' }, 'should call update with stateId');
  assert.equal(result.state.name, 'In Progress', 'should return updated state');
}

async function testAddIssueComment() {
  const client = createMockLinearClient({
    issue: () => null,
    issues: async (options) => {
      if (options.filter?.identifier?.eq === 'TEST-1') {
        return {
          nodes: [{
            id: 'issue-1',
            identifier: 'TEST-1',
            title: 'Test Issue',
            state: Promise.resolve({ id: 's1', name: 'Todo', type: 'unstarted' }),
            team: Promise.resolve({ id: 'team-1', key: 'TEST', name: 'Test Team' }),
            project: Promise.resolve(null),
            assignee: Promise.resolve(null),
          }],
          pageInfo: { hasNextPage: false },
        };
      }
      return { nodes: [], pageInfo: { hasNextPage: false } };
    },
    createComment: async (input) => {
      assert.equal(input.issueId, 'issue-1', 'should pass issueId');
      assert.equal(input.body, 'Test comment', 'should pass body');
      return { success: true, comment: { id: 'c1', body: input.body } };
    },
  });

  const result = await addIssueComment(client, 'TEST-1', 'Test comment');
  assert.equal(result.comment.id, 'c1', 'should return comment');
}

async function testAddIssueCommentWithParent() {
  const client = createMockLinearClient({
    issue: () => null,
    issues: async (options) => {
      if (options.filter?.identifier?.eq === 'TEST-1') {
        return {
          nodes: [{
            id: 'issue-1',
            identifier: 'TEST-1',
            title: 'Test Issue',
            state: Promise.resolve({ id: 's1', name: 'Todo', type: 'unstarted' }),
            team: Promise.resolve({ id: 'team-1', key: 'TEST', name: 'Test Team' }),
            project: Promise.resolve(null),
            assignee: Promise.resolve(null),
          }],
          pageInfo: { hasNextPage: false },
        };
      }
      return { nodes: [], pageInfo: { hasNextPage: false } };
    },
    createComment: async (input) => {
      assert.equal(input.parentId, 'parent-1', 'should pass parentId for reply');
      return { success: true, comment: { id: 'c2', body: input.body } };
    },
  });

  const result = await addIssueComment(client, 'TEST-1', 'Reply text', 'parent-1');
  assert.equal(result.comment.id, 'c2', 'should return reply comment');
}

async function testAddIssueCommentEmptyBody() {
  const client = createMockLinearClient();

  await assert.rejects(
    () => addIssueComment(client, 'issue-1', ''),
    /Missing required comment body/,
    'should reject empty body'
  );

  await assert.rejects(
    () => addIssueComment(client, 'issue-1', '   '),
    /Missing required comment body/,
    'should reject whitespace-only body'
  );
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
  assert.equal(grouped.size, 2, 'should have 2 projects');
  assert.equal(grouped.get('p1').issueCount, 2, 'p1 should have 2 issues');
  assert.equal(grouped.get('p2').issueCount, 1, 'p2 should have 1 issue');
}

async function testGroupIssuesByProjectEmptyArray() {
  const grouped = groupIssuesByProject([]);
  assert.equal(grouped.size, 0, 'should be empty for empty array');
}

async function testFormatIssueAsMarkdown() {
  const issueData = {
    identifier: 'TEST-123',
    title: 'Test Issue Title',
    description: 'This is the description.',
    url: 'https://linear.app/issue/TEST-123',
    state: { name: 'In Progress', color: '#yellow', type: 'started' },
    team: { id: 't1', key: 'TEST', name: 'Test Team' },
    project: { id: 'p1', name: 'Test Project' },
    assignee: { id: 'u1', name: 'User', displayName: 'Test User' },
    priority: 1,
    labels: [{ id: 'l1', name: 'bug', color: '#red' }],
    children: [],
    comments: [],
    attachments: [],
  };

  const markdown = formatIssueAsMarkdown(issueData);

  assert.ok(markdown.includes('# TEST-123: Test Issue Title'), 'should include title');
  assert.ok(markdown.includes('**State:** In Progress'), 'should include state');
  assert.ok(markdown.includes('**Project:** Test Project'), 'should include project');
  assert.ok(markdown.includes('This is the description.'), 'should include description');
  assert.ok(markdown.includes('**Labels:** bug'), 'should include labels');
  assert.ok(markdown.includes('**Priority:** Urgent'), 'should include priority');
}

async function testFormatIssueAsMarkdownWithComments() {
  const issueData = {
    identifier: 'TEST-456',
    title: 'Issue With Comments',
    state: { name: 'Todo' },
    team: { id: 't1', key: 'TEST', name: 'Team' },
    children: [],
    comments: [
      {
        id: 'c1',
        body: 'First comment',
        createdAt: '2024-01-01T10:00:00Z',
        user: { name: 'Alice', displayName: 'Alice' },
        parent: null,
      },
      {
        id: 'c2',
        body: 'Reply to first',
        createdAt: '2024-01-01T11:00:00Z',
        user: { name: 'Bob', displayName: 'Bob' },
        parent: { id: 'c1' },
      },
    ],
    attachments: [],
  };

  const markdown = formatIssueAsMarkdown(issueData, { includeComments: true });

  assert.ok(markdown.includes('## Comments'), 'should have comments section');
  assert.ok(markdown.includes('First comment'), 'should include first comment');
  assert.ok(markdown.includes('Reply to first'), 'should include reply');
  assert.ok(markdown.includes('@Alice'), 'should include comment author');
  assert.ok(markdown.includes('@Bob'), 'should include reply author');
}

async function testFormatIssueAsMarkdownNoComments() {
  const issueData = {
    identifier: 'TEST-789',
    title: 'Issue Without Comments',
    state: { name: 'Todo' },
    team: { id: 't1', key: 'TEST', name: 'Team' },
    children: [],
    comments: [
      { id: 'c1', body: 'Hidden comment', createdAt: '2024-01-01T00:00:00Z', user: null, parent: null },
    ],
    attachments: [],
  };

  const markdown = formatIssueAsMarkdown(issueData, { includeComments: false });

  assert.ok(!markdown.includes('## Comments'), 'should not have comments section');
  assert.ok(!markdown.includes('Hidden comment'), 'should not include comments');
}

// ===== MAIN =====

async function main() {
  console.log('Running Linear SDK tests...\n');

  await testFetchViewer();
  console.log('✓ testFetchViewer');

  await testFetchIssuesWithAssignee();
  console.log('✓ testFetchIssuesWithAssignee');

  await testFetchIssuesWithoutAssignee();
  console.log('✓ testFetchIssuesWithoutAssignee');

  await testFetchIssuesPagination();
  console.log('✓ testFetchIssuesPagination');

  await testFetchProjects();
  console.log('✓ testFetchProjects');

  await testResolveIssueById();
  console.log('✓ testResolveIssueById');

  await testResolveIssueByIdentifier();
  console.log('✓ testResolveIssueByIdentifier');

  await testResolveIssueNotFound();
  console.log('✓ testResolveIssueNotFound');

  await testGetTeamWorkflowStates();
  console.log('✓ testGetTeamWorkflowStates');

  await testSetIssueState();
  console.log('✓ testSetIssueState');

  await testAddIssueComment();
  console.log('✓ testAddIssueComment');

  await testAddIssueCommentWithParent();
  console.log('✓ testAddIssueCommentWithParent');

  await testAddIssueCommentEmptyBody();
  console.log('✓ testAddIssueCommentEmptyBody');

  await testGroupIssuesByProject();
  console.log('✓ testGroupIssuesByProject');

  await testGroupIssuesByProjectEmptyArray();
  console.log('✓ testGroupIssuesByProjectEmptyArray');

  await testFormatIssueAsMarkdown();
  console.log('✓ testFormatIssueAsMarkdown');

  await testFormatIssueAsMarkdownWithComments();
  console.log('✓ testFormatIssueAsMarkdownWithComments');

  await testFormatIssueAsMarkdownNoComments();
  console.log('✓ testFormatIssueAsMarkdownNoComments');

  console.log('\n✓ test-linear-sdk.js passed (18 tests)');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
