#!/usr/bin/env node

import assert from 'node:assert/strict';
import { executeQuery } from './src/linear.js';

async function withMockFetch(mockFetch, fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    await fn();
  } finally {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    } else {
      delete globalThis.fetch;
    }
  }
}

async function testTimeoutFailurePath() {
  await withMockFetch((_url, options) => {
    return new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  }, async () => {
    await assert.rejects(
      () => executeQuery('test', 'query { viewer { id } }', {}, { operationName: 'TimeoutPath', timeoutMs: 10 }),
      /Linear API request timed out after 10ms/
    );
  });
}

async function testNetworkFailurePath() {
  await withMockFetch(async () => {
    throw new Error('ECONNRESET');
  }, async () => {
    await assert.rejects(
      () => executeQuery('test', 'query { viewer { id } }', {}, { operationName: 'NetworkPath', timeoutMs: 1000 }),
      /Linear API request failed: ECONNRESET/
    );
  });
}

async function main() {
  await testTimeoutFailurePath();
  await testNetworkFailurePath();
  console.log('✓ test-linear-execute-query.js passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
