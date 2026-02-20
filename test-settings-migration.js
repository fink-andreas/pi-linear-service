#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadSettings, validateSettings } from './src/settings.js';

async function withTempHome(fn) {
  const tempHome = await mkdtemp(join(tmpdir(), 'pi-linear-settings-test-home-'));
  const prevHome = process.env.HOME;
  process.env.HOME = tempHome;
  try {
    await fn(tempHome);
  } finally {
    process.env.HOME = prevHome;
  }
}

async function testMigrationFromLegacyOverrides() {
  await withTempHome(async (home) => {
    const settingsDir = join(home, '.pi', 'agent', 'extensions', 'pi-linear-service');
    await mkdir(settingsDir, { recursive: true });

    const legacyLike = {
      mode: 'rpc',
      rpc: {
        workspaceRoot: '/tmp/workspace',
        projectDirOverrides: {
          'project-1': 'repo-a',
        },
      },
    };

    await writeFile(join(settingsDir, 'settings.json'), JSON.stringify(legacyLike, null, 2));

    const loaded = await loadSettings();
    assert.equal(loaded.schemaVersion, 2);
    assert.ok(loaded.projects['project-1']);
    assert.equal(loaded.projects['project-1'].repo.path, '/tmp/workspace/repo-a');
    assert.equal(loaded.projects['project-1'].enabled, false);
  });
}

function testProjectValidationRequiresRepoPath() {
  const invalid = {
    schemaVersion: 2,
    mode: 'rpc',
    projects: {
      p1: {
        enabled: true,
        scope: { assignee: 'me', openStates: ['Todo'] },
        repo: {},
      },
    },
    rpc: {},
    legacy: { sessionManager: { type: 'tmux', tmux: {} } },
  };

  const result = validateSettings(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('repo.path')));
}

async function main() {
  await testMigrationFromLegacyOverrides();
  testProjectValidationRequiresRepoPath();
  console.log('✓ test-settings-migration.js passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
