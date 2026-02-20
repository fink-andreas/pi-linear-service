#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RpcSessionManager } from './src/rpc-session-manager.js';

async function main() {
  const root = await mkdtemp(join(tmpdir(), 'pi-linear-rpc-root-'));
  const repoPath = join(root, 'repo-a');
  await mkdir(repoPath, { recursive: true });

  const strictMgr = new RpcSessionManager({
    workspaceRoot: root,
    strictRepoMapping: true,
  });

  const resolved = strictMgr._resolveCwd({ projectId: 'p1', repoPath });
  assert.equal(resolved, repoPath);

  assert.throws(() => {
    strictMgr._resolveCwd({ projectId: 'p1', repoPath: join(root, 'missing-repo') });
  }, /Configured repo path does not exist/);

  assert.throws(() => {
    strictMgr._resolveCwd({ projectId: 'p2' });
  }, /Explicit repo mapping required/);

  const nonStrict = new RpcSessionManager({
    workspaceRoot: root,
    strictRepoMapping: false,
  });
  const fallback = nonStrict._resolveCwd({ projectName: 'unknown' });
  assert.equal(fallback, root);

  console.log('✓ test-rpc-repo-mapping.js passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
