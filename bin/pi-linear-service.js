#!/usr/bin/env node

import { runCli } from '../src/cli.js';

runCli().catch((error) => {
  console.error('pi-linear-service CLI error:', error?.message || error);
  process.exit(1);
});
