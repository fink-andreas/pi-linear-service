#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { installService, uninstallService } from './src/service-cli.js';

async function testInstallAndUninstallNoSystemctl() {
  const unitName = `pi-linear-service-test-${Date.now()}.service`;
  const unitPath = join(homedir(), '.config', 'systemd', 'user', unitName);
  const workingDir = process.cwd();
  const envFile = join(workingDir, '.env');

  await installService([
    '--unit-name', unitName,
    '--working-dir', workingDir,
    '--env-file', envFile,
    '--no-systemctl'
  ]);

  assert.equal(existsSync(unitPath), true, 'unit file should exist after install');

  const content = await readFile(unitPath, 'utf-8');
  assert.ok(content.includes(`WorkingDirectory=${workingDir}`));
  assert.ok(content.includes(`EnvironmentFile=-${envFile}`));
  assert.ok(content.includes('ExecStart='));

  await uninstallService(['--unit-name', unitName, '--no-systemctl']);
  assert.equal(existsSync(unitPath), false, 'unit file should be removed after uninstall');
}

async function main() {
  await testInstallAndUninstallNoSystemctl();
  console.log('✓ test-service-cli.js passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
