#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import extension from './extensions/pi-linear-service.js';
import { getSettingsPath } from './src/settings.js';

function createMockPi() {
  const commands = new Map();
  const sentMessages = [];

  return {
    commands,
    sentMessages,
    registerCommand(name, definition) {
      commands.set(name, definition);
    },
    sendMessage(message) {
      sentMessages.push(message);
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
}

async function testSetupAndStatusCommandPaths() {
  await withTempHome(async () => {
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
    await setup(`--project-id ${projectId} --repo-path /tmp/repo --open-states "Todo,In Progress" --no-systemctl`, ctx);

    const settings = JSON.parse(await readFile(getSettingsPath(), 'utf-8'));
    assert.equal(settings.projects[projectId].repo.path, '/tmp/repo');
    assert.deepEqual(settings.projects[projectId].scope.openStates, ['Todo', 'In Progress']);

    await status(`--project-id ${projectId} --no-systemctl`, ctx);
    assert.ok(pi.sentMessages.length > 0, 'status command should send status output message');
    assert.match(pi.sentMessages[0].content, /"configured": true/);

    assert.ok(notifications.some((n) => n.message.includes('Daemon setup succeeded')));
    assert.ok(notifications.some((n) => n.message.includes('Daemon status succeeded')));
  });
}

async function testInteractivePromptFallback() {
  await withTempHome(async () => {
    const pi = createMockPi();
    extension(pi);

    const setup = pi.commands.get('linear-daemon-setup').handler;

    const prompts = [];
    const promptValues = ['proj-interactive', '/tmp/interactive-repo', 'Interactive Project'];
    const ctx = {
      hasUI: true,
      ui: {
        async input(label) {
          prompts.push(label);
          return promptValues.shift();
        },
        notify() {},
      },
    };

    await setup('--no-systemctl', ctx);

    const settings = JSON.parse(await readFile(getSettingsPath(), 'utf-8'));
    assert.ok(settings.projects['proj-interactive']);
    assert.equal(settings.projects['proj-interactive'].repo.path, '/tmp/interactive-repo');
    assert.equal(prompts.length >= 2, true);
  });
}

async function testFailurePathActionableMessage() {
  const pi = createMockPi();
  extension(pi);

  const status = pi.commands.get('linear-daemon-status').handler;

  await assert.rejects(
    () => status('', { hasUI: false }),
    /Missing required argument --project-id/
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

async function main() {
  await testCommandRegistration();
  await testSetupAndStatusCommandPaths();
  await testInteractivePromptFallback();
  await testFailurePathActionableMessage();
  await testLifecycleCommandsNoSystemctl();
  console.log('✓ test-extension-commands.js passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
