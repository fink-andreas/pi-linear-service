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
import {
  prepareIssueStart,
  setIssueState,
  addIssueComment,
  updateIssue,
  fetchProjects,
  resolveProjectRef,
} from '../src/linear.js';

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
    throw new Error('Missing required argument --id');
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
    projectId: readFlag(args, '--id') || '',
    repoPath: readFlag(args, '--repo-path') || existing?.repo?.path || '',
    assignee: readFlag(args, '--assignee') || existing?.scope?.assignee || 'me',
    openStates: parseStates(readFlag(args, '--open-states')),
    timeoutMs: readFlag(args, '--timeout-ms') || existing?.runtime?.timeoutMs,
    restartCooldownSec: readFlag(args, '--restart-cooldown-sec') || existing?.runtime?.restartCooldownSec,
    pollIntervalSec: readFlag(args, '--poll-interval-sec') || existing?.runtime?.pollIntervalSec,
  };
}

async function collectSetupArgsWithUI(pi, ctx, args) {
  // First, collect project reference if not provided
  await collectProjectRefWithUI(pi, ctx, args);

  if (!readFlag(args, '--id')) return;

  const projectName = readFlag(args, '--name');
  const repoPath = await promptInput(ctx, 'Repository absolute path');
  const assignee = await promptSelectAssignee(ctx, 'me');
  const openStates = await promptInput(ctx, 'Open states (comma-separated)', 'Todo, In Progress');

  if (repoPath) upsertFlag(args, '--repo-path', repoPath);
  if (assignee) upsertFlag(args, '--assignee', assignee);
  if (openStates) upsertFlag(args, '--open-states', openStates);

  await maybePromptRuntime(ctx, args);
}

async function collectReconfigureArgsWithUI(pi, ctx, args) {
  if (!ctx?.hasUI) return null;

  // Use collectProjectRefWithUI to resolve project reference
  const projectRef = await collectProjectRefWithUI(pi, ctx, args);
  if (!projectRef) return null;

  const projectId = projectRef.projectId;
  const settings = await loadSettings();
  const existing = settings.projects?.[projectId] || null;
  if (!existing) {
    throw new Error(`Project daemon does not exist for projectId=${projectId}. Run setup first.`);
  }

  const projectName = await promptInput(ctx, 'Project name (optional)', existing.projectName || projectRef.projectName || '');
  const repoPath = await promptInput(ctx, 'Repository absolute path', existing.repo?.path || '');
  const assignee = await promptSelectAssignee(ctx, existing.scope?.assignee || 'me');
  const openStates = await promptInput(
    ctx,
    'Open states (comma-separated)',
    (existing.scope?.openStates || ['Todo', 'In Progress']).join(',')
  );

  if (projectName) upsertFlag(args, '--name', projectName);
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

function getLinearApiKey() {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error('Missing LINEAR_API_KEY in environment');
  }
  return apiKey;
}

/**
 * Collect project reference from args or UI.
 * Resolves --name to --id if needed.
 * In interactive mode, shows a list of available projects.
 *
 * @param {Object} pi - pi extension API
 * @param {Object} ctx - Extension context
 * @param {Array<string>} args - Parsed args array
 * @returns {Promise<{projectId: string, projectName: string}|null>}
 */
async function collectProjectRefWithUI(pi, ctx, args) {
  let projectId = readFlag(args, '--id');
  const projectName = readFlag(args, '--name');

  // If projectId already provided, return it
  if (projectId) {
    return { projectId, projectName: projectName || null };
  }

  // If projectName provided, resolve it to projectId
  if (projectName) {
    try {
      const apiKey = getLinearApiKey();
      const resolved = await resolveProjectRef(apiKey, projectName);
      projectId = resolved.id;
      upsertFlag(args, '--id', projectId);
      return { projectId, projectName: resolved.name };
    } catch (err) {
      throw new Error(`Failed to resolve project name '${projectName}': ${err.message}`);
    }
  }

  // No reference provided - try interactive selection
  if (!ctx?.hasUI) {
    return null;
  }

  // Try to fetch projects for interactive selection
  let projects = null;
  let apiKey = null;
  try {
    apiKey = getLinearApiKey();
    projects = await fetchProjects(apiKey);
  } catch (err) {
    // API key not available or API error - fall back to simple input
  }

  // If we have projects and select UI, show selection list
  if (projects && projects.length > 0 && ctx.ui.select) {
    const options = projects.map((p) => ({
      label: p.name,
      value: p.id,
    }));

    const selectedId = await ctx.ui.select('Select a Linear project', options);
    if (selectedId) {
      const selected = projects.find((p) => p.id === selectedId);
      projectId = selectedId;
      upsertFlag(args, '--id', projectId);
      if (selected) {
        upsertFlag(args, '--name', selected.name);
      }
      return { projectId, projectName: selected?.name || null };
    }
    return null; // User canceled selection
  }

  // Fallback: simple input - accept project name or ID
  const input = await promptInput(ctx, 'Linear project name or ID');
  if (!input) return null;

  // If it looks like a UUID or test ID (alphanumeric with hyphens, or short ID), use it directly
  if (/^[a-zA-Z0-9-]+$/.test(input) && !apiKey) {
    // No API key available - use input as project ID directly
    upsertFlag(args, '--id', input);
    return { projectId: input, projectName: null };
  }

  // Try to resolve as project name if we have API key
  if (apiKey) {
    try {
      const resolved = await resolveProjectRef(apiKey, input);
      upsertFlag(args, '--id', resolved.id);
      upsertFlag(args, '--name', resolved.name);
      return { projectId: resolved.id, projectName: resolved.name };
    } catch (resolveErr) {
      throw new Error(`Project not found: ${input}`);
    }
  }

  // No API key - use input as project ID
  upsertFlag(args, '--id', input);
  return { projectId: input, projectName: null };
}

function toTextResult(text, details = {}) {
  return {
    content: [{ type: 'text', text }],
    details,
  };
}

function ensureNonEmpty(value, fieldName) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`Missing required field: ${fieldName}`);
  return text;
}

async function runGit(pi, args) {
  if (typeof pi.exec !== 'function') {
    throw new Error('pi.exec is unavailable in this runtime; cannot run git operations');
  }

  const result = await pi.exec('git', args);
  if (result?.code !== 0) {
    const stderr = String(result?.stderr || '').trim();
    throw new Error(`git ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`);
  }
  return result;
}

async function gitBranchExists(pi, branchName) {
  if (typeof pi.exec !== 'function') return false;
  const result = await pi.exec('git', ['rev-parse', '--verify', branchName]);
  return result?.code === 0;
}

async function startGitBranchForIssue(pi, branchName, fromRef = 'HEAD', onBranchExists = 'switch') {
  const exists = await gitBranchExists(pi, branchName);

  if (!exists) {
    await runGit(pi, ['checkout', '-b', branchName, fromRef || 'HEAD']);
    return { action: 'created', branchName };
  }

  if (onBranchExists === 'suffix') {
    let suffix = 1;
    let nextName = `${branchName}-${suffix}`;
    // eslint-disable-next-line no-await-in-loop
    while (await gitBranchExists(pi, nextName)) {
      suffix += 1;
      nextName = `${branchName}-${suffix}`;
    }

    await runGit(pi, ['checkout', '-b', nextName, fromRef || 'HEAD']);
    return { action: 'created-suffix', branchName: nextName };
  }

  await runGit(pi, ['checkout', branchName]);
  return { action: 'switched', branchName };
}

function registerLinearIssueTools(pi) {
  if (typeof pi.registerTool !== 'function') return;

  pi.registerTool({
    name: 'linear_issue_start',
    label: 'Linear Issue Start',
    description: 'Start a Linear issue: create/switch git branch, then move issue to team started workflow state',
    parameters: {
      type: 'object',
      properties: {
        issue: { type: 'string', description: 'Issue key (ABC-123) or Linear issue id' },
        branch: { type: 'string', description: 'Optional custom branch name override' },
        fromRef: { type: 'string', description: 'Optional git ref to branch from (default: HEAD)' },
        onBranchExists: {
          type: 'string',
          enum: ['switch', 'suffix'],
          description: 'When branch exists: switch to it or create suffixed branch',
        },
      },
      required: ['issue'],
      additionalProperties: false,
    },
    async execute(_toolCallId, params) {
      const apiKey = getLinearApiKey();
      const issue = ensureNonEmpty(params.issue, 'issue');
      const prepared = await prepareIssueStart(apiKey, issue);

      const desiredBranch = params.branch || prepared.branchName;
      if (!desiredBranch) {
        throw new Error(
          `No branch name resolved for issue ${prepared.issue.identifier}. Provide the 'branch' parameter explicitly.`
        );
      }

      const gitResult = await startGitBranchForIssue(
        pi,
        desiredBranch,
        params.fromRef || 'HEAD',
        params.onBranchExists || 'switch'
      );

      const updatedIssue = await setIssueState(
        apiKey,
        prepared.issue.id,
        prepared.startedState.id,
        'IssueStartEquivalent'
      );

      const compactTitle = String(updatedIssue.title || prepared.issue?.title || '').trim().toLowerCase();
      const summary = compactTitle
        ? `Started issue ${updatedIssue.identifier} (${compactTitle})`
        : `Started issue ${updatedIssue.identifier}`;

      return toTextResult(summary, {
        issueId: updatedIssue.id,
        identifier: updatedIssue.identifier,
        state: updatedIssue.state,
        startedState: prepared.startedState,
        git: gitResult,
      });
    },
  });

  pi.registerTool({
    name: 'linear_issue_comment_add',
    label: 'Linear Issue Comment Add',
    description: 'Add a comment to a Linear issue',
    parameters: {
      type: 'object',
      properties: {
        issue: { type: 'string', description: 'Issue key (ABC-123) or Linear issue id' },
        body: { type: 'string', description: 'Comment body (markdown)' },
        parentCommentId: { type: 'string', description: 'Optional parent comment id for reply' },
      },
      required: ['issue', 'body'],
      additionalProperties: false,
    },
    async execute(_toolCallId, params) {
      const apiKey = getLinearApiKey();
      const issue = ensureNonEmpty(params.issue, 'issue');
      const body = ensureNonEmpty(params.body, 'body');
      const result = await addIssueComment(apiKey, issue, body, params.parentCommentId);

      return toTextResult(
        `Added comment to issue ${result.issue.identifier}`,
        {
          issueId: result.issue.id,
          identifier: result.issue.identifier,
          commentId: result.comment.id,
        }
      );
    },
  });

  pi.registerTool({
    name: 'linear_issue_update',
    label: 'Linear Issue Update',
    description: 'Update selected fields of a Linear issue',
    parameters: {
      type: 'object',
      properties: {
        issue: { type: 'string', description: 'Issue key (ABC-123) or Linear issue id' },
        title: { type: 'string', description: 'New issue title' },
        description: { type: 'string', description: 'New issue description' },
        priority: { type: 'number', description: 'Priority 0..4' },
        state: { type: 'string', description: 'Target state name or state id' },
      },
      required: ['issue'],
      additionalProperties: false,
    },
    async execute(_toolCallId, params) {
      const apiKey = getLinearApiKey();
      const issue = ensureNonEmpty(params.issue, 'issue');

      const result = await updateIssue(apiKey, issue, {
        title: params.title,
        description: params.description,
        priority: params.priority,
        state: params.state,
      });

      const friendlyChanges = result.changed.map((field) => (field === 'stateId' ? 'state' : field));
      const changeSummaryParts = [];

      if (friendlyChanges.includes('state') && result.issue?.state?.name) {
        changeSummaryParts.push(`state: ${result.issue.state.name}`);
      }

      for (const field of friendlyChanges) {
        if (field !== 'state') changeSummaryParts.push(field);
      }

      const suffix = changeSummaryParts.length > 0
        ? ` (${changeSummaryParts.join(', ')})`
        : '';

      return toTextResult(
        `Updated issue ${result.issue.identifier}${suffix}`,
        {
          issueId: result.issue.id,
          identifier: result.issue.identifier,
          changed: friendlyChanges,
          state: result.issue.state,
          priority: result.issue.priority,
        }
      );
    },
  });
}

export default function piLinearServiceExtension(pi) {
  registerLinearIssueTools(pi);
  pi.registerCommand('linear-daemon-setup', {
    description: 'Interactive setup for project daemon config (use --id or --name, or run interactively)',
    handler: async (argsText, ctx) => {
      const args = parseArgs(argsText);
      await collectSetupArgsWithUI(pi, ctx, args);

      const effective = effectiveConfigFromArgs(args);
      effective.openStates = effective.openStates.length > 0 ? effective.openStates : ['Todo', 'In Progress'];
      validateProjectConfigInput(effective);

      return withCommandFeedback(ctx, 'Daemon setup', async () => {
        await setupProjectDaemon(args);
      });
    },
  });

  pi.registerCommand('linear-daemon-reconfigure', {
    description: 'Interactive reconfigure flow for existing project daemon config (use --id or --name)',
    handler: async (argsText, ctx) => {
      const args = parseArgs(argsText);
      const existing = await collectReconfigureArgsWithUI(pi, ctx, args);

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
    description: 'Show daemon config status for a project (use --id or --name)',
    handler: async (argsText, ctx) => {
      const args = parseArgs(argsText);
      const projectRef = await collectProjectRefWithUI(pi, ctx, args);

      if (!projectRef) {
        throw new Error('Missing required argument --id or --name');
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
    description: 'Disable daemon config for a project (use --id or --name)',
    handler: async (argsText, ctx) => {
      const args = parseArgs(argsText);
      const projectRef = await collectProjectRefWithUI(pi, ctx, args);

      if (!projectRef) {
        throw new Error('Missing required argument --id or --name');
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
        '/linear-daemon-setup [--id <id> | --name <name>]  (interactive if no args)',
        '/linear-daemon-reconfigure [--id <id> | --name <name>]',
        '/linear-daemon-status --id <id> | --name <name>',
        '/linear-daemon-disable --id <id> | --name <name>',
        '/linear-daemon-start [--unit-name <name>] [--no-systemctl]',
        '/linear-daemon-stop [--unit-name <name>] [--no-systemctl]',
        '/linear-daemon-restart [--unit-name <name>] [--no-systemctl]',
        '',
        'Note: --name resolves via Linear API (requires LINEAR_API_KEY)',
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
