#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { installService } from '../src/service-cli.js';

function shouldSkip() {
  if (process.env.SKIP_PI_LINEAR_POSTINSTALL === '1') {
    return 'SKIP_PI_LINEAR_POSTINSTALL=1';
  }

  if (process.platform !== 'linux') {
    return `platform ${process.platform} is not supported for systemd auto-setup`;
  }

  return null;
}

async function run() {
  const skipReason = shouldSkip();
  if (skipReason) {
    console.log(`[pi-linear-service] postinstall skipped: ${skipReason}`);
    return;
  }

  const initCwd = process.env.INIT_CWD || process.cwd();
  const envPath = `${initCwd}/.env`;
  const args = ['--working-dir', initCwd];

  if (existsSync(envPath)) {
    args.push('--env-file', envPath);
  }

  try {
    await installService(args);
    console.log('[pi-linear-service] postinstall: systemd user service install attempted successfully');
  } catch (error) {
    console.warn('[pi-linear-service] postinstall: could not auto-configure systemd user service');
    console.warn(`[pi-linear-service] reason: ${error?.message || error}`);
    console.warn('[pi-linear-service] You can run: pi-linear-service service install');
  }
}

run();
