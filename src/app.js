/**
 * Application bootstrapping for pi-linear-service
 */

import { loadConfig, printConfigSummary } from './config.js';
import { startPollLoop } from './poller.js';
import { printBanner, error as logError } from './logger.js';

export async function boot() {
  printBanner();

  try {
    const config = await loadConfig();
    printConfigSummary(config);
    await startPollLoop(config);
  } catch (error) {
    logError('Startup error', { error: error.message });
    process.exit(1);
  }
}
