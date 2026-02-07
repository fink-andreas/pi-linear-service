/**
 * Polling loop implementation
 */

import { info, debug } from './logger.js';
import { setLogLevel } from './logger.js';

/**
 * Start the polling loop
 * @param {Object} config - Configuration object
 */
export async function startPollLoop(config) {
  // Set log level from config
  setLogLevel(config.logLevel);

  info('Starting poll loop...', {
    pollIntervalSec: config.pollIntervalSec,
    tmuxPrefix: config.tmuxPrefix,
  });

  // The polling loop will be fully implemented in ISSUE-008
  debug('Poll loop skeleton (full implementation in ISSUE-008)');

  // For now, just indicate ready state and exit
  // In future issues, this will run indefinitely with actual polling logic
  info('Service ready (polling will be implemented in ISSUE-008)');
}
