import {
  setupProjectDaemon,
  reconfigureProjectDaemon,
  disableProjectDaemon,
  daemonStatus,
  daemonStart,
  daemonStop,
  daemonRestart,
} from '../src/daemon-control.js';

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

async function promptIfMissing(ctx, args, flag, promptLabel) {
  if (readFlag(args, flag)) return;
  if (!ctx?.hasUI || !ctx.ui?.input) return;
  const value = await ctx.ui.input(promptLabel);
  if (value && value.trim()) {
    upsertFlag(args, flag, value.trim());
  }
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
    description: 'Setup project daemon config (supports flags or interactive prompts)',
    handler: async (argsText, ctx) => {
      const args = parseArgs(argsText);
      await promptIfMissing(ctx, args, '--project-id', 'Linear project ID');
      await promptIfMissing(ctx, args, '--repo-path', 'Repository absolute path');
      await promptIfMissing(ctx, args, '--project-name', 'Project name (optional)');

      return withCommandFeedback(ctx, 'Daemon setup', async () => {
        await setupProjectDaemon(args);
      });
    },
  });

  pi.registerCommand('linear-daemon-reconfigure', {
    description: 'Reconfigure an existing project daemon config',
    handler: async (argsText, ctx) => {
      const args = parseArgs(argsText);
      await promptIfMissing(ctx, args, '--project-id', 'Linear project ID to reconfigure');

      return withCommandFeedback(ctx, 'Daemon reconfigure', async () => {
        await reconfigureProjectDaemon(args);
      });
    },
  });

  pi.registerCommand('linear-daemon-status', {
    description: 'Show daemon config status for a project',
    handler: async (argsText, ctx) => {
      const args = parseArgs(argsText);
      await promptIfMissing(ctx, args, '--project-id', 'Linear project ID');

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
      await promptIfMissing(ctx, args, '--project-id', 'Linear project ID');

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
        '/linear-daemon-setup --project-id <id> --repo-path <path> [--project-name <name>] [--open-states "Todo,In Progress"] [--assignee me|all]',
        '/linear-daemon-reconfigure --project-id <id> [--repo-path <path>] [--project-name <name>] [--open-states "Todo,In Progress"] [--assignee me|all]',
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
