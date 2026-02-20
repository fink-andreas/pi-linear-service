#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  setupProjectDaemon,
  reconfigureProjectDaemon,
  disableProjectDaemon,
} from './src/daemon-control.js';
import { getSettingsPath } from './src/settings.js';

async function withTempHome(fn) {
  const tempHome = await mkdtemp(join(tmpdir(), 'pi-linear-service-test-home-'));
  const prevHome = process.env.HOME;
  process.env.HOME = tempHome;
  try {
    await fn(tempHome);
  } finally {
    process.env.HOME = prevHome;
  }
}

async function testSetupReconfigureDisable() {
  await withTempHome(async () => {
    const projectId = '97ec7cae-e252-493d-94d3-6910aa28cacf';

    await setupProjectDaemon([
      '--project-id', projectId,
      '--project-name', 'pi-linear-test-repo',
      '--repo-path', '/tmp/pi-linear-test-repo',
      '--open-states', 'Todo,In Progress',
      '--no-systemctl',
    ]);

    let content = await readFile(getSettingsPath(), 'utf-8');
    let settings = JSON.parse(content);

    assert.equal(settings.schemaVersion, 2);
    assert.ok(settings.projects?.[projectId]);
    assert.equal(settings.projects[projectId].repo.path, '/tmp/pi-linear-test-repo');
    assert.deepEqual(settings.projects[projectId].scope.openStates, ['Todo', 'In Progress']);
    assert.equal(settings.projects[projectId].enabled, true);

    await reconfigureProjectDaemon([
      '--project-id', projectId,
      '--repo-path', '/tmp/pi-linear-test-repo-renamed',
      '--open-states', 'Backlog,In Progress',
      '--assignee', 'all',
      '--no-systemctl',
    ]);

    content = await readFile(getSettingsPath(), 'utf-8');
    settings = JSON.parse(content);
    assert.equal(settings.projects[projectId].repo.path, '/tmp/pi-linear-test-repo-renamed');
    assert.deepEqual(settings.projects[projectId].scope.openStates, ['Backlog', 'In Progress']);
    assert.equal(settings.projects[projectId].scope.assignee, 'all');

    await disableProjectDaemon([
      '--project-id', projectId,
      '--no-systemctl',
    ]);

    content = await readFile(getSettingsPath(), 'utf-8');
    settings = JSON.parse(content);
    assert.equal(settings.projects[projectId].enabled, false);
  });
}

async function main() {
  await testSetupReconfigureDisable();
  console.log('✓ test-daemon-control.js passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
