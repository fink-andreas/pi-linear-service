/**
 * Environment configuration and validation
 */

import dotenv from 'dotenv';

// Load .env file if it exists
dotenv.config();

/**
 * Parse integer from environment variable with default
 */
function parseEnvInt(key, defaultValue) {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Invalid value for ${key}: "${value}" must be a number`);
  }
  return parsed;
}

/**
 * Parse boolean from environment variable with default
 */
function parseEnvBool(key, defaultValue) {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return value === 'true' || value === '1';
}

/**
 * Parse comma-separated list from environment variable with default
 */
function parseEnvList(key, defaultValue) {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return value.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

/**
 * Required environment variables
 */
const REQUIRED_VARS = ['LINEAR_API_KEY', 'ASSIGNEE_ID'];

/**
 * Validate and parse environment variables
 * @throws {Error} If required environment variables are missing or invalid
 * @returns {Object} Configuration object with all settings
 */
export function validateEnv() {
  const missing = [];

  for (const varName of REQUIRED_VARS) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
      'Please create a .env file or set these variables before starting the service.'
    );
  }

  return {
    // Required
    linearApiKey: process.env.LINEAR_API_KEY,
    assigneeId: process.env.ASSIGNEE_ID,

    // Optional - Polling
    pollIntervalSec: parseEnvInt('POLL_INTERVAL_SEC', 300),
    tmuxPrefix: process.env.TMUX_PREFIX || 'pi_project_',
    linearOpenStates: parseEnvList('LINEAR_OPEN_STATES', ['Todo', 'In Progress']),
    linearPageLimit: parseEnvInt('LINEAR_PAGE_LIMIT', 100),

    // Optional - Health & recovery
    sessionHealthMode: process.env.SESSION_HEALTH_MODE || 'basic',
    sessionKillOnUnhealthy: parseEnvBool('SESSION_KILL_ON_UNHEALTHY', false),
    sessionRestartCooldownSec: parseEnvInt('SESSION_RESTART_COOLDOWN_SEC', 60),

    // Optional - Logging
    logLevel: process.env.LOG_LEVEL || 'info',
  };
}
