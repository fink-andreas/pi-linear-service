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
 * Mask sensitive values for logging
 */
function maskSecret(value) {
  if (!value) return value;
  if (value.length <= 8) return '***';
  return value.substring(0, 4) + '...' + value.substring(value.length - 4);
}

/**
 * Print configuration summary to console
 */
export function printConfigSummary(config) {
  console.log('\nConfiguration Summary:');
  console.log('  Required:');
  console.log(`    LINEAR_API_KEY: ${maskSecret(config.linearApiKey)}`);
  console.log(`    ASSIGNEE_ID: ${config.assigneeId}`);
  console.log('  Polling:');
  console.log(`    POLL_INTERVAL_SEC: ${config.pollIntervalSec}s`);
  console.log(`    TMUX_PREFIX: ${config.tmuxPrefix}`);
  console.log(`    LINEAR_OPEN_STATES: ${config.linearOpenStates.join(', ')}`);
  console.log(`    LINEAR_PAGE_LIMIT: ${config.linearPageLimit}`);
  console.log('  Health & Recovery:');
  console.log(`    SESSION_HEALTH_MODE: ${config.sessionHealthMode}`);
  console.log(`    SESSION_KILL_ON_UNHEALTHY: ${config.sessionKillOnUnhealthy}`);
  console.log(`    SESSION_RESTART_COOLDOWN_SEC: ${config.sessionRestartCooldownSec}s`);
  console.log('  Session Command:');
  console.log(`    SESSION_COMMAND_TEMPLATE: ${config.sessionCommandTemplate}`);
  console.log('  Logging:');
  console.log(`    LOG_LEVEL: ${config.logLevel}`);
  console.log('  Dry-run:');
  console.log(`    DRY_RUN: ${config.dryRun ? 'enabled (no tmux actions will be executed)' : 'disabled'}`);
  console.log('');
}

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

  // Validate health mode
  const validHealthModes = ['none', 'basic'];
  const sessionHealthMode = process.env.SESSION_HEALTH_MODE || 'basic';
  if (!validHealthModes.includes(sessionHealthMode)) {
    throw new Error(
      `Invalid SESSION_HEALTH_MODE: "${sessionHealthMode}". ` +
      `Valid options: ${validHealthModes.join(', ')}`
    );
  }

  // Validate poll interval (must be positive)
  const pollIntervalSec = parseEnvInt('POLL_INTERVAL_SEC', 300);
  if (pollIntervalSec <= 0) {
    throw new Error('POLL_INTERVAL_SEC must be a positive number');
  }

  // Validate page limit (must be positive)
  const linearPageLimit = parseEnvInt('LINEAR_PAGE_LIMIT', 100);
  if (linearPageLimit <= 0) {
    throw new Error('LINEAR_PAGE_LIMIT must be a positive number');
  }

  // Validate cooldown (must be non-negative)
  const sessionRestartCooldownSec = parseEnvInt('SESSION_RESTART_COOLDOWN_SEC', 60);
  if (sessionRestartCooldownSec < 0) {
    throw new Error('SESSION_RESTART_COOLDOWN_SEC must be a non-negative number');
  }

  // Validate log level
  const validLogLevels = ['error', 'warn', 'info', 'debug'];
  const logLevel = process.env.LOG_LEVEL || 'info';
  if (!validLogLevels.includes(logLevel)) {
    throw new Error(
      `Invalid LOG_LEVEL: "${logLevel}". ` +
      `Valid options: ${validLogLevels.join(', ')}`
    );
  }

  return {
    // Required
    linearApiKey: process.env.LINEAR_API_KEY,
    assigneeId: process.env.ASSIGNEE_ID,

    // Optional - Polling
    pollIntervalSec,
    tmuxPrefix: process.env.TMUX_PREFIX || 'pi_project_',
    linearOpenStates: parseEnvList('LINEAR_OPEN_STATES', ['Todo', 'In Progress']),
    linearPageLimit,

    // Optional - Health & recovery
    sessionHealthMode,
    sessionKillOnUnhealthy: parseEnvBool('SESSION_KILL_ON_UNHEALTHY', false),
    sessionRestartCooldownSec,

    // Optional - Session command
    sessionCommandTemplate: process.env.SESSION_COMMAND_TEMPLATE ||
      'pi -p "You are working on project: ${projectName} list issues and choose one to work on, if an issue is already in progress - continue"',

    // Optional - Logging
    logLevel: process.env.LOG_LEVEL || 'info',

    // Optional - Dry-run mode
    dryRun: parseEnvBool('DRY_RUN', false),
  };
}
