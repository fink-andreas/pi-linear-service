/**
 * Session health checking
 */

import { debug, warn } from './logger.js';
import { listPanes } from './tmux.js';

/**
 * Check if a session is healthy
 * @param {string} sessionName - Session name to check
 * @param {string} mode - Health check mode ('none' or 'basic')
 * @returns {Promise<Object>} Object with isHealthy boolean and reason if unhealthy
 */
export async function checkSessionHealth(sessionName, mode = 'basic') {
  if (mode === 'none') {
    debug('Health check disabled for session', { sessionName });
    return { isHealthy: true, reason: null };
  }

  if (mode === 'basic') {
    return await basicHealthCheck(sessionName);
  }

  warn(`Unknown health mode: ${mode}, assuming healthy`, { sessionName });
  return { isHealthy: true, reason: null };
}

/**
 * Basic health check: session is unhealthy if panes have exited
 * @param {string} sessionName - Session name to check
 * @returns {Promise<Object>} Object with isHealthy boolean and reason if unhealthy
 */
async function basicHealthCheck(sessionName) {
  debug('Performing basic health check', { sessionName });

  const panes = await listPanes(sessionName);

  // No panes means session is unhealthy
  if (panes.length === 0) {
    return {
      isHealthy: false,
      reason: 'no panes',
    };
  }

  // Check if any pane is dead
  const deadPanes = panes.filter(pane => pane.isDead);
  if (deadPanes.length > 0) {
    return {
      isHealthy: false,
      reason: 'dead pane(s)',
      details: {
        deadPaneCount: deadPanes.length,
        totalPanes: panes.length,
      },
    };
  }

  return {
    isHealthy: true,
    reason: null,
  };
}

/**
 * Check if a session should be killed (gated by cooldown)
 * @param {string} sessionName - Session name
 * @param {boolean} killOnUnhealthy - Config setting
 * @param {number} cooldownSec - Cooldown period in seconds
 * @param {Map} lastKillAttempts - Map of sessionName -> timestamp
 * @returns {Promise<boolean>} True if session should be killed
 */
export async function shouldKillSession(sessionName, killOnUnhealthy, cooldownSec, lastKillAttempts) {
  if (!killOnUnhealthy) {
    debug('Kill on unhealthy disabled', { sessionName });
    return false;
  }

  const lastAttempt = lastKillAttempts.get(sessionName);
  const now = Date.now();

  if (lastAttempt) {
    const elapsed = (now - lastAttempt) / 1000;
    if (elapsed < cooldownSec) {
      debug('Kill blocked by cooldown', {
        sessionName,
        elapsed: elapsed.toFixed(1),
        cooldownSec,
      });
      return false;
    }
  }

  return true;
}

/**
 * Record a kill attempt for a session
 * @param {string} sessionName - Session name
 * @param {Map} lastKillAttempts - Map of sessionName -> timestamp
 */
export function recordKillAttempt(sessionName, lastKillAttempts) {
  lastKillAttempts.set(sessionName, Date.now());
  debug('Recorded kill attempt', { sessionName });
}
