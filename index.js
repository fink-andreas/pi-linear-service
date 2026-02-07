#!/usr/bin/env node

/**
 * pi-linear-service
 * Node.js daemon that polls the Linear GraphQL API and manages per-project tmux sessions
 */

import { validateEnv } from './src/config.js';
import { startPollLoop } from './src/poller.js';
import { printBanner, logConfig, error as logError } from './src/logger.js';

/**
 * Boot sequence:
 * 1. Print startup banner
 * 2. Validate environment variables
 * 3. Start poll loop
 */
async function boot() {
  // Step 1: Print banner
  printBanner();

  try {
    // Step 2: Validate environment
    const config = validateEnv();
    logConfig(config);

    // Step 3: Start poll loop
    await startPollLoop(config);
  } catch (error) {
    logError('Startup error', { error: error.message });
    process.exit(1);
  }
}

// Start the application
boot();
