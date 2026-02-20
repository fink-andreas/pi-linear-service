#!/usr/bin/env node

import assert from 'node:assert/strict';
import { loadConfig } from './src/config.js';

const REQUIRED_ENV = {
  LINEAR_API_KEY: 'test-api-key',
  ASSIGNEE_ID: 'test-assignee',
};

async function withEnv(overrides, fn) {
  const keys = Object.keys({ ...REQUIRED_ENV, ...overrides });
  const previous = new Map(keys.map((k) => [k, process.env[k]]));

  try {
    for (const [k, v] of Object.entries({ ...REQUIRED_ENV, ...overrides })) {
      if (v === undefined || v === null) {
        delete process.env[k];
      } else {
        process.env[k] = String(v);
      }
    }
    await fn();
  } finally {
    for (const key of keys) {
      const oldVal = previous.get(key);
      if (oldVal === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = oldVal;
      }
    }
  }
}

async function testInvalidModeFailsFast() {
  await withEnv({ PI_LINEAR_MODE: 'bad-mode' }, async () => {
    await assert.rejects(
      () => loadConfig(),
      /Invalid PI_LINEAR_MODE: "bad-mode"\. Valid options: rpc, legacy/
    );
  });
}

async function testValidRpcMode() {
  await withEnv({ PI_LINEAR_MODE: 'rpc' }, async () => {
    const config = await loadConfig();
    assert.equal(config.mode, 'rpc');
  });
}

async function testValidLegacyMode() {
  await withEnv({ PI_LINEAR_MODE: 'legacy' }, async () => {
    const config = await loadConfig();
    assert.equal(config.mode, 'legacy');
  });
}

async function main() {
  await testInvalidModeFailsFast();
  await testValidRpcMode();
  await testValidLegacyMode();
  console.log('✓ test-config-mode-validation.js passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
