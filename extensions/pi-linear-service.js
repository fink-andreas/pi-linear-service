import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import {
  setupProjectDaemon,
  reconfigureProjectDaemon,
  disableProjectDaemon,
  daemonStatus,
  daemonStart,
  daemonStop,
  daemonRestart,
} from '../src/daemon-control.js';
import { loadSettings } from '../src/settings.js';

function parseArgs(argsString) {
  if (!argsString || !argsString.trim()) return [];
  const tokens = argsString.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  return tokens.map((t) => {
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
      return t.slice(1, -1);
    }
    return t;
  });
}

function upsertFlag(args, flag, value) {
  const idx = args.indexOf(flag);
  if (idx >= 0) {
    args[idx + 1] = value;
    return;
  }
  args.push(flag, value);
}

function readFlag(args, flag) {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

function parseStates(statesText) {
  if (!statesText) return [];
  return statesText.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseOptionalInt(raw, fieldName, { min = 0 } = {}) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const parsed = Number.parseInt(String(raw), 10);
  if (Number.isNaN(parsed) || parsed < min) {
    throw new Error(`Invalid ${fieldName}: ${raw}`);
  }
  return parsed;
}

function validateProjectConfigInput({
  projectId,
  repoPath,
  assignee,
  openStates,
  timeoutMs,
  restartCooldownSec,
  pollIntervalSec,
}) {
  if (!projectId || !projectId.trim()) {
    throw new Error('Missing required argument --project-id');
  }

  if (!repoPath || !repoPath.trim()) {
    throw new Error('Missing required argument --repo-path (explicit mapping required)');
  }

  if (!isAbsolute(repoPath)) {
    throw new Error(`Repository path must be absolute: ${repoPath}`);
  }

  if (!existsSync(repoPath)) {
    throw new Error(`Configured repo path does not exist: ${repoPath}`);
  }

  if (assignee && !['me', 'all'].includes(assignee)) {
    throw new Error(`Invalid assignee mode: ${assignee}. Valid: me, all`);
  }

  if (!Array.isArray(openStates) || openStates.length === 0) {
    throw new Error('Open states must contain at least one state');
  }

  parseOptionalInt(timeoutMs, 'timeoutMs', { min: 1 });
  parseOptionalInt(restartCooldownSec, 'restartCooldownSec', { min: 0 });
  parseOptionalInt(pollIntervalSec, 'pollIntervalSec', { min: 1 });
}

async function promptInput(ctx, label, currentValue = '') {
  if (!ctx?.hasUI || !ctx.ui?.input) return currentValue;
  const value = await ctx.ui.input(label, currentValue || '');
  if (value === undefined || value === null) return currentValue;
  return String(value).trim();
}

async function promptSelectAssignee(ctx, currentValue = 'me') {
  if (!ctx?.hasUI || !ctx.ui?.select) return currentValue;
  const picked = await ctx.ui.select('Assignee mode', ['me', 'all']);
  if (!picked) return currentValue;
  return picked;
}

async function maybePromptRuntime(ctx, args, defaults = {}) {
  if (!ctx?.hasUI || !ctx.ui?.confirm) return;

  const hasRuntimeArgs = [
    '--poll-interval-sec',
    '--timeout-ms',
    '--restart-cooldown-sec',
    '--provider',
    '--model',
  ].some((flag) => readFlag(args, flag) !== undefined);

  if (hasRuntimeArgs) return;

  const shouldConfigure = await ctx.ui.confirm(
    'Runtime options',
    'Configure runtime overrides (optional)?'
  );

  if (!shouldConfigure) return;

  const poll = await promptInput(ctx, 'Poll interval seconds (optional)', defaults.pollIntervalSec ?? '');
  const timeout = await promptInput(ctx, 'Timeout ms (optional)', defaults.timeoutMs ?? '');
  const cooldown = await promptInput(ctx, 'Restart cooldown seconds (optional)', defaults.restartCooldownSec ?? '');
  const provider = await promptInput(ctx, 'Provider (optional)', defaults.provider ?? '');
  const model = await promptInput(ctx, 'Model (optional)', defaults.model ?? '');

  if (poll) upsertFlag(args, '--poll-interval-sec', poll);
  if (timeout) upsertFlag(args, '--timeout-ms', timeout);
  if (cooldown) upsertFlag(args, '--restart-cooldown-sec', cooldown);
  if (provider) upsertFlag(args, '--provider', provider);
  if (model) upsertFlag(args, '--model', model);
}

function effectiveConfigFromArgs(args, existing = null) {
  return {
    projectId: readFlag(args, '--project-id') || '',
    repoPath: readFlag(args, '--repo-path') || existing?.repo?.path || '',
    assignee: readFlag(args, '--assignee') || existing?.scope?.assignee || 'me',
    openStates: parseStates(readFlag(args, '--open-states')),
    timeoutMs: readFlag(args, '--timeout-ms') || existing?.runtime?.timeoutMs,
    restartCooldownSec: readFlag(args, '--restart-cooldown-sec') || existing?.runtime?.restartCooldownSec,
    pollIntervalSec: readFlag(args, '--poll-interval-sec') || existing?.runtime?.pollIntervalSec,
  };
}

async function collectSetupArgsWithUI(ctx, args) {
  if (readFlag(args, '--project-id')) return;

  const projectId = await promptInput(ctx, 'Linear project ID');
  const projectName = await promptInput(ctx, 'Project name (optional)');
  const repoPath = await promptInput(ctx, 'Repository absolute path');
  const assignee = await promptSelectAssignee(ctx, 'me');
  const openStates = await promptInput(ctx, 'Open states (comma-separated)', 'Todo,In Progress');

  if (projectId) upsertFlag(args, '--project-id', projectId);
  if (projectName) upsertFlag(args, '--project-name', projectName);
  if (repoPath) upsertFlag(args, '--repo-path', repoPath);
  if (assignee) upsertFlag(args, '--assignee', assignee);
  if (openStates) upsertFlag(args, '--open-states', openStates);

  await maybePromptRuntime(ctx, args);
}

async function collectReconfigureArgsWithUI(ctx, args) {
  if (!ctx?.hasUI) return null;

  let projectId = readFlag(args, '--project-id');
  if (!projectId) {
    projectId = await promptInput(ctx, 'Linear project ID to reconfigure');
    if (projectId) upsertFlag(args, '--project-id', projectId);
  }

  if (!projectId) return null;

  const settings = await loadSettings();
  const existing = settings.projects?.[projectId] || null;
  if (!existing) {
    throw new Error(`Project daemon does not exist for projectId=${projectId}. Run setup first.`);
  }

  const projectName = await promptInput(ctx, 'Project name (optional)', existing.projectName || '');
  const repoPath = await promptInput(ctx, 'Repository absolute path', existing.repo?.path || '');
  const assignee = await promptSelectAssignee(ctx, existing.scope?.assignee || 'me');
  const openStates = await promptInput(
    ctx,
    'Open states (comma-separated)',
    (existing.scope?.openStates || ['Todo', 'In Progress']).join(',')
  );

  if (projectName) upsertFlag(args, '--project-name', projectName);
  if (repoPath) upsertFlag(args, '--repo-path', repoPath);
  if (assignee) upsertFlag(args, '--assignee', assignee);
  if (openStates) upsertFlag(args, '--open-states', openStates);

  await maybePromptRuntime(ctx, args, existing.runtime || {});
  return existing;
}

async function withCommandFeedback(ctx, actionLabel, run) {
  try {
    const result = await run();
    if (ctx?.hasUI) {
      ctx.ui.notify(`${actionLabel} succeeded`, 'info');
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (ctx?.hasUI) {
      ctx.ui.notify(`${actionLabel} failed: ${message}`, 'error');
    }
    throw err;
  }
}

async function runStatusWithCapture(args) {
  const originalLog = console.log;
  let captured = '';
  console.log = (...parts) => {
    const line = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
    captured += `${line}\n`;
  };

  try {
    await daemonStatus(args);
  } finally {
    console.log = originalLog;
  }

  return captured.trim();
}

export default function piLinearServiceExtension(pi) {
  pi.registerCommand('linear-daemon-setup', {
    description: 'Interactive setup for project daemon config (or pass flags directly)',
    handler: async (argsText, ctx) => {
      const args = parseArgs(argsText);
      await collectSetupArgsWithUI(ctx, args);

      const effective = effectiveConfigFromArgs(args);
      effective.openStates = effective.openStates.length > 0 ? effective.openStates : ['Todo', 'In Progress'];
      validateProjectConfigInput(effective);

      return withCommandFeedback(ctx, 'Daemon setup', async () => {
        await setupProjectDaemon(args);
      });
    },
  });

  pi.registerCommand('linear-daemon-reconfigure', {
    description: 'Interactive reconfigure flow for existing project daemon config',
    handler: async (argsText, ctx) => {
      const args = parseArgs(argsText);
      const existing = await collectReconfigureArgsWithUI(ctx, args);

      const effective = effectiveConfigFromArgs(args, existing);
      if (effective.openStates.length === 0 && existing?.scope?.openStates?.length) {
        effective.openStates = existing.scope.openStates;
      }
      validateProjectConfigInput(effective);

      return withCommandFeedback(ctx, 'Daemon reconfigure', async () => {
        await reconfigureProjectDaemon(args);
      });
    },
  });

  pi.registerCommand('linear-daemon-status', {
    description: 'Show daemon config status for a project',
    handler: async (argsText, ctx) => {
      const args = parseArgs(argsText);
      if (!readFlag(args, '--project-id')) {
        const projectId = await promptInput(ctx, 'Linear project ID');
        if (projectId) upsertFlag(args, '--project-id', projectId);
      }

      if (!readFlag(args, '--project-id')) {
        throw new Error('Missing required argument --project-id');
      }

      return withCommandFeedback(ctx, 'Daemon status', async () => {
        const output = await runStatusWithCapture(args);
        if (output) {
          pi.sendMessage({
            customType: 'pi-linear-service',
            content: output,
            display: true,
          });
        }
      });
    },
  });

  pi.registerCommand('linear-daemon-disable', {
    description: 'Disable daemon config for a project',
    handler: async (argsText, ctx) => {
      const args = parseArgs(argsText);
      if (!readFlag(args, '--project-id')) {
        const projectId = await promptInput(ctx, 'Linear project ID');
        if (projectId) upsertFlag(args, '--project-id', projectId);
      }

      if (!readFlag(args, '--project-id')) {
        throw new Error('Missing required argument --project-id');
      }

      return withCommandFeedback(ctx, 'Daemon disable', async () => {
        await disableProjectDaemon(args);
      });
    },
  });

  pi.registerCommand('linear-daemon-start', {
    description: 'Start systemd user service for pi-linear-service',
    handler: async (argsText, ctx) => withCommandFeedback(ctx, 'Daemon start', async () => {
      await daemonStart(parseArgs(argsText));
    }),
  });

  pi.registerCommand('linear-daemon-stop', {
    description: 'Stop systemd user service for pi-linear-service',
    handler: async (argsText, ctx) => withCommandFeedback(ctx, 'Daemon stop', async () => {
      await daemonStop(parseArgs(argsText));
    }),
  });

  pi.registerCommand('linear-daemon-restart', {
    description: 'Restart systemd user service for pi-linear-service',
    handler: async (argsText, ctx) => withCommandFeedback(ctx, 'Daemon restart', async () => {
      await daemonRestart(parseArgs(argsText));
    }),
  });

  pi.registerCommand('linear-daemon-help', {
    description: 'Show pi-linear-service daemon commands',
    handler: async (_args, ctx) => {
      const lines = [
        '/linear-daemon-setup                (interactive setup flow)',
        '/linear-daemon-reconfigure          (interactive reconfigure flow)',
        '/linear-daemon-status --project-id <id>',
        '/linear-daemon-disable --project-id <id>',
        '/linear-daemon-start [--unit-name <name>] [--no-systemctl]',
        '/linear-daemon-stop [--unit-name <name>] [--no-systemctl]',
        '/linear-daemon-restart [--unit-name <name>] [--no-systemctl]',
      ];

      if (ctx.hasUI) {
        ctx.ui.notify('pi-linear-service extension commands available', 'info');
      }

      pi.sendMessage({
        customType: 'pi-linear-service',
        content: `Available daemon commands:\n${lines.join('\n')}`,
        display: true,
      });
    },
  });
}
