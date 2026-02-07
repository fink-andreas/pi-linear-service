/**
 * Session Manager Abstract Interface
 *
 * All session manager implementations must implement these methods.
 * This provides a common interface for different session management backends
 * such as tmux sessions or generic processes.
 */

/**
 * Abstract SessionManager class
 * Implementations: TmuxSessionManager, ProcessSessionManager
 */
export class SessionManager {
  /**
   * Check if a session with the given name exists
   * @param {string} sessionName - Session name to check
   * @returns {Promise<boolean>} True if session exists
   */
  async hasSession(sessionName) {
    throw new Error('hasSession() must be implemented by subclass');
  }

  /**
   * Create a new session with the given name and command
   * @param {string} sessionName - Session name to create
   * @param {string} command - Command to run in the session
   * @param {boolean} dryRun - If true, log action without executing
   * @returns {Promise<boolean>} True if session created successfully (or would be in dry-run)
   */
  async createSession(sessionName, command, dryRun = false) {
    throw new Error('createSession() must be implemented by subclass');
  }

  /**
   * Kill a session with the given name
   * @param {string} sessionName - Session name to kill
   * @param {boolean} dryRun - If true, log action without executing
   * @returns {Promise<boolean>} True if session killed successfully (or would be in dry-run)
   */
  async killSession(sessionName, dryRun = false) {
    throw new Error('killSession() must be implemented by subclass');
  }

  /**
   * List all session names
   * @returns {Promise<Array<string>>} Array of session names
   */
  async listSessions() {
    throw new Error('listSessions() must be implemented by subclass');
  }

  /**
   * Perform a health check on a session
   * A session is considered unhealthy if:
   * - It doesn't exist
   * - It has no active processes
   * - Its main process has died
   *
   * @param {string} sessionName - Session name to check
   * @param {string} healthMode - Health check mode ('none' or 'basic')
   * @returns {Promise<HealthCheckResult>} Health check result
   */
  async checkSessionHealth(sessionName, healthMode) {
    throw new Error('checkSessionHealth() must be implemented by subclass');
  }

  /**
   * Check if a session name matches the ownership pattern
   * Session name format: ${PREFIX}${projectId}
   * Example: pi_project_ABC-123 where PREFIX=pi_project_
   *
   * @param {string} sessionName - Session name to check
   * @param {string} prefix - Prefix to match (e.g., 'pi_project_')
   * @returns {boolean} True if session is owned by this service
   */
  isOwnedSession(sessionName, prefix) {
    throw new Error('isOwnedSession() must be implemented by subclass');
  }
}

/**
 * Health check result structure
 * @typedef {Object} HealthCheckResult
 * @property {boolean} healthy - Whether the session is healthy
 * @property {boolean} exists - Whether the session exists
 * @property {number} paneCount - Number of panes/processes (for tmux) or 1 (for process)
 * @property {boolean} hasDeadPanes - Whether any panes/processes are dead
 * @property {Array<Object>} panes - Pane/process information
 * @property {string} reason - Reason if unhealthy
 */

/**
 * Attempt to kill an unhealthy owned session with cooldown protection
 * This is a utility method that uses other SessionManager methods
 *
 * @param {string} sessionName - Session name to kill
 * @param {string} prefix - Session prefix for ownership check
 * @param {Object} config - Configuration object with healthMode, sessionKillOnUnhealthy, sessionRestartCooldownSec
 * @param {boolean} dryRun - If true, log action without executing
 * @returns {Promise<{killed: boolean, reason: string}>}
 */
export async function attemptKillUnhealthySession(sessionName, prefix, config, sessionManager, dryRun = false) {
  // Only operate on owned sessions
  if (!sessionManager.isOwnedSession(sessionName, prefix)) {
    return {
      killed: false,
      reason: 'Session not owned by this service',
    };
  }

  // Check if session is unhealthy
  const healthResult = await sessionManager.checkSessionHealth(sessionName, config.sessionHealthMode);
  if (healthResult.healthy) {
    return {
      killed: false,
      reason: 'Session is healthy',
    };
  }

  // Log unhealthy detection
  const { warn } = await import('./logger.js');
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
  if (sessionManager.isWithinCooldown && sessionManager.isWithinCooldown(sessionName, config.sessionRestartCooldownSec)) {
    const remainingSec = sessionManager.getRemainingCooldown(sessionName, config.sessionRestartCooldownSec);
    const { info } = await import('./logger.js');
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
  const { info } = await import('./logger.js');
  info('Attempting to kill unhealthy session', {
    sessionName,
    reason: healthResult.reason,
  });

  const killed = await sessionManager.killSession(sessionName, dryRun);
  if (killed) {
    // Only record kill attempt if not in dry-run mode and session manager supports cooldown
    if (!dryRun && sessionManager.recordKillAttempt) {
      sessionManager.recordKillAttempt(sessionName);
    }
    info('Unhealthy session killed', {
      sessionName,
    });
    return {
      killed: true,
      reason: dryRun ? 'Session would be killed (dry-run)' : 'Session killed successfully',
    };
  } else {
    const { error: logError } = await import('./logger.js');
    logError('Failed to kill unhealthy session', {
      sessionName,
    });
    return {
      killed: false,
      reason: 'Failed to kill session',
    };
  }
}

/**
 * Factory function to create the appropriate session manager
 * @param {Object} settings - Settings object containing sessionManager configuration
 * @returns {SessionManager} Appropriate session manager instance
 */
export async function createSessionManager(settings) {
  const type = settings?.sessionManager?.type || 'tmux';

  switch (type) {
    case 'tmux': {
      const { TmuxSessionManager } = await import('./tmux-manager.js');
      return new TmuxSessionManager(settings?.sessionManager?.tmux || {});
    }
    case 'process': {
      const { ProcessSessionManager } = await import('./process-manager.js');
      return new ProcessSessionManager(settings?.sessionManager?.process || {});
    }
    default:
      const { warn } = await import('./logger.js');
      warn(`Unknown session manager type: ${type}, defaulting to tmux`);
      const { TmuxSessionManager } = await import('./tmux-manager.js');
      return new TmuxSessionManager({});
  }
}