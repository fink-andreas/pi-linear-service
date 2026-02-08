/**
 * Pi RPC client (NDJSON over stdio)
 *
 * pi --mode rpc reads JSON lines from stdin and writes JSON lines to stdout.
 * This module provides a small request/response layer with timeouts and
 * an event stream for non-response messages.
 */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { debug, info, warn, error as logError } from './logger.js';

function randomId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/**
 * @typedef {Object} PiRpcSpawnOptions
 * @property {string} [piCommand] - Command to run (default: "pi")
 * @property {string[]} [piArgs] - Additional args before "--mode rpc"
 * @property {string} [cwd]
 * @property {Object} [env]
 * @property {number} [timeoutMs] - Default command timeout
 */

/**
 * PiRpcClient wraps a spawned `pi --mode rpc` process.
 */
export class PiRpcClient extends EventEmitter {
  /**
   * @param {string} sessionName
   * @param {PiRpcSpawnOptions} [options]
   */
  constructor(sessionName, options = {}) {
    super();
    this.sessionName = sessionName;
    this.piCommand = options.piCommand || 'pi';
    this.piArgs = options.piArgs || [];
    this.cwd = options.cwd;
    this.env = options.env;
    this.timeoutMs = options.timeoutMs ?? 120_000;

    // For tests: allow injecting a spawn implementation.
    this._spawnImpl = options.spawnImpl || spawn;

    /** @type {import('child_process').ChildProcess|null} */
    this.child = null;

    this._buffer = '';
    this._pending = new Map(); // id -> {resolve, reject, timeoutId, commandType}
    this._lastMessageTs = Date.now();
  }

  spawn() {
    if (this.child && this.child.exitCode === null && !this.child.killed) {
      return this.child;
    }

    const args = [...this.piArgs, '--mode', 'rpc'];
    info('Spawning pi RPC process', { sessionName: this.sessionName, command: this.piCommand, args });

    const child = this._spawnImpl(this.piCommand, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
      cwd: this.cwd,
      env: { ...process.env, ...(this.env || {}) },
    });

    this.child = child;

    child.on('exit', (code, signal) => {
      warn('pi RPC process exited', { sessionName: this.sessionName, code, signal });
      this.emit('exit', { code, signal });

      // Reject all pending requests
      for (const [id, pending] of this._pending.entries()) {
        clearTimeout(pending.timeoutId);
        pending.reject(new Error(`pi RPC process exited while awaiting response (id=${id}, command=${pending.commandType})`));
      }
      this._pending.clear();
    });

    child.on('error', (err) => {
      logError('pi RPC process error', { sessionName: this.sessionName, error: err?.message || String(err) });
      this.emit('error', err);
    });

    child.stdout?.on('data', (data) => {
      this._lastMessageTs = Date.now();
      this._onStdoutData(data.toString('utf8'));
    });

    child.stderr?.on('data', (data) => {
      const text = data.toString('utf8');
      // pi sometimes logs to stderr; keep it visible but trimmed
      debug('pi rpc stderr', { sessionName: this.sessionName, data: text.trim().slice(0, 500) });
      this.emit('stderr', { text });
    });

    return child;
  }

  isAlive() {
    return !!(this.child && this.child.exitCode === null && !this.child.killed);
  }

  lastMessageAgeMs() {
    return Date.now() - this._lastMessageTs;
  }

  /**
   * Send one RPC command and await its `type:"response"` message.
   * Non-response stdout messages are emitted as `event`.
   *
   * @param {Object} command
   * @param {number} [timeoutMs]
   */
  send(command, timeoutMs) {
    this.spawn();

    if (!this.child?.stdin) {
      return Promise.reject(new Error('pi RPC stdin is not available'));
    }

    const id = command.id || randomId();
    const commandWithId = { ...command, id };

    const effectiveTimeout = timeoutMs ?? this.timeoutMs;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`pi RPC timeout after ${effectiveTimeout}ms for command=${command.type} id=${id}`));
      }, effectiveTimeout);

      this._pending.set(id, {
        resolve,
        reject,
        timeoutId,
        commandType: command.type,
      });

      const line = JSON.stringify(commandWithId);
      debug('pi rpc ->', { sessionName: this.sessionName, line: line.slice(0, 500) });

      try {
        this.child.stdin.write(line + '\n', 'utf8');
      } catch (err) {
        clearTimeout(timeoutId);
        this._pending.delete(id);
        reject(err);
      }
    });
  }

  async newSession(parentSession) {
    return this.send({ type: 'new_session', parentSession });
  }

  async getState() {
    return this.send({ type: 'get_state' });
  }

  async prompt(message) {
    return this.send({ type: 'prompt', message });
  }

  async abort() {
    return this.send({ type: 'abort' }, Math.min(10_000, this.timeoutMs));
  }

  kill() {
    if (!this.child) return;
    try {
      this.child.kill('SIGTERM');
      setTimeout(() => {
        if (this.child && this.child.exitCode === null && !this.child.killed) {
          this.child.kill('SIGKILL');
        }
      }, 1000);
    } catch (err) {
      // ignore
    }
  }

  _onStdoutData(chunk) {
    this._buffer += chunk;

    while (true) {
      const idx = this._buffer.indexOf('\n');
      if (idx === -1) break;

      const line = this._buffer.slice(0, idx).trim();
      this._buffer = this._buffer.slice(idx + 1);

      if (!line) continue;

      let msg;
      try {
        msg = JSON.parse(line);
      } catch (err) {
        warn('Failed to parse pi rpc stdout line as JSON', { sessionName: this.sessionName, line: line.slice(0, 500) });
        continue;
      }

      // Responses are correlated by id.
      if (msg?.type === 'response') {
        const id = msg.id;
        if (id && this._pending.has(id)) {
          const pending = this._pending.get(id);
          clearTimeout(pending.timeoutId);
          this._pending.delete(id);
          pending.resolve(msg);
          continue;
        }

        // Unmatched response (shouldn't happen but don't drop)
        this.emit('event', msg);
        continue;
      }

      // Future hook: extension UI requests mean the agent needs input.
      if (msg?.type === 'extension_ui_request') {
        info('pi rpc extension_ui_request', { sessionName: this.sessionName, method: msg.method, title: msg.title });
        this.emit('extension_ui_request', msg);
        this.emit('event', msg);
        continue;
      }

      // Any other event
      this.emit('event', msg);
    }
  }
}
