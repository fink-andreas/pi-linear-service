#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function run(command, args, { cwd, env } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf-8',
  });

  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`${command} ${args.join(' ')} failed: ${detail}`);
  }

  return result.stdout.trim();
}

function hasPiCli() {
  const result = spawnSync('pi', ['--version'], { encoding: 'utf-8' });
  return result.status === 0;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf-8'));
}

function normalizeInstalledSource(rawSource, settingsFilePath) {
  if (!rawSource) return rawSource;
  if (rawSource.startsWith('npm:') || rawSource.startsWith('git:')) return rawSource;
  if (rawSource.startsWith('/') || rawSource.startsWith('./') || rawSource.startsWith('../')) {
    return resolve(settingsFilePath ? join(settingsFilePath, '..') : '.', rawSource);
  }
  return rawSource;
}

function containsSource(settingsObj, source, settingsPath) {
  const packages = settingsObj?.packages;
  if (!Array.isArray(packages)) return false;
  return packages.some((entry) => {
    const raw = typeof entry === 'string' ? entry : entry?.source;
    return normalizeInstalledSource(raw, settingsPath) === source;
  });
}

async function main() {
  if (!hasPiCli()) {
    console.log('✓ test-pi-install-smoke.js skipped (pi CLI not available)');
    return;
  }

  const repoRoot = resolve('.');
  const source = repoRoot;

  const tempHome = await mkdtemp(join(tmpdir(), 'pi-linear-smoke-home-'));
  const tempProject = await mkdtemp(join(tmpdir(), 'pi-linear-smoke-project-'));
  await mkdir(join(tempProject, '.pi'), { recursive: true });

  const env = {
    HOME: tempHome,
    USERPROFILE: tempHome,
    XDG_CONFIG_HOME: join(tempHome, '.config'),
  };

  run('pi', ['install', source], { env });
  run('pi', ['list'], { env });

  const globalSettingsPath = join(tempHome, '.pi', 'agent', 'settings.json');
  assert.equal(existsSync(globalSettingsPath), true, 'global settings file should exist after global install');
  const globalSettings = await readJson(globalSettingsPath);
  assert.equal(containsSource(globalSettings, source, globalSettingsPath), true, 'global settings should include installed package source');

  run('pi', ['remove', source], { env });
  const globalAfterRemove = await readJson(globalSettingsPath);
  assert.equal(containsSource(globalAfterRemove, source, globalSettingsPath), false, 'global settings should remove package source after pi remove');

  run('pi', ['install', source, '-l'], { cwd: tempProject, env });
  run('pi', ['list'], { cwd: tempProject, env });

  const localSettingsPath = join(tempProject, '.pi', 'settings.json');
  assert.equal(existsSync(localSettingsPath), true, 'local settings should exist after local install');
  const localSettings = await readJson(localSettingsPath);
  assert.equal(containsSource(localSettings, source, localSettingsPath), true, 'local settings should include installed package source');

  run('pi', ['remove', source, '-l'], { cwd: tempProject, env });
  const localAfterRemove = await readJson(localSettingsPath);
  assert.equal(containsSource(localAfterRemove, source, localSettingsPath), false, 'local settings should remove package source after local remove');

  console.log('✓ test-pi-install-smoke.js passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
