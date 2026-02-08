/**
 * Settings loader for pi-linear-service
 * Reads configuration from ~/.pi/agent/extensions/pi-linear-service/settings.json
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { debug, warn, error as logError } from './logger.js';

/**
 * Default settings for the service
 * Used when settings.json doesn't exist or is invalid
 */
export function getDefaultSettings() {
  return {
    mode: 'rpc',
    rpc: {
      timeoutMs: 120000,
      restartCooldownSec: 60,
      piCommand: 'pi',
      piArgs: [],
      workspaceRoot: null,
      projectDirOverrides: {},
      provider: null,
      model: null,
    },
    legacy: {
      sessionManager: {
        type: 'tmux', // legacy fallback
        tmux: {
          prefix: 'pi_project_', // Will be overridden by TMUX_PREFIX env var if present
        },
        process: {
          command: null,
          args: [],
          prefix: 'pi_project_', // Will be overridden by TMUX_PREFIX env var if present
        },
      },
    },
  };
}

/**
 * Validate settings object structure
 * @param {Object} settings - Settings object to validate
 * @returns {Object} Validation result {valid: boolean, errors: string[]}
 */
export function validateSettings(settings) {
  const errors = [];

  if (!settings || typeof settings !== 'object') {
    return { valid: false, errors: ['Settings must be an object'] };
  }

  // Validate mode
  const validModes = ['rpc', 'legacy'];
  if (settings.mode !== undefined) {
    if (typeof settings.mode !== 'string' || !validModes.includes(settings.mode)) {
      errors.push(`settings.mode must be one of: ${validModes.join(', ')}`);
    }
  }

  // Validate rpc config (optional)
  if (settings.rpc !== undefined) {
    if (typeof settings.rpc !== 'object' || settings.rpc === null) {
      errors.push('settings.rpc must be an object');
    } else {
      if (settings.rpc.timeoutMs !== undefined && (typeof settings.rpc.timeoutMs !== 'number' || settings.rpc.timeoutMs <= 0)) {
        errors.push('settings.rpc.timeoutMs must be a positive number');
      }
      if (settings.rpc.restartCooldownSec !== undefined && (typeof settings.rpc.restartCooldownSec !== 'number' || settings.rpc.restartCooldownSec < 0)) {
        errors.push('settings.rpc.restartCooldownSec must be a non-negative number');
      }
      if (settings.rpc.piCommand !== undefined && typeof settings.rpc.piCommand !== 'string') {
        errors.push('settings.rpc.piCommand must be a string');
      }
      if (settings.rpc.piArgs !== undefined && !Array.isArray(settings.rpc.piArgs)) {
        errors.push('settings.rpc.piArgs must be an array');
      }
      if (settings.rpc.workspaceRoot !== undefined && settings.rpc.workspaceRoot !== null && typeof settings.rpc.workspaceRoot !== 'string') {
        errors.push('settings.rpc.workspaceRoot must be a string or null');
      }
      if (settings.rpc.projectDirOverrides !== undefined) {
        if (typeof settings.rpc.projectDirOverrides !== 'object' || settings.rpc.projectDirOverrides === null || Array.isArray(settings.rpc.projectDirOverrides)) {
          errors.push('settings.rpc.projectDirOverrides must be an object (map of projectName/projectId -> dir)');
        } else {
          for (const [k, v] of Object.entries(settings.rpc.projectDirOverrides)) {
            if (typeof k !== 'string' || typeof v !== 'string') {
              errors.push('settings.rpc.projectDirOverrides must map strings to strings');
              break;
            }
          }
        }
      }
      if (settings.rpc.provider !== undefined && settings.rpc.provider !== null && typeof settings.rpc.provider !== 'string') {
        errors.push('settings.rpc.provider must be a string or null');
      }
      if (settings.rpc.model !== undefined && settings.rpc.model !== null && typeof settings.rpc.model !== 'string') {
        errors.push('settings.rpc.model must be a string or null');
      }
    }
  }

  // Validate legacy sessionManager
  const legacy = settings.legacy;
  if (legacy !== undefined) {
    if (typeof legacy !== 'object' || legacy === null) {
      errors.push('settings.legacy must be an object');
    } else {
      if (!legacy.sessionManager || typeof legacy.sessionManager !== 'object') {
        errors.push('settings.legacy.sessionManager must be an object');
      } else {
        const sessionManager = legacy.sessionManager;
        const validTypes = ['tmux', 'process'];
        if (!sessionManager.type || typeof sessionManager.type !== 'string') {
          errors.push('settings.legacy.sessionManager.type must be a string ("tmux" or "process")');
        } else if (!validTypes.includes(sessionManager.type)) {
          errors.push(`settings.legacy.sessionManager.type must be one of: ${validTypes.join(', ')}`);
        }

        if (sessionManager.type === 'tmux') {
          if (!sessionManager.tmux || typeof sessionManager.tmux !== 'object') {
            sessionManager.tmux = {};
          }
          if (sessionManager.tmux.prefix && typeof sessionManager.tmux.prefix !== 'string') {
            errors.push('settings.legacy.sessionManager.tmux.prefix must be a string');
          }
        }

        if (sessionManager.type === 'process') {
          if (!sessionManager.process || typeof sessionManager.process !== 'object') {
            errors.push('settings.legacy.sessionManager.process must be an object');
          } else {
            const proc = sessionManager.process;
            if (!proc.command || typeof proc.command !== 'string') {
              errors.push('settings.legacy.sessionManager.process.command must be a string');
            }
            if (proc.args !== undefined && !Array.isArray(proc.args)) {
              errors.push('settings.legacy.sessionManager.process.args must be an array');
            }
            if (proc.prefix && typeof proc.prefix !== 'string') {
              errors.push('settings.legacy.sessionManager.process.prefix must be a string');
            }
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get the settings file path
 * @returns {string} Path to settings.json
 */
function getSettingsPath() {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
  return join(homeDir, '.pi', 'agent', 'extensions', 'pi-linear-service', 'settings.json');
}

/**
 * Load and parse settings from settings.json
 * Falls back to defaults if file doesn't exist or is invalid
 * @returns {Object} Settings object
 */
export async function loadSettings() {
  const settingsPath = getSettingsPath();
  debug('Settings path', { path: settingsPath });

  // Check if settings file exists
  if (!existsSync(settingsPath)) {
    debug('Settings file not found, using defaults', { path: settingsPath });
    return getDefaultSettings();
  }

  try {
    const content = await readFile(settingsPath, 'utf-8');
    const settings = JSON.parse(content);

    debug('Settings file loaded', { path: settingsPath });

    // Validate settings
    const validation = validateSettings(settings);

    if (!validation.valid) {
      warn('Settings validation failed, using defaults', {
        path: settingsPath,
        errors: validation.errors,
      });
      return getDefaultSettings();
    }

    // Ensure nested objects exist (for safety)
    if (!settings.rpc) settings.rpc = {};
    if (!settings.rpc.piArgs) settings.rpc.piArgs = [];
    if (settings.rpc.workspaceRoot === undefined) settings.rpc.workspaceRoot = null;
    if (settings.rpc.projectDirOverrides === undefined) settings.rpc.projectDirOverrides = {};
    if (settings.rpc.provider === undefined) settings.rpc.provider = null;
    if (settings.rpc.model === undefined) settings.rpc.model = null;

    if (!settings.legacy) settings.legacy = {};
    if (!settings.legacy.sessionManager) settings.legacy.sessionManager = {};
    if (!settings.legacy.sessionManager.tmux) settings.legacy.sessionManager.tmux = {};
    if (!settings.legacy.sessionManager.process) settings.legacy.sessionManager.process = {};
    if (!settings.legacy.sessionManager.process.args) settings.legacy.sessionManager.process.args = [];

    debug('Settings validated and loaded', {
      mode: settings.mode,
      rpcTimeoutMs: settings.rpc?.timeoutMs,
      legacySessionManagerType: settings.legacy?.sessionManager?.type,
    });

    return settings;
  } catch (err) {
    if (err instanceof SyntaxError) {
      logError('Settings file contains invalid JSON', {
        path: settingsPath,
        error: err.message,
      });
    } else {
      logError('Failed to load settings file', {
        path: settingsPath,
        error: err.message,
      });
    }

    debug('Falling back to default settings');
    return getDefaultSettings();
  }
}

/**
 * Merge settings with environment variables
 * Environment variables take precedence over settings.json
 * @param {Object} settings - Settings object from loadSettings()
 * @param {Object} envConfig - Environment variable config
 * @returns {Object} Merged config object
 */
export function mergeSettingsWithEnv(settings, envConfig) {
  const merged = { ...settings };

  // Environment variables override prefix used for legacy session managers
  if (envConfig.tmuxPrefix) {
    if (merged.legacy?.sessionManager?.tmux) {
      merged.legacy.sessionManager.tmux.prefix = envConfig.tmuxPrefix;
    }
    if (merged.legacy?.sessionManager?.process) {
      merged.legacy.sessionManager.process.prefix = envConfig.tmuxPrefix;
    }
  }

  // Optional: allow selecting mode via env var
  if (process.env.PI_LINEAR_MODE) {
    merged.mode = process.env.PI_LINEAR_MODE;
  }

  // Optional: allow overriding rpc timeout via env var
  if (process.env.RPC_TIMEOUT_MS) {
    const parsed = parseInt(process.env.RPC_TIMEOUT_MS, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      merged.rpc = merged.rpc || {};
      merged.rpc.timeoutMs = parsed;
    }
  }

  // Optional: set workspace root for spawning pi (repo base directory)
  if (process.env.RPC_WORKSPACE_ROOT) {
    merged.rpc = merged.rpc || {};
    merged.rpc.workspaceRoot = process.env.RPC_WORKSPACE_ROOT;
  }

  // Optional: select provider/model via env vars
  if (process.env.RPC_PROVIDER) {
    merged.rpc = merged.rpc || {};
    merged.rpc.provider = process.env.RPC_PROVIDER;
  }
  if (process.env.RPC_MODEL) {
    merged.rpc = merged.rpc || {};
    merged.rpc.model = process.env.RPC_MODEL;
  }

  return merged;
}