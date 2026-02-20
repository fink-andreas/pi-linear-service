#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  buildScopeQueryPlan,
  applyProjectScopeToIssues,
  shouldProcessProject,
} from './src/poller.js';

function testBuildScopePlan() {
  const config = {
    linearOpenStates: ['Todo', 'In Progress'],
    projects: {
      p1: { enabled: true, scope: { assignee: 'me', openStates: ['Todo'] } },
      p2: { enabled: true, scope: { assignee: 'all', openStates: ['Backlog'] } },
      p3: { enabled: false, scope: { assignee: 'me', openStates: ['Done'] } },
    },
  };

  const plan = buildScopeQueryPlan(config, 'viewer-1');
  assert.equal(plan.projectScoped, true);
  assert.equal(plan.enabledProjectCount, 2);
  assert.equal(plan.assigneeId, null, 'assignee=all should query all assignees');
  assert.deepEqual(new Set(plan.openStates), new Set(['Todo', 'Backlog']));
}

function testApplyProjectScopeToIssues() {
  const config = {
    linearOpenStates: ['Todo', 'In Progress'],
    projects: {
      p1: { enabled: true, scope: { assignee: 'me', openStates: ['Todo'] } },
      p2: { enabled: true, scope: { assignee: 'all', openStates: ['Backlog'] } },
    },
  };

  const issues = [
    { id: '1', state: { name: 'Todo' }, assignee: { id: 'viewer-1' }, project: { id: 'p1', name: 'P1' } },
    { id: '2', state: { name: 'Todo' }, assignee: { id: 'other' }, project: { id: 'p1', name: 'P1' } },
    { id: '3', state: { name: 'Backlog' }, assignee: { id: 'other' }, project: { id: 'p2', name: 'P2' } },
    { id: '4', state: { name: 'In Progress' }, assignee: { id: 'viewer-1' }, project: { id: 'p3', name: 'P3' } },
  ];

  const scoped = applyProjectScopeToIssues(issues, config, 'viewer-1');
  assert.deepEqual(scoped.map((i) => i.id), ['1', '3']);
}

function testShouldProcessProject() {
  const config = {
    projectFilter: [],
    projectBlacklist: [],
    projects: {
      p1: { enabled: true },
      p2: { enabled: false },
    },
  };

  assert.equal(shouldProcessProject('p1', 'P1', config), true);
  assert.equal(shouldProcessProject('p2', 'P2', config), false);
  assert.equal(shouldProcessProject('pX', 'PX', config), false);
}

function main() {
  testBuildScopePlan();
  testApplyProjectScopeToIssues();
  testShouldProcessProject();
  console.log('✓ test-poller-scope.js passed');
}

main();
