#!/usr/bin/env node

/**
 * pi-linear-service
 * Node.js daemon that polls the Linear GraphQL API and manages per-project tmux sessions
 */

import { validateEnv } from './src/config.js';
import { startPollLoop } from './src/poller.js';

/**
 * Boot sequence:
 * 1. Validate environment variables
 * 2. Start poll loop
 */
async function boot() {
  console.log('pi-linear-service starting...');

  try {
    // Step 1: Validate environment
    const config = validateEnv();
    console.log('Environment validated successfully');

    // Step 2: Start poll loop
    await startPollLoop(config);
  } catch (error) {
    console.error(`Startup error: ${error.message}`);
    process.exit(1);
  }
}

// Start the application
boot();
