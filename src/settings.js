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
    sessionManager: {
      type: 'tmux', // Default to tmux for backward compatibility
      tmux: {
        prefix: 'pi_project_', // Will be overridden by TMUX_PREFIX env var if present
      },
      process: {
        command: null,
        args: [],
        prefix: 'pi_project_', // Will be overridden by TMUX_PREFIX env var if present
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

  // Validate sessionManager exists
  if (!settings.sessionManager || typeof settings.sessionManager !== 'object') {
    errors.push('settings.sessionManager must be an object');
    return { valid: false, errors };
  }

  const sessionManager = settings.sessionManager;

  // Validate type
  const validTypes = ['tmux', 'process'];
  if (!sessionManager.type || typeof sessionManager.type !== 'string') {
    errors.push('settings.sessionManager.type must be a string ("tmux" or "process")');
  } else if (!validTypes.includes(sessionManager.type)) {
    errors.push(`settings.sessionManager.type must be one of: ${validTypes.join(', ')}`);
  }

  // Validate tmux config if type is 'tmux'
  if (sessionManager.type === 'tmux') {
    if (!sessionManager.tmux || typeof sessionManager.tmux !== 'object') {
      // Create empty object if missing
      sessionManager.tmux = {};
    }
    if (sessionManager.tmux.prefix && typeof sessionManager.tmux.prefix !== 'string') {
      errors.push('settings.sessionManager.tmux.prefix must be a string');
    }
  }

  // Validate process config if type is 'process'
  if (sessionManager.type === 'process') {
    if (!sessionManager.process || typeof sessionManager.process !== 'object') {
      errors.push('settings.sessionManager.process must be an object');
    } else {
      const proc = sessionManager.process;

      // Command is required for process type
      if (!proc.command || typeof proc.command !== 'string') {
        errors.push('settings.sessionManager.process.command must be a string');
      }

      // Args should be an array
      if (proc.args !== undefined && !Array.isArray(proc.args)) {
        errors.push('settings.sessionManager.process.args must be an array');
      }

      // Prefix should be a string
      if (proc.prefix && typeof proc.prefix !== 'string') {
        errors.push('settings.sessionManager.process.prefix must be a string');
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

    // Ensure all nested objects exist (for safety)
    if (!settings.sessionManager.tmux) {
      settings.sessionManager.tmux = {};
    }
    if (!settings.sessionManager.process) {
      settings.sessionManager.process = {};
    }
    if (!settings.sessionManager.process.args) {
      settings.sessionManager.process.args = [];
    }

    debug('Settings validated and loaded', {
      type: settings.sessionManager.type,
      tmuxPrefix: settings.sessionManager.tmux?.prefix,
      processCommand: settings.sessionManager.process?.command,
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

  // Environment variables override settings.json
  if (envConfig.tmuxPrefix) {
    if (merged.sessionManager.tmux) {
      merged.sessionManager.tmux.prefix = envConfig.tmuxPrefix;
    }
    if (merged.sessionManager.process) {
      merged.sessionManager.process.prefix = envConfig.tmuxPrefix;
    }
  }

  return merged;
}