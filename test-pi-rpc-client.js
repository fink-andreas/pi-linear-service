#!/usr/bin/env node

/**
 * Minimal tests for PiRpcClient NDJSON request/response and event parsing.
 *
 * This test does not spawn `pi`. It stubs child_process.spawn to provide
 * fake stdin/stdout streams.
 */

import { PassThrough } from 'stream';
import assert from 'assert/strict';


function createFakeChild() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  /** @type {any} */
  const child = {
    stdin,
    stdout,
    stderr,
    killed: false,
    exitCode: null,
    pid: 12345,
    on(event, cb) {
      // We only need exit/error listeners in these tests.
      child._listeners = child._listeners || {};
      child._listeners[event] = child._listeners[event] || [];
      child._listeners[event].push(cb);
      return child;
    },
    emit(event, ...args) {
      const ls = child._listeners?.[event] || [];
      for (const cb of ls) cb(...args);
    },
    kill() {
      child.killed = true;
      child.exitCode = 0;
    },
  };

  return child;
}

async function withSpawnStub(fn) {
  const fakeChild = createFakeChild();

  const spawnImpl = () => fakeChild;
  await fn(fakeChild, spawnImpl);
}

async function testResponseCorrelation() {
  await withSpawnStub(async (child, spawnImpl) => {
    const { PiRpcClient } = await import('./src/pi-rpc.js');

    const client = new PiRpcClient('test', { timeoutMs: 200, spawnImpl });

    const p = client.send({ type: 'get_state', id: '1' }, 200);

    // Simulate response from pi
    child.stdout.write(JSON.stringify({ type: 'response', command: 'get_state', success: true, id: '1', data: { isStreaming: false, pendingMessageCount: 0 } }) + '\n');

    const resp = await p;
    assert.equal(resp.success, true);
    assert.equal(resp.command, 'get_state');
  });
}

async function testEventEmission() {
  await withSpawnStub(async (child, spawnImpl) => {
    const { PiRpcClient } = await import('./src/pi-rpc.js');

    const client = new PiRpcClient('test', { timeoutMs: 200, spawnImpl });

    let gotEvent = false;
    client.on('event', (evt) => {
      if (evt.type === 'some_event') gotEvent = true;
    });

    client.spawn();
    child.stdout.write(JSON.stringify({ type: 'some_event', payload: 1 }) + '\n');

    // allow flush
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(gotEvent, true);
  });
}

async function testTimeout() {
  await withSpawnStub(async (child, spawnImpl) => {
    const { PiRpcClient } = await import('./src/pi-rpc.js');

    const client = new PiRpcClient('test', { timeoutMs: 50, spawnImpl });

    let threw = false;
    try {
      await client.send({ type: 'get_state', id: 't' }, 50);
    } catch (e) {
      threw = true;
      assert.ok(String(e).includes('timeout'));
    }

    assert.equal(threw, true);
  });
}

async function main() {
  await testResponseCorrelation();
  await testEventEmission();
  await testTimeout();
  console.log('✓ test-pi-rpc-client.js passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
