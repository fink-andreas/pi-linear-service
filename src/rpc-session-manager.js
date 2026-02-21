/**
 * RPC Session Manager
 *
 * Maintains one persistent `pi --mode rpc` process per sessionName (project).
 * This is intentionally separate from the existing tmux/process SessionManager
 * abstraction because RPC requires bidirectional stdio access and command-level
 * health/timeouts.
 */

import { PiRpcClient } from './pi-rpc.js';
import { debug, info, warn, error as logError } from './logger.js';
import { existsSync } from 'fs';
import { join, resolve } from 'path';

export class RpcSessionManager {
  /**
   * @param {Object} options
   * @param {string} [options.prefix]
   * @param {number} [options.timeoutMs]
   * @param {number} [options.restartCooldownSec]
   * @param {string} [options.piCommand]
   * @param {string[]} [options.piArgs]
   * @param {string|null|undefined} [options.workspaceRoot] - Base directory containing git clones, e.g. "~/dvl".
   * @param {Object} [options.projectDirOverrides] - Map projectName/projectId -> directory (relative to workspaceRoot or absolute).
   */
  constructor(options = {}) {
    this.prefix = options.prefix || 'pi_project_';
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.restartCooldownSec = options.restartCooldownSec ?? 300;
    this.piCommand = options.piCommand || 'pi';
    this.piArgs = options.piArgs || [];
    this.workspaceRoot = options.workspaceRoot || null;
    this.projectDirOverrides = options.projectDirOverrides || {};
    this.strictRepoMapping = options.strictRepoMapping ?? false;

    /** @type {Map<string, {client: PiRpcClient, startedAt: number, needsInput: boolean}>} */
    this.sessions = new Map();

    /** @type {Map<string, number>} */
    this.lastRestartAttempt = new Map();
  }

  isOwnedSession(sessionName, prefix = this.prefix) {
    if (!sessionName.startsWith(prefix)) return false;
    const suffix = sessionName.slice(prefix.length);
    return suffix.length > 0 && /^[a-zA-Z0-9-]+$/.test(suffix);
  }

  isWithinCooldown(sessionName) {
    const ts = this.lastRestartAttempt.get(sessionName);
    if (!ts) return false;
    return Date.now() - ts < this.restartCooldownSec * 1000;
  }

  getRemainingCooldownSec(sessionName) {
    const ts = this.lastRestartAttempt.get(sessionName);
    if (!ts) return 0;
    const remainingMs = this.restartCooldownSec * 1000 - (Date.now() - ts);
    return Math.max(0, Math.ceil(remainingMs / 1000));
  }

  recordRestartAttempt(sessionName) {
    this.lastRestartAttempt.set(sessionName, Date.now());
  }

  getClient(sessionName) {
    const entry = this.sessions.get(sessionName);
    return entry?.client || null;
  }

  _expandHome(p) {
    if (!p) return p;
    if (p === '~') return process.env.HOME || p;
    if (p.startsWith('~/')) return join(process.env.HOME || '', p.slice(2));
    return p;
  }

  _resolveCwd(context = {}) {
    const projectName = context.projectName;
    const projectId = context.projectId;

    const strict = context.strictRepoMapping ?? this.strictRepoMapping;

    // Highest precedence: explicit repoPath from project-scoped config.
    if (context.repoPath) {
      const expanded = this._expandHome(context.repoPath);
      const resolvedPath = expanded.startsWith('/') || /^[A-Za-z]:\\/.test(expanded)
        ? resolve(expanded)
        : (this.workspaceRoot ? resolve(join(resolve(this._expandHome(this.workspaceRoot)), expanded)) : resolve(expanded));

      if (existsSync(resolvedPath)) {
        return resolvedPath;
      }

      const msg = 'Configured repo path does not exist';
      if (strict) {
        throw new Error(`${msg}: ${resolvedPath}`);
      }

      warn(`${msg}; falling back`, { projectName, projectId, repoPath: resolvedPath });
    }

    if (!this.workspaceRoot) {
      if (strict) {
        throw new Error('No workspaceRoot configured and no explicit repoPath provided for strict mapping');
      }
      return undefined;
    }

    const root = resolve(this._expandHome(this.workspaceRoot));
    if (!existsSync(root)) {
      if (strict) {
        throw new Error(`workspaceRoot does not exist: ${root}`);
      }
      warn('RPC workspaceRoot does not exist; falling back to inherited cwd', { workspaceRoot: this.workspaceRoot, resolved: root });
      return undefined;
    }

    // Directory override can map either projectName or projectId to a directory.
    const overrides = context.projectDirOverrides || {};
    const override = (projectId && overrides[projectId]) || (projectName && overrides[projectName]);

    if (override) {
      const expanded = this._expandHome(override);

      // Absolute override path: use as-is
      if (expanded.startsWith('/') || /^[A-Za-z]:\\/.test(expanded)) {
        const abs = resolve(expanded);
        if (existsSync(abs)) return abs;
        if (strict) {
          throw new Error(`projectDirOverride absolute path does not exist: ${abs}`);
        }
        warn('RPC projectDirOverride absolute path does not exist; ignoring override', { projectName, projectId, override: abs });
      } else {
        // Relative override: resolve under workspaceRoot
        const candidate = resolve(join(root, expanded));
        if (existsSync(candidate)) return candidate;
        if (strict) {
          throw new Error(`projectDirOverride relative path does not exist: ${candidate}`);
        }
        warn('RPC projectDirOverride relative path does not exist; ignoring override', { projectName, projectId, override: candidate });
      }
    }

    if (strict) {
      throw new Error(`Explicit repo mapping required for project ${projectId || projectName || '<unknown>'}`);
    }

    if (projectName) {
      const candidate = join(root, projectName);
      if (existsSync(candidate)) return candidate;
      warn('Repo dir for project not found under workspaceRoot; falling back to workspaceRoot', {
        projectName,
        candidate,
      });
    }

    return root;
  }

  async ensureSession(sessionName, context = {}) {
    const existing = this.sessions.get(sessionName);
    if (existing?.client?.isAlive()) {
      return { created: false, existed: true, sessionName };
    }

    if (this.isWithinCooldown(sessionName)) {
      const remainingSec = this.getRemainingCooldownSec(sessionName);
      warn('RPC session creation skipped (cooldown)', { sessionName, remainingSec });
      return { created: false, existed: false, sessionName, skipped: true, reason: `cooldown ${remainingSec}s remaining` };
    }

    let cwd;
    try {
      cwd = this._resolveCwd({
        ...context,
        projectDirOverrides: this.projectDirOverrides,
      });
    } catch (err) {
      this.recordRestartAttempt(sessionName);
      warn('RPC session creation skipped due to repo mapping error', {
        sessionName,
        projectId: context.projectId,
        projectName: context.projectName,
        error: err?.message || String(err),
      });
      return { created: false, existed: false, sessionName, error: err, skipped: true, reason: err?.message || String(err) };
    }

    // Build piArgs with per-project runtime overrides
    const piArgs = [...this.piArgs];
    if (context.provider) {
      piArgs.push('--provider', context.provider);
    }
    if (context.model) {
      piArgs.push('--model', context.model);
    }

    info('Creating RPC session', { sessionName, piCommand: this.piCommand, piArgs, cwd, provider: context.provider, model: context.model });

    const client = new PiRpcClient(sessionName, {
      piCommand: this.piCommand,
      piArgs,
      timeoutMs: this.timeoutMs,
      cwd,
    });

    client.on('extension_ui_request', () => {
      const entry = this.sessions.get(sessionName);
      if (entry) entry.needsInput = true;
    });

    client.on('event', (evt) => {
      // Keep minimal logging for now
      debug('pi rpc event', { sessionName, type: evt?.type });
    });

    client.spawn();

    try {
      const resp = await client.newSession();
      if (resp?.success === false) {
        throw new Error(resp?.error || 'new_session failed');
      }
    } catch (err) {
      logError('Failed to initialize pi rpc new_session', { sessionName, error: err?.message || String(err) });
      this.recordRestartAttempt(sessionName);
      client.kill();
      return { created: false, existed: false, sessionName, error: err };
    }

    this.sessions.set(sessionName, { client, startedAt: Date.now(), needsInput: false });
    info('RPC session ready', { sessionName });
    return { created: true, existed: false, sessionName };
  }

  async getState(sessionName) {
    const client = this.getClient(sessionName);
    if (!client || !client.isAlive()) {
      return { ok: false, reason: 'not running' };
    }

    try {
      const resp = await client.getState();
      if (resp?.success === false) {
        return { ok: false, reason: resp?.error || 'get_state failed' };
      }
      return { ok: true, state: resp?.data };
    } catch (err) {
      return { ok: false, reason: err?.message || String(err), error: err };
    }
  }

  async isIdle(sessionName) {
    const stateResult = await this.getState(sessionName);
    if (!stateResult.ok) return { ok: false, idle: false, reason: stateResult.reason };

    const s = stateResult.state;
    const idle = s?.isStreaming === false && (s?.pendingMessageCount ?? 0) === 0;
    return { ok: true, idle, state: s };
  }

  async promptIfIdle(sessionName, message) {
    const client = this.getClient(sessionName);
    if (!client || !client.isAlive()) {
      return { ok: false, prompted: false, reason: 'not running' };
    }

    const idleResult = await this.isIdle(sessionName);
    if (!idleResult.ok) {
      return { ok: false, prompted: false, reason: idleResult.reason };
    }
    if (!idleResult.idle) {
      return { ok: true, prompted: false, reason: 'not idle', state: idleResult.state };
    }

    try {
      const resp = await client.prompt(message);
      if (resp?.success === false) {
        return { ok: false, prompted: false, reason: resp?.error || 'prompt failed' };
      }
      return { ok: true, prompted: true };
    } catch (err) {
      return { ok: false, prompted: false, reason: err?.message || String(err), error: err };
    }
  }

  async abortAndRestart(sessionName, reason) {
    const entry = this.sessions.get(sessionName);
    const client = entry?.client;

    warn('Aborting and restarting RPC session', { sessionName, reason });
    this.recordRestartAttempt(sessionName);

    if (client && client.isAlive()) {
      try {
        await client.abort();
      } catch (err) {
        // ignore
      }
      client.kill();
    }

    this.sessions.delete(sessionName);
    return true;
  }

  async shutdown(reason = 'shutdown') {
    const entries = Array.from(this.sessions.entries());
    info('Shutting down RPC sessions', {
      reason,
      sessionCount: entries.length,
    });

    for (const [sessionName, entry] of entries) {
      const client = entry?.client;
      if (!client) continue;

      if (client.isAlive()) {
        try {
          await client.abort();
        } catch (err) {
          // best-effort during shutdown
        }
        client.kill();
      }

      this.sessions.delete(sessionName);
    }

    info('RPC session shutdown complete', {
      reason,
      sessionCount: entries.length,
    });
  }

  listSessions() {
    return Array.from(this.sessions.keys());
  }
}
