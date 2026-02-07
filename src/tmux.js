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
