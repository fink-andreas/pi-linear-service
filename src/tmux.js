/**
 * tmux session management
 */

import { spawn } from 'child_process';
import { error as logError, debug, info } from './logger.js';

/**
 * Execute a tmux command
 * @param {Array<string>} args - Arguments to pass to tmux
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
 */
export function execTmux(args) {
  return new Promise((resolve, reject) => {
    debug('Executing tmux command', { args: args.join(' ') });

    const child = spawn('tmux', args);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        logError('tmux command failed', {
          args: args.join(' '),
          exitCode: code,
          stderr: stderr.trim(),
        });
      }
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code });
    });

    child.on('error', (err) => {
      logError('Failed to spawn tmux process', { error: err.message });
      reject(err);
    });
  });
}

/**
 * Check if a tmux session exists
 * @param {string} sessionName - Session name to check
 * @returns {Promise<boolean>} True if session exists
 */
export async function hasSession(sessionName) {
  const result = await execTmux(['has-session', '-t', sessionName]);
  return result.exitCode === 0;
}

/**
 * Create a new detached tmux session
 * @param {string} sessionName - Session name to create
 * @param {string} command - Command to run in the session
 * @returns {Promise<boolean>} True if session was created successfully
 */
export async function createSession(sessionName, command) {
  debug('Creating tmux session', { sessionName, command });
  const result = await execTmux(['new-session', '-d', '-s', sessionName, command]);
  return result.exitCode === 0;
}

/**
 * Ensure a tmux session exists, creating it if missing
 * This is idempotent: multiple calls will not create duplicate sessions
 *
 * @param {string} sessionName - Session name (format: ${TMUX_PREFIX}${projectId})
 * @param {string} projectName - Human-readable project name for the prompt
 * @returns {Promise<{created: boolean, existed: boolean, sessionName: string}>}
 */
export async function ensureSession(sessionName, projectName) {
  // Check if session already exists
  const exists = await hasSession(sessionName);

  if (exists) {
    debug('Session already exists', { sessionName });
    return { created: false, existed: true, sessionName };
  }

  // Session doesn't exist, create it
  // Run pi with a prompt including project name
  const command = `pi --prompt "pi [${projectName}] > "`;

  info('Creating tmux session', { sessionName, projectName, command });

  const success = await createSession(sessionName, command);

  if (success) {
    info('Session created successfully', { sessionName });
    return { created: true, existed: false, sessionName };
  } else {
    logError('Failed to create session', { sessionName });
    return { created: false, existed: false, sessionName };
  }
}

/**
 * Kill a tmux session
 * @param {string} sessionName - Session name to kill
 * @returns {Promise<boolean>} True if session was killed successfully
 */
export async function killSession(sessionName) {
  debug('Killing tmux session', { sessionName });
  const result = await execTmux(['kill-session', '-t', sessionName]);
  return result.exitCode === 0;
}

/**
 * List all tmux sessions
 * @returns {Promise<Array<string>>} Array of session names
 */
export async function listSessions() {
  const result = await execTmux(['list-sessions', '-F', '#{session_name}']);
  if (result.exitCode !== 0) {
    return [];
  }
  return result.stdout.split('\n').filter(name => name.length > 0);
}

/**
 * Get session pane information
 * @param {string} sessionName - Session name
 * @returns {Promise<Array<Object>>} Array of pane info objects
 */
export async function listPanes(sessionName) {
  const format = '#{pane_id}:#{pane_pid}:#{pane_current_command}:#{pane_dead}';
  const result = await execTmux(['list-panes', '-t', sessionName, '-F', format]);
  if (result.exitCode !== 0) {
    return [];
  }
  return result.stdout.split('\n').filter(line => line.length > 0).map(line => {
    const [paneId, panePid, currentCommand, isDead] = line.split(':');
    return {
      paneId,
      panePid: parseInt(panePid, 10),
      currentCommand,
      isDead: isDead === '1',
    };
  });
}

/**
 * Health check result
 * @typedef {Object} HealthCheckResult
 * @property {boolean} healthy - Whether the session is healthy
 * @property {boolean} exists - Whether the session exists
 * @property {number} paneCount - Number of panes in the session
 * @property {boolean} hasDeadPanes - Whether any panes are dead
 * @property {Array<Object>} panes - Pane information
 * @property {string} reason - Reason if unhealthy
 */

/**
 * Perform a health check on a tmux session
 * "Unhealthy" if session exists but:
 * - no panes, OR
 * - pane process has exited (pane_dead === 1)
 *
 * @param {string} sessionName - Session name to check
 * @param {string} healthMode - Health check mode ('none' or 'basic')
 * @returns {Promise<HealthCheckResult>}
 */
export async function checkSessionHealth(sessionName, healthMode) {
  // If health mode is 'none', always return healthy
  if (healthMode === 'none') {
    return {
      healthy: true,
      exists: true,
      paneCount: 0,
      hasDeadPanes: false,
      panes: [],
      reason: null,
    };
  }

  // Check if session exists
  const exists = await hasSession(sessionName);

  if (!exists) {
    return {
      healthy: false,
      exists: false,
      paneCount: 0,
      hasDeadPanes: false,
      panes: [],
      reason: 'Session does not exist',
    };
  }

  // Get pane information
  const panes = await listPanes(sessionName);
  const paneCount = panes.length;
  const hasDeadPanes = panes.some(pane => pane.isDead);

  // Health check: unhealthy if no panes or any pane is dead
  if (paneCount === 0) {
    return {
      healthy: false,
      exists: true,
      paneCount,
      hasDeadPanes,
      panes,
      reason: 'Session has no panes',
    };
  }

  if (hasDeadPanes) {
    const deadPanes = panes.filter(p => p.isDead).map(p => p.paneId);
    return {
      healthy: false,
      exists: true,
      paneCount,
      hasDeadPanes,
      panes,
      reason: `Session has dead pane(s): ${deadPanes.join(', ')}`,
    };
  }

  // Session is healthy
  return {
    healthy: true,
    exists: true,
    paneCount,
    hasDeadPanes,
    panes,
    reason: null,
  };
}

/**
 * Check if a session name matches the ownership pattern
 * Session name format: ${TMUX_PREFIX}${projectId}
 * Example: pi_project_ABC-123 where TMUX_PREFIX=pi_project_
 *
 * @param {string} sessionName - Session name to check
 * @param {string} prefix - Prefix to match (e.g., 'pi_project_')
 * @returns {boolean} True if session name is owned by this service
 */
export function isOwnedSession(sessionName, prefix) {
  // Must start with the prefix
  if (!sessionName.startsWith(prefix)) {
    return false;
  }

  // Extract what comes after the prefix (should be the projectId)
  const suffix = sessionName.substring(prefix.length);

  // Must have something after the prefix (the projectId)
  if (suffix.length === 0) {
    return false;
  }

  // Project IDs typically follow patterns like ABC-123 or PROJ-456
  // Require at least one alphanumeric character or hyphen
  // This is strict enough to avoid killing random sessions
  const projectIdPattern = /^[a-zA-Z0-9-]+$/;
  if (!projectIdPattern.test(suffix)) {
    return false;
  }

  return true;
}

/**
 * Extract projectId from an owned session name
 * @param {string} sessionName - Session name (e.g., 'pi_project_ABC-123')
 * @param {string} prefix - Prefix (e.g., 'pi_project_')
 * @returns {string|null} ProjectId if session is owned, null otherwise
 */
export function extractProjectId(sessionName, prefix) {
  if (!isOwnedSession(sessionName, prefix)) {
    return null;
  }
  return sessionName.substring(prefix.length);
}

/**
 * Get version of tmux
 * @returns {Promise<string|null>} tmux version string or null if not available
 */
export async function getTmuxVersion() {
  try {
    const result = await execTmux(['-V']);
    if (result.exitCode === 0) {
      return result.stdout;
    }
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * In-memory map to track last kill attempt timestamps
 * Key: sessionName, Value: timestamp (milliseconds since epoch)
 */
const lastKillAttempts = new Map();

/**
 * Check if a session is within cooldown period after a kill attempt
 * @param {string} sessionName - Session name to check
 * @param {number} cooldownSec - Cooldown period in seconds
 * @returns {boolean} True if session is within cooldown period
 */
export function isWithinCooldown(sessionName, cooldownSec) {
  const lastAttempt = lastKillAttempts.get(sessionName);
  if (!lastAttempt) {
    return false;
  }
  const elapsedMs = Date.now() - lastAttempt;
  const cooldownMs = cooldownSec * 1000;
  return elapsedMs < cooldownMs;
}

/**
 * Get remaining cooldown time for a session
 * @param {string} sessionName - Session name to check
 * @param {number} cooldownSec - Cooldown period in seconds
 * @returns {number} Remaining cooldown time in seconds (0 if not in cooldown)
 */
export function getRemainingCooldown(sessionName, cooldownSec) {
  const lastAttempt = lastKillAttempts.get(sessionName);
  if (!lastAttempt) {
    return 0;
  }
  const elapsedMs = Date.now() - lastAttempt;
  const cooldownMs = cooldownSec * 1000;
  const remainingMs = cooldownMs - elapsedMs;
  return Math.max(0, Math.ceil(remainingMs / 1000));
}

/**
 * Record a kill attempt for a session
 * @param {string} sessionName - Session name
 */
export function recordKillAttempt(sessionName) {
  lastKillAttempts.set(sessionName, Date.now());
}

/**
 * Clear kill attempt timestamp for a session
 * @param {string} sessionName - Session name
 */
export function clearKillAttempt(sessionName) {
  lastKillAttempts.delete(sessionName);
}

/**
 * Attempt to kill an unhealthy owned session with cooldown protection
 *
 * @param {string} sessionName - Session name to kill
 * @param {string} prefix - Session prefix for ownership check
 * @param {Object} config - Configuration object
 * @returns {Promise<{killed: boolean, reason: string}>}
 */
export async function attemptKillUnhealthySession(sessionName, prefix, config) {
  // Only operate on owned sessions
  if (!isOwnedSession(sessionName, prefix)) {
    return {
      killed: false,
      reason: 'Session not owned by this service',
    };
  }

  // Check if session is unhealthy
  const healthResult = await checkSessionHealth(sessionName, config.sessionHealthMode);
  if (healthResult.healthy) {
    return {
      killed: false,
      reason: 'Session is healthy',
    };
  }

  // Log unhealthy detection
  warn('Unhealthy session detected', {
    sessionName,
    reason: healthResult.reason,
    paneCount: healthResult.paneCount,
    hasDeadPanes: healthResult.hasDeadPanes,
  });

  // Check if kill on unhealthy is enabled
  if (!config.sessionKillOnUnhealthy) {
    return {
      killed: false,
      reason: 'SESSION_KILL_ON_UNHEALTHY is disabled',
    };
  }

  // Check cooldown
  if (isWithinCooldown(sessionName, config.sessionRestartCooldownSec)) {
    const remainingSec = getRemainingCooldown(sessionName, config.sessionRestartCooldownSec);
    info('Kill skipped: session within cooldown period', {
      sessionName,
      remainingSec,
      cooldownSec: config.sessionRestartCooldownSec,
    });
    return {
      killed: false,
      reason: `Within cooldown period (${remainingSec}s remaining)`,
    };
  }

  // Outside cooldown, attempt to kill session
  info('Attempting to kill unhealthy session', {
    sessionName,
    reason: healthResult.reason,
  });

  const killed = await killSession(sessionName);
  if (killed) {
    recordKillAttempt(sessionName);
    info('Unhealthy session killed', {
      sessionName,
    });
    return {
      killed: true,
      reason: 'Session killed successfully',
    };
  } else {
    logError('Failed to kill unhealthy session', {
      sessionName,
    });
    return {
      killed: false,
      reason: 'Failed to kill session',
    };
  }
}
