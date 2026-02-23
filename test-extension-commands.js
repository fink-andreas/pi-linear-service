#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import extension from './extensions/pi-linear-service.js';
import { getSettingsPath } from './src/settings.js';
import { setTestClientFactory, resetTestClientFactory } from './src/linear-client.js';

function createMockPi(execImpl = null) {
  const commands = new Map();
  const tools = new Map();
  const sentMessages = [];

  return {
    commands,
    tools,
    sentMessages,
    registerCommand(name, definition) {
      commands.set(name, definition);
    },
    registerTool(definition) {
      tools.set(definition.name, definition);
    },
    sendMessage(message) {
      sentMessages.push(message);
    },
    async exec(command, args) {
      if (!execImpl) return { code: 0, stdout: '', stderr: '' };
      return execImpl(command, args);
    },
  };
}

async function withTempHome(fn) {
  const tempHome = await mkdtemp(join(tmpdir(), 'pi-linear-extension-test-home-'));
  const prevHome = process.env.HOME;
  process.env.HOME = tempHome;
  try {
    await fn(tempHome);
  } finally {
    process.env.HOME = prevHome;
  }
}

/**
 * Create a mock Linear SDK client for testing
 */
function createMockSdkClient(overrides = {}) {
  const mockIssue = (id) => ({
    id,
    identifier: `TEST-${id.slice(0, 4)}`,
    title: `Test Issue ${id}`,
    state: Promise.resolve({ id: 'state-1', name: 'Todo', type: 'unstarted' }),
    team: Promise.resolve({ id: 'team-1', key: 'TEST', name: 'Test Team' }),
    project: Promise.resolve(null),
    assignee: Promise.resolve(null),
    update: async (input) => ({
      success: true,
      issue: {
        id,
        identifier: `TEST-${id.slice(0, 4)}`,
        title: input.title || `Test Issue ${id}`,
        priority: input.priority,
        state: Promise.resolve(input.stateId ? { id: input.stateId, name: 'Updated', type: 'started' } : { id: 'state-1', name: 'Todo', type: 'unstarted' }),
        team: Promise.resolve({ id: 'team-1', key: 'TEST', name: 'Test Team' }),
        project: Promise.resolve(null),
        assignee: Promise.resolve(null),
      },
    }),
  });

  const base = {
    viewer: Promise.resolve({ id: 'user-1', name: 'Test User', displayName: 'Test User' }),
    issues: async () => ({ nodes: [], pageInfo: { hasNextPage: false } }),
    issue: (id) => mockIssue(id),
    projects: async () => ({ nodes: [] }),
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
    createComment: async (input) => ({
      success: true,
      comment: { id: 'comment-1', body: input.body },
    }),
    ...overrides,
  };

  return base;
}

/**
 * Run a test with a mock Linear SDK client
 */
async function withMockClient(mockClient, fn) {
  setTestClientFactory(() => mockClient);
  try {
    await fn();
  } finally {
    resetTestClientFactory();
  }
}

async function withMockFetch(mockFetch, fn) {
  const prevFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = prevFetch;
  }
}

async function testCommandRegistration() {
  const pi = createMockPi();
  extension(pi);

  const expected = [
    'linear-daemon-setup',
    'linear-daemon-reconfigure',
    'linear-daemon-status',
    'linear-daemon-disable',
    'linear-daemon-start',
    'linear-daemon-stop',
    'linear-daemon-restart',
    'linear-daemon-help',
  ];

  for (const command of expected) {
    assert.ok(pi.commands.has(command), `Expected command to be registered: ${command}`);
  }

  const expectedTools = [
    'linear_issue_start',
    'linear_issue_comment_add',
    'linear_issue_update',
  ];

  for (const tool of expectedTools) {
    assert.ok(pi.tools.has(tool), `Expected tool to be registered: ${tool}`);
  }
}

async function testSetupAndStatusCommandPaths() {
  await withTempHome(async () => {
    const repoPath = await mkdtemp(join(tmpdir(), 'pi-linear-ext-repo-'));

    const pi = createMockPi();
    extension(pi);

    const setup = pi.commands.get('linear-daemon-setup').handler;
    const status = pi.commands.get('linear-daemon-status').handler;

    const notifications = [];
    const ctx = {
      hasUI: true,
      ui: {
        notify(message, level) {
          notifications.push({ message, level });
        },
      },
    };

    const projectId = 'proj-123';
    await setup(`--id ${projectId} --repo-path ${repoPath} --open-states "Todo,In Progress" --no-systemctl`, ctx);

    const settings = JSON.parse(await readFile(getSettingsPath(), 'utf-8'));
    assert.equal(settings.projects[projectId].repo.path, repoPath);
    assert.deepEqual(settings.projects[projectId].scope.openStates, ['Todo', 'In Progress']);

    await status(`--id ${projectId} --no-systemctl`, ctx);
    assert.ok(pi.sentMessages.length > 0, 'status command should send status output message');
    assert.match(pi.sentMessages[0].content, /"configured": true/);

    assert.ok(notifications.some((n) => n.message.includes('Setup complete')));
    assert.ok(notifications.some((n) => n.message.includes('Status retrieved')));
  });
}

async function testStatusShowsAllProjects() {
  await withTempHome(async () => {
    const repoA = await mkdtemp(join(tmpdir(), 'pi-linear-ext-status-a-'));
    const repoB = await mkdtemp(join(tmpdir(), 'pi-linear-ext-status-b-'));

    const pi = createMockPi();
    extension(pi);

    const setup = pi.commands.get('linear-daemon-setup').handler;
    const status = pi.commands.get('linear-daemon-status').handler;

    const ctx = { hasUI: false };

    // Setup two projects
    await setup(`--id proj-a --repo-path ${repoA} --open-states "Todo,In Progress" --no-systemctl`, ctx);
    await setup(`--id proj-b --repo-path ${repoB} --open-states "Todo,In Progress" --no-systemctl`, ctx);

    // Status without project should show all
    pi.sentMessages.length = 0;  // Clear array instead of replacing
    await status('--no-systemctl', ctx);

    assert.ok(pi.sentMessages.length > 0, 'status should send output');
    const content = pi.sentMessages[0].content;
    assert.match(content, /"projectCount": 2/);
    assert.match(content, /"projectId": "proj-a"/);
    assert.match(content, /"projectId": "proj-b"/);
  });
}

async function testInteractiveSetupFlow() {
  await withTempHome(async () => {
    const repoPath = await mkdtemp(join(tmpdir(), 'pi-linear-ext-interactive-repo-'));

    const pi = createMockPi();
    extension(pi);

    const setup = pi.commands.get('linear-daemon-setup').handler;

    const prompts = [];
    const promptValues = ['proj-interactive', repoPath, 'Todo,In Progress'];
    const ctx = {
      hasUI: true,
      ui: {
        async input(label) {
          prompts.push(label);
          return promptValues.shift();
        },
        async select() {
          return 'all';
        },
        async confirm() {
          return false;
        },
        notify() {},
      },
    };

    await setup('--no-systemctl', ctx);

    const settings = JSON.parse(await readFile(getSettingsPath(), 'utf-8'));
    assert.ok(settings.projects['proj-interactive']);
    assert.equal(settings.projects['proj-interactive'].repo.path, repoPath);
    assert.equal(settings.projects['proj-interactive'].scope.assignee, 'all');
    assert.equal(prompts.length >= 3, true);
  });
}

async function testInteractiveReconfigureLoadsDefaultsAndUpdates() {
  await withTempHome(async () => {
    const repoA = await mkdtemp(join(tmpdir(), 'pi-linear-ext-reconf-a-'));
    const repoB = await mkdtemp(join(tmpdir(), 'pi-linear-ext-reconf-b-'));

    const pi = createMockPi();
    extension(pi);

    const setup = pi.commands.get('linear-daemon-setup').handler;
    const reconfigure = pi.commands.get('linear-daemon-reconfigure').handler;

    await setup(`--id proj-r --repo-path ${repoA} --open-states "Todo,In Progress" --no-systemctl`, { hasUI: false });

    const placeholders = [];
    const ctx = {
      hasUI: true,
      ui: {
        async input(label, placeholder) {
          placeholders.push({ label, placeholder });
          if (label.includes('project name') || label.includes('project ID')) return 'proj-r';
          if (label.includes('Project name')) return 'Project R';
          if (label.includes('Repository')) return repoB;
          if (label.includes('Open states')) return 'Backlog,In Progress';
          return '';
        },
        async select() {
          return 'me';
        },
        notify() {},
      },
    };

    await reconfigure('--no-systemctl', ctx);

    const settings = JSON.parse(await readFile(getSettingsPath(), 'utf-8'));
    assert.equal(settings.projects['proj-r'].repo.path, repoB);
    assert.deepEqual(settings.projects['proj-r'].scope.openStates, ['Backlog', 'In Progress']);

    const repoPrompt = placeholders.find((p) => p.label.includes('Repository absolute path'));
    assert.equal(repoPrompt.placeholder, repoA);
  });
}

async function testValidationFailureForMissingRepoPath() {
  const pi = createMockPi();
  extension(pi);

  const setup = pi.commands.get('linear-daemon-setup').handler;

  await assert.rejects(
    () => setup('--id test-project --repo-path /does/not/exist --no-systemctl', { hasUI: false }),
    /Configured repo path does not exist/
  );
}

async function testFailurePathActionableMessage() {
  const pi = createMockPi();
  extension(pi);

  const disable = pi.commands.get('linear-daemon-disable').handler;

  await assert.rejects(
    () => disable('', { hasUI: false }),
    /Missing required argument --id or --name/
  );
}

async function testLifecycleCommandsNoSystemctl() {
  const pi = createMockPi();
  extension(pi);

  const start = pi.commands.get('linear-daemon-start').handler;
  const stop = pi.commands.get('linear-daemon-stop').handler;
  const restart = pi.commands.get('linear-daemon-restart').handler;

  const ctx = { hasUI: false };

  await start('--no-systemctl', ctx);
  await stop('--no-systemctl', ctx);
  await restart('--no-systemctl', ctx);
}

async function testLinearToolRequiresApiKey() {
  const prev = process.env.LINEAR_API_KEY;
  delete process.env.LINEAR_API_KEY;

  try {
    const pi = createMockPi();
    extension(pi);
    const tool = pi.tools.get('linear_issue_start');
    await assert.rejects(() => tool.execute('call-1', { issue: 'ABC-123' }), /LINEAR_API_KEY not set/);
  } finally {
    process.env.LINEAR_API_KEY = prev;
  }
}

async function testLinearIssueUpdateToolSuccess() {
  const prev = process.env.LINEAR_API_KEY;
  process.env.LINEAR_API_KEY = 'lin_test';

  try {
    const pi = createMockPi();
    extension(pi);

    const tool = pi.tools.get('linear_issue_update');

    const issueObj = {
      id: 'issue-1',
      identifier: 'ABC-123',
      title: 'Before',
      state: Promise.resolve({ id: 'state-1', name: 'Todo', type: 'unstarted' }),
      team: Promise.resolve({ id: 'team-1', key: 'ABC', name: 'Team ABC' }),
      project: Promise.resolve(null),
      assignee: Promise.resolve(null),
      update: async (input) => ({
        success: true,
        issue: {
          id: 'issue-1',
          identifier: 'ABC-123',
          title: input.title || 'Before',
          priority: input.priority,
          state: Promise.resolve({ id: 'state-1', name: 'Todo', type: 'unstarted' }),
          team: Promise.resolve({ id: 'team-1', key: 'ABC', name: 'Team ABC' }),
          project: Promise.resolve(null),
          assignee: Promise.resolve(null),
        },
      }),
    };

    const mockClient = createMockSdkClient({
      issues: async (options) => {
        if (options?.filter?.identifier?.eq === 'ABC-123') {
          return { nodes: [issueObj], pageInfo: { hasNextPage: false } };
        }
        return { nodes: [], pageInfo: { hasNextPage: false } };
      },
      issue: (id) => issueObj,
    });

    await withMockClient(mockClient, async () => {
      const result = await tool.execute('call-2', {
        issue: 'ABC-123',
        title: 'After',
        priority: 2,
      });

      assert.match(result.content[0].text, /Updated issue ABC-123/);
      assert.deepEqual(result.details.changed.sort(), ['priority', 'title']);
    });
  } finally {
    process.env.LINEAR_API_KEY = prev;
  }
}

async function testLinearIssueStartToolGitFlow() {
  const prev = process.env.LINEAR_API_KEY;
  process.env.LINEAR_API_KEY = 'lin_test';

  const gitCalls = [];
  const pi = createMockPi(async (command, args) => {
    gitCalls.push([command, ...args]);

    if (command !== 'git') return { code: 1, stdout: '', stderr: 'unsupported' };

    if (args[0] === 'rev-parse' && args[1] === '--verify') {
      return { code: 1, stdout: '', stderr: 'not found' };
    }

    if (args[0] === 'checkout' && args[1] === '-b') {
      return { code: 0, stdout: '', stderr: '' };
    }

    return { code: 0, stdout: '', stderr: '' };
  });

  extension(pi);
  const tool = pi.tools.get('linear_issue_start');

  try {
    const issueObj = {
      id: 'issue-2',
      identifier: 'ABC-456',
      title: 'Start me',
      branchName: 'feature/abc-456-start-me',
      state: Promise.resolve({ id: 'todo', name: 'Todo', type: 'unstarted' }),
      team: Promise.resolve({ id: 'team-1', key: 'ABC', name: 'Team ABC' }),
      project: Promise.resolve(null),
      assignee: Promise.resolve(null),
      update: async (input) => ({
        success: true,
        issue: {
          id: 'issue-2',
          identifier: 'ABC-456',
          title: 'Start me',
          priority: 0,
          state: Promise.resolve({ id: 'prog', name: 'In Progress', type: 'started' }),
          team: Promise.resolve({ id: 'team-1', key: 'ABC', name: 'Team ABC' }),
          project: Promise.resolve(null),
          assignee: Promise.resolve(null),
        },
      }),
    };

    const mockClient = createMockSdkClient({
      issues: async (options) => {
        if (options?.filter?.identifier?.eq === 'ABC-456') {
          return { nodes: [issueObj], pageInfo: { hasNextPage: false } };
        }
        return { nodes: [], pageInfo: { hasNextPage: false } };
      },
      issue: (id) => issueObj,
      team: (id) => Promise.resolve({
        id: 'team-1',
        key: 'ABC',
        name: 'Team ABC',
        states: async () => ({
          nodes: [
            { id: 'todo', name: 'Todo', type: 'unstarted' },
            { id: 'prog', name: 'In Progress', type: 'started' },
          ],
        }),
      }),
    });

    await withMockClient(mockClient, async () => {
      const result = await tool.execute('call-3', { issue: 'ABC-456' });
      assert.equal(result.content[0].text, 'Started issue ABC-456 (start me)');
      assert.ok(gitCalls.some((args) => args.join(' ').includes('checkout -b feature/abc-456-start-me HEAD')));
    });
  } finally {
    process.env.LINEAR_API_KEY = prev;
  }
}

async function main() {
  await testCommandRegistration();
  await testSetupAndStatusCommandPaths();
  await testStatusShowsAllProjects();
  await testInteractiveSetupFlow();
  await testInteractiveReconfigureLoadsDefaultsAndUpdates();
  await testValidationFailureForMissingRepoPath();
  await testFailurePathActionableMessage();
  await testLifecycleCommandsNoSystemctl();
  await testLinearToolRequiresApiKey();
  await testLinearIssueUpdateToolSuccess();
  await testLinearIssueStartToolGitFlow();
  console.log('✓ test-extension-commands.js passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
