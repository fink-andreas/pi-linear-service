#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

async function main() {
  const packageJsonPath = resolve('package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'));

  assert.ok(packageJson.pi, 'package.json must contain a pi manifest');
  assert.ok(Array.isArray(packageJson.pi.extensions), 'pi.extensions must be an array');
  assert.ok(packageJson.pi.extensions.includes('./extensions'), 'pi.extensions must include ./extensions');

  assert.ok(Array.isArray(packageJson.files), 'package.json files must be an array');
  assert.ok(packageJson.files.includes('extensions/'), 'published files must include extensions/');

  assert.ok(Array.isArray(packageJson.keywords), 'package.json keywords must be an array');
  assert.ok(packageJson.keywords.includes('pi-package'), 'package.json keywords must include pi-package');

  const extensionPath = resolve('extensions', 'pi-linear-service.js');
  assert.ok(existsSync(extensionPath), 'extension entrypoint file must exist');

  const extensionSource = await readFile(extensionPath, 'utf-8');
  assert.match(extensionSource, /registerCommand\('linear-daemon-setup'/, 'extension must register setup command');
  assert.match(extensionSource, /registerCommand\('linear-daemon-reconfigure'/, 'extension must register reconfigure command');
  assert.match(extensionSource, /registerCommand\('linear-daemon-status'/, 'extension must register status command');
  assert.match(extensionSource, /registerTool\({[\s\S]*name: 'linear_issue_start'/, 'extension must register linear issue start tool');
  assert.match(extensionSource, /name: 'linear_issue_comment_add'/, 'extension must register linear issue comment add tool');
  assert.match(extensionSource, /name: 'linear_issue_update'/, 'extension must register linear issue update tool');

  console.log('✓ test-package-manifest.js passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
