/**
 * Tmux Session Manager
 * Implements SessionManager interface using tmux for session management
 */

import { spawn } from 'child_process';
import { error as logError, debug, info, warn } from './logger.js';
import { SessionManager } from './session-manager.js';

/**
 * Tmux Session Manager implementation
 */
export class TmuxSessionManager extends SessionManager {
  constructor(config = {}) {
    super();
    this.prefix = config.prefix || 'pi_project_';
    this.lastKillAttempts = new Map(); // sessionName -> timestamp
  }

  /**
   * Execute a tmux command
   * @param {Array<string>} args - Arguments to pass to tmux
   * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
   */
  execTmux(args) {
    return new Promise(async (resolve, reject) => {
      const startTime = Date.now();
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
        const durationMs = Date.now() - startTime;
        if (code !== 0) {
          logError('tmux command failed', {
            args: args.join(' '),
            exitCode: code,
            stderr: stderr.trim(),
            durationMs,
          });
        } else {
          debug('tmux command completed', {
            args: args.join(' '),
            exitCode: code,
            durationMs,
          });
        }
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code });
      });

      child.on('error', (err) => {
        const durationMs = Date.now() - startTime;
        logError('Failed to spawn tmux process', { error: err.message, durationMs });
        reject(err);
      });
    });
  }

  /**
   * Check if a tmux session exists
   * @param {string} sessionName - Session name to check
   * @returns {Promise<boolean>} True if session exists
   */
  async hasSession(sessionName) {
    const result = await this.execTmux(['has-session', '-t', sessionName]);
    return result.exitCode === 0;
  }

  /**
   * Create a new detached tmux session
   * @param {string} sessionName - Session name to create
   * @param {string} command - Command to run in the session
   * @param {boolean} dryRun - If true, log action without executing
   * @returns {Promise<boolean>} True if session was created successfully
   */
  async createSession(sessionName, command, dryRun = false) {
    if (dryRun) {
      info('DRY-RUN: Would create tmux session', { sessionName, command });
      return true;
    }
    debug('Creating tmux session', { sessionName, command });
    const result = await this.execTmux(['new-session', '-d', '-s', sessionName, command]);
    return result.exitCode === 0;
  }

  /**
   * Kill a tmux session
   * @param {string} sessionName - Session name to kill
   * @param {boolean} dryRun - If true, log action without executing
   * @returns {Promise<boolean>} True if session was killed successfully
   */
  async killSession(sessionName, dryRun = false) {
    if (dryRun) {
      info('DRY-RUN: Would kill tmux session', { sessionName });
      return true;
    }
    debug('Killing tmux session', { sessionName });
    const result = await this.execTmux(['kill-session', '-t', sessionName]);
    return result.exitCode === 0;
  }

  /**
   * List all tmux sessions
   * @returns {Promise<Array<string>>} Array of session names
   */
  async listSessions() {
    const result = await this.execTmux(['list-sessions', '-F', '#{session_name}']);
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
  async listPanes(sessionName) {
    const format = '#{pane_id}:#{pane_pid}:#{pane_current_command}:#{pane_dead}';
    const result = await this.execTmux(['list-panes', '-t', sessionName, '-F', format]);
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
   * Perform a health check on a tmux session
   * "Unhealthy" if session exists but:
   * - no panes, OR
   * - pane process has exited (pane_dead === 1)
   *
   * @param {string} sessionName - Session name to check
   * @param {string} healthMode - Health check mode ('none' or 'basic')
   * @returns {Promise<Object>} Health check result
   */
  async checkSessionHealth(sessionName, healthMode) {
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
    const exists = await this.hasSession(sessionName);

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
    const panes = await this.listPanes(sessionName);
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
   * Session name format: ${PREFIX}${projectId}
   * Example: pi_project_ABC-123 where PREFIX=pi_project_
   *
   * @param {string} sessionName - Session name to check
   * @param {string} prefix - Prefix to match (uses instance prefix if not provided)
   * @returns {boolean} True if session name is owned by this service
   */
  isOwnedSession(sessionName, prefix) {
    const effectivePrefix = prefix || this.prefix;

    // Must start with the prefix
    if (!sessionName.startsWith(effectivePrefix)) {
      return false;
    }

    // Extract what comes after the prefix (should be the projectId)
    const suffix = sessionName.substring(effectivePrefix.length);

    // Must have something after the prefix (the projectId)
    if (suffix.length === 0) {
      return false;
    }

    // Project IDs typically follow patterns like ABC-123 or PROJ-456
    // Require at least one alphanumeric character or hyphen
    const projectIdPattern = /^[a-zA-Z0-9-]+$/;
    if (!projectIdPattern.test(suffix)) {
      return false;
    }

    return true;
  }

  /**
   * Extract projectId from an owned session name
   * @param {string} sessionName - Session name (e.g., 'pi_project_ABC-123')
   * @param {string} prefix - Prefix (uses instance prefix if not provided)
   * @returns {string|null} ProjectId if session is owned, null otherwise
   */
  extractProjectId(sessionName, prefix) {
    const effectivePrefix = prefix || this.prefix;
    if (!this.isOwnedSession(sessionName, effectivePrefix)) {
      return null;
    }
    return sessionName.substring(effectivePrefix.length);
  }

  /**
   * Check if a session is within cooldown period after a kill attempt
   * @param {string} sessionName - Session name to check
   * @param {number} cooldownSec - Cooldown period in seconds
   * @returns {boolean} True if session is within cooldown period
   */
  isWithinCooldown(sessionName, cooldownSec) {
    const lastAttempt = this.lastKillAttempts.get(sessionName);
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
  getRemainingCooldown(sessionName, cooldownSec) {
    const lastAttempt = this.lastKillAttempts.get(sessionName);
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
  recordKillAttempt(sessionName) {
    this.lastKillAttempts.set(sessionName, Date.now());
  }

  /**
   * Clear kill attempt timestamp for a session
   * @param {string} sessionName - Session name
   */
  clearKillAttempt(sessionName) {
    this.lastKillAttempts.delete(sessionName);
  }

  /**
   * Replace placeholders in template string with actual values
   *
   * @param {string} template - Template string with ${placeholder} format
   * @param {Object} values - Object with values to replace placeholders
   * @returns {string} Template with placeholders replaced
   */
  replacePlaceholders(template, values) {
    let result = template;
    for (const [key, value] of Object.entries(values)) {
      const placeholderPattern = new RegExp(`\\$\\{${key}\\}`, 'g');
      result = result.replace(placeholderPattern, String(value));
    }
    return result;
  }

  /**
   * Ensure a tmux session exists, creating it if missing
   * This is idempotent: multiple calls will not create duplicate sessions
   *
   * @param {string} sessionName - Session name (format: ${TMUX_PREFIX}${projectId})
   * @param {string} projectName - Human-readable project name
   * @param {Object} projectData - Project data with issueCount, issues
   * @param {string} commandTemplate - Template for session command with placeholders
   * @param {boolean} dryRun - If true, log action without executing
   * @returns {Promise<{created: boolean, existed: boolean, sessionName: string}>}
   */
  async ensureSession(sessionName, projectName, projectData, commandTemplate, dryRun = false) {
    // Check if session already exists
    const exists = await this.hasSession(sessionName);

    if (exists) {
      debug('Session already exists', { sessionName });
      return { created: false, existed: true, sessionName };
    }

    // Build command from template
    const placeholders = {
      projectName,
      sessionId: sessionName,
      projectId: this.extractProjectId(sessionName, this.prefix),
      issueCount: projectData?.issueCount || 0,
    };

    const command = this.replacePlaceholders(commandTemplate, placeholders);

    info('Creating tmux session', { sessionName, projectName, command });

    const success = await this.createSession(sessionName, command, dryRun);

    if (success) {
      info('Session created successfully', { sessionName });
      return { created: true, existed: false, sessionName };
    } else {
      logError('Failed to create session', { sessionName });
      return { created: false, existed: false, sessionName };
    }
  }

  /**
   * Get version of tmux
   * @returns {Promise<string|null>} tmux version string or null if not available
   */
  async getTmuxVersion() {
    try {
      const result = await this.execTmux(['-V']);
      if (result.exitCode === 0) {
        return result.stdout;
      }
      return null;
    } catch (error) {
      return null;
    }
  }
}

/**
 * Factory function to create a tmux session manager
 * @param {Object} config - Tmux manager configuration
 * @returns {TmuxSessionManager} New tmux session manager instance
 */
export function createTmuxManager(config = {}) {
  return new TmuxSessionManager(config);
}