/**
 * Process Session Manager
 * Implements SessionManager interface using generic child processes
 */

import { spawn } from 'child_process';
import { error as logError, debug, info, warn } from './logger.js';
import { SessionManager } from './session-manager.js';

/**
 * Track running processes: sessionName -> {process, startTime, exitCode, killed}
 */
class ProcessTracker {
  constructor() {
    this.processes = new Map(); // sessionName -> process info
  }

  /**
   * Add a process to the tracker
   * @param {string} sessionName - Session name
   * @param {ChildProcess} process - Child process
   */
  add(sessionName, process) {
    this.processes.set(sessionName, {
      process,
      startTime: Date.now(),
      exitCode: null,
      killed: false,
    });

    // Monitor process exit
    process.on('exit', (code, signal) => {
      const info = this.processes.get(sessionName);
      if (info) {
        info.exitCode = code;
        info.killed = signal === 'SIGTERM' || signal === 'SIGKILL';
      }
      debug('Process exited', {
        sessionName,
        code,
        signal,
      });
    });

    // Monitor process errors
    process.on('error', (err) => {
      logError('Process error', {
        sessionName,
        error: err.message,
      });
    });
  }

  /**
   * Get process info for a session
   * @param {string} sessionName - Session name
   * @returns {Object|null} Process info or null if not found
   */
  get(sessionName) {
    return this.processes.get(sessionName) || null;
  }

  /**
   * Remove a process from the tracker
   * @param {string} sessionName - Session name
   */
  remove(sessionName) {
    const info = this.processes.get(sessionName);
    if (info && info.process && !info.process.killed) {
      // Clean up process references
      info.process.removeAllListeners();
    }
    this.processes.delete(sessionName);
  }

  /**
   * Get all session names
   * @returns {Array<string>} Array of session names
   */
  list() {
    return Array.from(this.processes.keys());
  }

  /**
   * Check if a process is still running
   * @param {string} sessionName - Session name
   * @returns {boolean} True if process is running
   */
  isRunning(sessionName) {
    const info = this.processes.get(sessionName);
    if (!info) {
      return false;
    }

    // Process has exited
    if (info.exitCode !== null) {
      return false;
    }

    // Check if process is still active
    const proc = info.process;
    if (proc.killed || proc.exitCode !== null) {
      return false;
    }

    // Try to verify process is still alive via kill signal 0
    if (proc.pid) {
      try {
        // signal 0 doesn't kill process, just checks if it exists
        process.kill(proc.pid, 0);
        return true;
      } catch (e) {
        return false;
      }
    }

    return true;
  }

  /**
   * Clear all completed processes
   */
  cleanup() {
    for (const [sessionName, info] of this.processes.entries()) {
      if (info.exitCode !== null || info.killed) {
        this.remove(sessionName);
      }
    }
  }
}

/**
 * Process Session Manager implementation
 */
export class ProcessSessionManager extends SessionManager {
  constructor(config = {}) {
    super();
    this.command = config.command;
    this.args = config.args || [];
    this.prefix = config.prefix || 'pi_project_';
    this.tracker = new ProcessTracker();
    this.lastKillAttempts = new Map(); // sessionName -> timestamp
  }

  /**
   * Check if a session with the given name exists and is running
   * @param {string} sessionName - Session name to check
   * @returns {Promise<boolean>} True if session exists and is running
   */
  async hasSession(sessionName) {
    return this.tracker.isRunning(sessionName);
  }

  /**
   * Create a new session (spawn a process)
   * @param {string} sessionName - Session name to create
   * @param {string} command - Command template string (will be passed as argument to this.command)
   * @param {boolean} dryRun - If true, log action without executing
   * @returns {Promise<boolean>} True if session created successfully
   */
  async createSession(sessionName, command, dryRun = false) {
    if (dryRun) {
      info('DRY-RUN: Would create process session', {
        sessionName,
        command: this.command,
        args: this.args,
        template: command,
      });
      return true;
    }

    // Check if already running
    if (this.tracker.isRunning(sessionName)) {
      debug('Session already exists', { sessionName });
      return true; // Idempotent - consider success if already exists
    }

    if (!this.command) {
      logError('Cannot create session: no command configured', { sessionName });
      return false;
    }

    debug('Creating process session', {
      sessionName,
      command: this.command,
      args: this.args,
      template: command,
    });

    try {
      // Spawn the process with configured command and args
      const args = [...this.args, command];
      const child = spawn(this.command, args, {
        detached: false, // Don't create a new process group
        stdio: ['ignore', 'pipe', 'pipe'], // Pipe stdout/stderr, ignore stdin
      });

      // Track the process
      this.tracker.add(sessionName, child);

      // Log output for debugging
      child.stdout?.on('data', (data) => {
        debug('Process stdout', {
          sessionName,
          data: data.toString().trim().substring(0, 200),
        });
      });

      child.stderr?.on('data', (data) => {
        debug('Process stderr', {
          sessionName,
          data: data.toString().trim().substring(0, 200),
        });
      });

      info('Process session created successfully', {
        sessionName,
        pid: child.pid,
      });

      return true;
    } catch (err) {
      logError('Failed to create process session', {
        sessionName,
        error: err.message,
      });
      return false;
    }
  }

  /**
   * Kill a session (terminate the process)
   * @param {string} sessionName - Session name to kill
   * @param {boolean} dryRun - If true, log action without executing
   * @returns {Promise<boolean>} True if session was killed successfully
   */
  async killSession(sessionName, dryRun = false) {
    if (dryRun) {
      info('DRY-RUN: Would kill process session', { sessionName });
      return true;
    }

    const info = this.tracker.get(sessionName);
    if (!info) {
      debug('Session not found to kill', { sessionName });
      return true; // Consider success if already gone
    }

    const proc = info.process;

    try {
      debug('Killing process session', { sessionName, pid: proc.pid });

      // Try graceful shutdown first
      proc.kill('SIGTERM');

      // Wait a bit for graceful shutdown
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // If still running, force kill
      if (this.tracker.isRunning(sessionName)) {
        debug('Force killing process', { sessionName, pid: proc.pid });
        proc.kill('SIGKILL');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Remove from tracker
      this.tracker.remove(sessionName);

      info('Process session killed successfully', { sessionName });
      return true;
    } catch (err) {
      logError('Failed to kill process session', {
        sessionName,
        error: err.message,
      });
      // Remove from tracker even if kill failed
      this.tracker.remove(sessionName);
      return false;
    }
  }

  /**
   * List all session names
   * @returns {Promise<Array<string>>} Array of session names
   */
  async listSessions() {
    // Clean up dead processes first
    this.tracker.cleanup();
    return this.tracker.list();
  }

  /**
   * Perform a health check on a session
   * A session is unhealthy if:
   * - It doesn't exist in tracker
   * - The process has exited (exitCode !== null)
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
        paneCount: 1,
        hasDeadPanes: false,
        panes: [],
        reason: null,
      };
    }

    const info = this.tracker.get(sessionName);

    if (!info) {
      return {
        healthy: false,
        exists: false,
        paneCount: 0,
        hasDeadPanes: false,
        panes: [],
        reason: 'Session does not exist',
      };
    }

    // Process has exited
    if (info.exitCode !== null) {
      return {
        healthy: false,
        exists: true,
        paneCount: 1,
        hasDeadPanes: true,
        panes: [{
          paneId: `${sessionName}_0`,
          pid: info.process.pid,
          currentCommand: this.command,
          isDead: true,
          exitCode: info.exitCode,
        }],
        reason: `Process exited with code ${info.exitCode}`,
      };
    }

    // Process was killed
    if (info.killed) {
      return {
        healthy: false,
        exists: true,
        paneCount: 1,
        hasDeadPanes: true,
        panes: [{
          paneId: `${sessionName}_0`,
          pid: info.process.pid,
          currentCommand: this.command,
          isDead: true,
        }],
        reason: 'Process was killed',
      };
    }

    // Process is running and healthy
    return {
      healthy: true,
      exists: true,
      paneCount: 1,
      hasDeadPanes: false,
      panes: [{
        paneId: `${sessionName}_0`,
        pid: info.process.pid,
        currentCommand: this.command,
        isDead: false,
      }],
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
   * @returns {boolean} True if session is owned by this service
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
    const projectIdPattern = /^[a-zA-Z0-9-]+$/;
    if (!projectIdPattern.test(suffix)) {
      return false;
    }

    return true;
  }

  /**
   * Extract projectId from an owned session name
   * @param {string} sessionName - Session name
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
   * Ensure a session exists, creating it if missing
   * This is idempotent: multiple calls will not create duplicate processes
   *
   * @param {string} sessionName - Session name (format: ${PREFIX}${projectId})
   * @param {string} projectName - Human-readable project name
   * @param {Object} projectData - Project data with issueCount, issues
   * @param {string} commandTemplate - Template for session command with placeholders
   * @param {boolean} dryRun - If true, log action without executing
   * @returns {Promise<{created: boolean, existed: boolean, sessionName: string}>}
   */
  async ensureSession(sessionName, projectName, projectData, commandTemplate, dryRun = false) {
    // Check if session already exists and is running
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

    info('Creating process session', {
      sessionName,
      projectName,
      commandTemplate,
      command,
    });

    const success = await this.createSession(sessionName, command, dryRun);

    if (success) {
      info('Session created successfully', { sessionName });
      return { created: true, existed: false, sessionName };
    } else {
      logError('Failed to create session', { sessionName });
      return { created: false, existed: false, sessionName };
    }
  }

  async shutdown(reason = 'shutdown') {
    const sessions = await this.listSessions();
    info('Shutting down process sessions', {
      reason,
      sessionCount: sessions.length,
    });

    for (const sessionName of sessions) {
      try {
        await this.killSession(sessionName);
      } catch (err) {
        warn('Failed to kill process session during shutdown', {
          sessionName,
          error: err?.message || String(err),
        });
      }
    }

    info('Process session shutdown complete', {
      reason,
      sessionCount: sessions.length,
    });
  }
}

/**
 * Factory function to create a process session manager
 * @param {Object} config - Process manager configuration
 * @returns {ProcessSessionManager} New process session manager instance
 */
export function createProcessManager(config = {}) {
  return new ProcessSessionManager(config);
}