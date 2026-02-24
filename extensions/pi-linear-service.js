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
  daemonInstall,
} from '../src/daemon-control.js';
import { loadSettings, saveSettings } from '../src/settings.js';
import { setQuietMode } from '../src/logger.js';
import { createLinearClient } from '../src/linear-client.js';
import {
  prepareIssueStart,
  setIssueState,
  addIssueComment,
  updateIssue,
  createIssue,
  fetchProjects,
  fetchTeams,
  resolveProjectRef,
  resolveTeamRef,
  getTeamWorkflowStates,
  fetchIssueDetails,
  formatIssueAsMarkdown,
  fetchIssuesByProject,
  fetchProjectMilestones,
  fetchMilestoneDetails,
  createProjectMilestone,
  updateProjectMilestone,
} from '../src/linear.js';

// ===== ARGUMENT PARSING UTILITIES =====

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

// ===== VALIDATION =====

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

// ===== UI PROMPTS =====

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

// ===== CONFIG HELPERS =====

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

async function withCommandFeedback(ctx, actionLabel, run) {
  setQuietMode(true);
  try {
    const result = await run();
    if (ctx?.hasUI) {
      ctx.ui.notify(actionLabel, 'info');
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (ctx?.hasUI) {
      ctx.ui.notify(`${actionLabel} failed: ${message}`, 'error');
    }
    throw err;
  } finally {
    setQuietMode(false);
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

// ===== API KEY MANAGEMENT =====

let cachedApiKey = null;

async function getLinearApiKey() {
  const envKey = process.env.LINEAR_API_KEY;
  if (envKey && envKey.trim()) {
    return envKey.trim();
  }

  if (cachedApiKey) {
    return cachedApiKey;
  }

  try {
    const settings = await loadSettings();
    if (settings.linearApiKey && settings.linearApiKey.trim()) {
      cachedApiKey = settings.linearApiKey.trim();
      return cachedApiKey;
    }
  } catch (err) {
    // Settings load failed, continue to error
  }

  throw new Error('LINEAR_API_KEY not set. Use /linear-daemon-config --api-key <key> or set environment variable.');
}

// ===== PROJECT REF RESOLUTION =====

async function collectProjectRefWithUI(pi, ctx, args) {
  let projectId = readFlag(args, '--id');
  const projectName = readFlag(args, '--name');

  if (projectId) {
    return { projectId, projectName: projectName || null };
  }

  if (projectName) {
    try {
      const apiKey = await getLinearApiKey();
      const client = createLinearClient(apiKey);
      const resolved = await resolveProjectRef(client, projectName);
      projectId = resolved.id;
      upsertFlag(args, '--id', projectId);
      return { projectId, projectName: resolved.name };
    } catch (err) {
      throw new Error(`Failed to resolve project name '${projectName}': ${err.message}`);
    }
  }

  if (!ctx?.hasUI) {
    return null;
  }

  let projects = null;
  let apiKey = null;
  try {
    apiKey = await getLinearApiKey();
    const client = createLinearClient(apiKey);
    projects = await fetchProjects(client);
  } catch (err) {
    // API key not available or API error
  }

  if (projects && projects.length > 0 && ctx.ui.select) {
    const projectNames = projects.map((p) => p.name);
    const selectedName = await ctx.ui.select('Select a Linear project', projectNames);
    if (selectedName) {
      const selected = projects.find((p) => p.name === selectedName);
      if (selected) {
        projectId = selected.id;
        upsertFlag(args, '--id', projectId);
        upsertFlag(args, '--name', selected.name);
        return { projectId, projectName: selected.name };
      }
    }
    return null;
  }

  const input = await promptInput(ctx, 'Linear project name or ID');
  if (!input) {
    if (ctx?.hasUI) {
      if (!apiKey) {
        ctx.ui.notify('LINEAR_API_KEY not set. Use /linear-daemon-config --api-key <key> to store it in settings.', 'error');
      } else {
        ctx.ui.notify('Please enter a project name or ID', 'error');
      }
    }
    return null;
  }

  if (/^[a-zA-Z0-9-]+$/.test(input) && !apiKey) {
    upsertFlag(args, '--id', input);
    return { projectId: input, projectName: null };
  }

  if (apiKey) {
    try {
      const client = createLinearClient(apiKey);
      const resolved = await resolveProjectRef(client, input);
      upsertFlag(args, '--id', resolved.id);
      upsertFlag(args, '--name', resolved.name);
      return { projectId: resolved.id, projectName: resolved.name };
    } catch (resolveErr) {
      throw new Error(`Project not found: ${input}`);
    }
  }

  upsertFlag(args, '--id', input);
  return { projectId: input, projectName: null };
}

async function collectSetupArgsWithUI(pi, ctx, args) {
  await collectProjectRefWithUI(pi, ctx, args);

  if (!readFlag(args, '--id')) return;

  if (!readFlag(args, '--repo-path')) {
    const cwd = process.cwd();
    const repoPath = await promptInput(ctx, 'Repository absolute path', cwd);
    upsertFlag(args, '--repo-path', repoPath || cwd);
  }

  if (!readFlag(args, '--assignee')) {
    const assignee = await promptSelectAssignee(ctx, 'me');
    if (assignee) upsertFlag(args, '--assignee', assignee);
  }

  if (!readFlag(args, '--open-states')) {
    const openStates = await promptInput(ctx, 'Open states (comma-separated)', 'Todo, In Progress');
    if (openStates) upsertFlag(args, '--open-states', openStates);
  }
}

async function collectReconfigureArgsWithUI(pi, ctx, args) {
  const projectRef = await collectProjectRefWithUI(pi, ctx, args);
  if (!projectRef) {
    if (!ctx?.hasUI) return null;
    return null;
  }

  const projectId = projectRef.projectId;
  const settings = await loadSettings();
  const existing = settings.projects?.[projectId] || null;
  if (!existing) {
    throw new Error(`Project daemon does not exist for projectId=${projectId}. Run setup first.`);
  }

  if (!ctx?.hasUI) return existing;

  if (!readFlag(args, '--repo-path')) {
    const repoPath = await promptInput(ctx, 'Repository absolute path', existing.repo?.path || '');
    if (repoPath) upsertFlag(args, '--repo-path', repoPath);
  }

  if (!readFlag(args, '--assignee')) {
    const assignee = await promptSelectAssignee(ctx, existing.scope?.assignee || 'me');
    if (assignee) upsertFlag(args, '--assignee', assignee);
  }

  if (!readFlag(args, '--open-states')) {
    const openStates = await promptInput(
      ctx,
      'Open states (comma-separated)',
      (existing.scope?.openStates || ['Todo', 'In Progress']).join(',')
    );
    if (openStates) upsertFlag(args, '--open-states', openStates);
  }

  return existing;
}

// ===== TEAM RESOLUTION =====

/**
 * Resolve default team from settings
 * Lookup order: project team -> global defaultTeam -> null
 * @param {string|null} projectId - Project ID to look up team for
 * @returns {Promise<string|null>} Team key/name or null if not configured
 */
async function resolveDefaultTeam(projectId) {
  const settings = await loadSettings();

  // Check project-level team first
  if (projectId && settings.projects?.[projectId]?.scope?.team) {
    return settings.projects[projectId].scope.team;
  }

  // Fall back to global default
  return settings.defaultTeam || null;
}

// ===== GIT OPERATIONS =====

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

// ===== RESULT FORMATTING =====

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

// ===== TOOL REGISTRATION =====

function registerLinearTools(pi) {
  if (typeof pi.registerTool !== 'function') return;

  // ===== LINEAR ISSUE TOOL =====
  pi.registerTool({
    name: 'linear_issue',
    label: 'Linear Issue',
    description: 'Interact with Linear issues. Actions: list, view, create, update, comment, start',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'view', 'create', 'update', 'comment', 'start'],
          description: 'Action to perform on the issue(s)',
        },
        // Issue identification (for view, update, comment, start)
        issue: {
          type: 'string',
          description: 'Issue key (ABC-123) or Linear issue ID (for view, update, comment, start)',
        },
        // List parameters
        project: {
          type: 'string',
          description: 'Project name or ID for listing/creating issues (default: current repo directory name)',
        },
        states: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by state names for listing (e.g., ["Todo", "In Progress"])',
        },
        assignee: {
          type: 'string',
          description: 'Assignee filter for listing: "me" for current user, "all" for all (default: all)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of issues to list (default: 50)',
        },
        // View parameters
        includeComments: {
          type: 'boolean',
          description: 'Include comments when viewing issue (default: true)',
        },
        // Create/Update parameters
        title: {
          type: 'string',
          description: 'Issue title (required for create, optional for update)',
        },
        description: {
          type: 'string',
          description: 'Issue description in markdown (for create, update)',
        },
        priority: {
          type: 'number',
          description: 'Priority 0..4 (for create, update)',
        },
        state: {
          type: 'string',
          description: 'Target state name or ID (for create, update)',
        },
        // Create-specific parameters
        team: {
          type: 'string',
          description: 'Team key (e.g., "ENG") or name (optional if default team configured)',
        },
        parentId: {
          type: 'string',
          description: 'Parent issue ID for creating sub-issues (for create)',
        },
        // Create/Update assignee
        assignee: {
          type: 'string',
          description: 'Assignee: "me" for current user, or assignee ID (for create, update)',
        },
        // Comment parameters
        body: {
          type: 'string',
          description: 'Comment body in markdown (for comment)',
        },
        parentCommentId: {
          type: 'string',
          description: 'Parent comment ID for reply (for comment)',
        },
        // Start parameters
        branch: {
          type: 'string',
          description: 'Custom branch name override (for start)',
        },
        fromRef: {
          type: 'string',
          description: 'Git ref to branch from (default: HEAD, for start)',
        },
        onBranchExists: {
          type: 'string',
          enum: ['switch', 'suffix'],
          description: 'When branch exists: switch to it or create suffixed branch (for start)',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(_toolCallId, params) {
      const apiKey = await getLinearApiKey();
      const client = createLinearClient(apiKey);

      switch (params.action) {
        case 'list':
          return await executeIssueList(client, params);

        case 'view':
          return await executeIssueView(client, params);

        case 'create':
          return await executeIssueCreate(client, params);

        case 'update':
          return await executeIssueUpdate(client, params);

        case 'comment':
          return await executeIssueComment(client, params);

        case 'start':
          return await executeIssueStart(client, pi, params);

        default:
          throw new Error(`Unknown action: ${params.action}`);
      }
    },
  });

  // ===== LINEAR PROJECT TOOL =====
  pi.registerTool({
    name: 'linear_project',
    label: 'Linear Project',
    description: 'Interact with Linear projects. Actions: list',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list'],
          description: 'Action to perform on the project(s)',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(_toolCallId, params) {
      const apiKey = await getLinearApiKey();
      const client = createLinearClient(apiKey);

      switch (params.action) {
        case 'list':
          return await executeProjectList(client);

        default:
          throw new Error(`Unknown action: ${params.action}`);
      }
    },
  });

  // ===== LINEAR MILESTONE TOOL =====
  pi.registerTool({
    name: 'linear_milestone',
    label: 'Linear Milestone',
    description: 'Interact with Linear project milestones. Actions: list, view, create, update',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'view', 'create', 'update'],
          description: 'Action to perform on the milestone(s)',
        },
        // Milestone identification (for view, update)
        milestone: {
          type: 'string',
          description: 'Milestone ID (for view, update)',
        },
        // Project reference (for list, create)
        project: {
          type: 'string',
          description: 'Project name or ID (for list, create)',
        },
        // Create/Update parameters
        name: {
          type: 'string',
          description: 'Milestone name (required for create, optional for update)',
        },
        description: {
          type: 'string',
          description: 'Milestone description in markdown',
        },
        targetDate: {
          type: 'string',
          description: 'Target completion date (ISO 8601 format, e.g., 2024-03-15)',
        },
        status: {
          type: 'string',
          enum: ['backlogged', 'planned', 'inProgress', 'paused', 'completed', 'cancelled'],
          description: 'Milestone status',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(_toolCallId, params) {
      const apiKey = await getLinearApiKey();
      const client = createLinearClient(apiKey);

      switch (params.action) {
        case 'list':
          return await executeMilestoneList(client, params);

        case 'view':
          return await executeMilestoneView(client, params);

        case 'create':
          return await executeMilestoneCreate(client, params);

        case 'update':
          return await executeMilestoneUpdate(client, params);

        default:
          throw new Error(`Unknown action: ${params.action}`);
      }
    },
  });
}

// ===== ACTION IMPLEMENTATIONS =====

async function executeIssueList(client, params) {
  // Resolve project reference
  let projectRef = params.project;
  if (!projectRef) {
    projectRef = process.cwd().split('/').pop();
  }

  const resolved = await resolveProjectRef(client, projectRef);

  // Resolve assignee if "me" is specified
  let assigneeId = null;
  if (params.assignee === 'me') {
    const viewer = await client.viewer;
    assigneeId = viewer.id;
  }

  // Fetch issues
  const { issues, truncated } = await fetchIssuesByProject(
    client,
    resolved.id,
    params.states || null,
    {
      assigneeId,
      limit: params.limit || 50,
    }
  );

  // Format output
  if (issues.length === 0) {
    return toTextResult(`No issues found in project "${resolved.name}"`, {
      projectId: resolved.id,
      projectName: resolved.name,
      issueCount: 0,
    });
  }

  const lines = [`## Issues in project "${resolved.name}" (${issues.length}${truncated ? '+' : ''})\n`];

  for (const issue of issues) {
    const stateLabel = issue.state?.name || 'Unknown';
    const assigneeLabel = issue.assignee?.displayName || 'Unassigned';
    const priorityLabel = issue.priority !== undefined && issue.priority !== null
      ? ['None', 'Urgent', 'High', 'Medium', 'Low'][issue.priority] || `P${issue.priority}`
      : null;

    const metaParts = [`[${stateLabel}]`, `@${assigneeLabel}`];
    if (priorityLabel) metaParts.push(priorityLabel);

    lines.push(`- **${issue.identifier}**: ${issue.title} _${metaParts.join(' ')}_`);
  }

  if (truncated) {
    lines.push('\n_Results may be truncated. Use limit parameter to fetch more._');
  }

  return toTextResult(lines.join('\n'), {
    projectId: resolved.id,
    projectName: resolved.name,
    issueCount: issues.length,
    truncated,
  });
}

async function executeIssueView(client, params) {
  const issue = ensureNonEmpty(params.issue, 'issue');
  const includeComments = params.includeComments !== false;

  const issueData = await fetchIssueDetails(client, issue, { includeComments });
  const markdown = formatIssueAsMarkdown(issueData, { includeComments });

  return {
    content: [{ type: 'text', text: markdown }],
    details: {
      issueId: issueData.id,
      identifier: issueData.identifier,
      title: issueData.title,
      state: issueData.state,
      url: issueData.url,
    },
  };
}

async function executeIssueCreate(client, params) {
  const title = ensureNonEmpty(params.title, 'title');

  // Resolve project first (needed for team lookup)
  let projectRef = params.project;
  if (!projectRef) {
    projectRef = process.cwd().split('/').pop();
  }

  let projectId = null;
  let resolvedProject = null;
  try {
    resolvedProject = await resolveProjectRef(client, projectRef);
    projectId = resolvedProject.id;
  } catch (err) {
    // Project not found - continue without project
  }

  // Resolve team: explicit param -> project setting -> global default -> error
  let teamRef = params.team;
  if (!teamRef) {
    teamRef = await resolveDefaultTeam(projectId);
  }

  if (!teamRef) {
    throw new Error('Missing required field: team. Set a default with /linear-daemon-config --default-team <team-key> or provide team parameter.');
  }

  // Resolve team
  const team = await resolveTeamRef(client, teamRef);

  // Build create input
  const createInput = {
    teamId: team.id,
    title,
  };

  if (params.description) {
    createInput.description = params.description;
  }

  if (params.priority !== undefined && params.priority !== null) {
    createInput.priority = params.priority;
  }

  if (params.parentId) {
    createInput.parentId = params.parentId;
  }

  // Resolve assignee if "me" is specified
  if (params.assignee === 'me') {
    const viewer = await client.viewer;
    createInput.assigneeId = viewer.id;
  } else if (params.assignee) {
    createInput.assigneeId = params.assignee;
  }

  // Resolve state if specified
  if (params.state) {
    const states = await getTeamWorkflowStates(client, team.id);
    const target = params.state.trim().toLowerCase();
    const state = states.find(s => s.name.toLowerCase() === target || s.id === params.state);
    if (state) {
      createInput.stateId = state.id;
    }
  }

  // Set project if resolved
  if (resolvedProject) {
    createInput.projectId = resolvedProject.id;
  }

  const issue = await createIssue(client, createInput);

  const identifier = issue.identifier || issue.id || 'unknown';
  const projectLabel = issue.project?.name || 'No project';
  const priorityLabel = issue.priority !== undefined && issue.priority !== null
    ? ['None', 'Urgent', 'High', 'Medium', 'Low'][issue.priority] || `P${issue.priority}`
    : null;
  const stateLabel = issue.state?.name || 'Unknown';
  const assigneeLabel = issue.assignee?.displayName || 'Unassigned';

  const metaParts = [`Team: ${team.name}`, `Project: ${projectLabel}`, `State: ${stateLabel}`, `Assignee: ${assigneeLabel}`];
  if (priorityLabel) metaParts.push(`Priority: ${priorityLabel}`);

  return toTextResult(
    `Created issue **${identifier}**: ${issue.title}\n${metaParts.join(' | ')}`,
    {
      issueId: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      team: issue.team,
      project: issue.project,
      state: issue.state,
      assignee: issue.assignee,
      url: issue.url,
    }
  );
}

async function executeIssueUpdate(client, params) {
  const issue = ensureNonEmpty(params.issue, 'issue');

  const result = await updateIssue(client, issue, {
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
}

async function executeIssueComment(client, params) {
  const issue = ensureNonEmpty(params.issue, 'issue');
  const body = ensureNonEmpty(params.body, 'body');
  const result = await addIssueComment(client, issue, body, params.parentCommentId);

  return toTextResult(
    `Added comment to issue ${result.issue.identifier}`,
    {
      issueId: result.issue.id,
      identifier: result.issue.identifier,
      commentId: result.comment.id,
    }
  );
}

async function executeIssueStart(client, pi, params) {
  const issue = ensureNonEmpty(params.issue, 'issue');
  const prepared = await prepareIssueStart(client, issue);

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
    client,
    prepared.issue.id,
    prepared.startedState.id
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
}

async function executeProjectList(client) {
  const projects = await fetchProjects(client);

  if (projects.length === 0) {
    return toTextResult('No projects found', { projectCount: 0 });
  }

  const lines = [`## Projects (${projects.length})\n`];

  for (const project of projects) {
    lines.push(`- **${project.name}** \`${project.id}\``);
  }

  return toTextResult(lines.join('\n'), {
    projectCount: projects.length,
    projects: projects.map(p => ({ id: p.id, name: p.name })),
  });
}

// ===== MILESTONE ACTION IMPLEMENTATIONS =====

async function executeMilestoneList(client, params) {
  // Resolve project reference
  let projectRef = params.project;
  if (!projectRef) {
    projectRef = process.cwd().split('/').pop();
  }

  const resolved = await resolveProjectRef(client, projectRef);

  // Fetch milestones
  const milestones = await fetchProjectMilestones(client, resolved.id);

  // Format output
  if (milestones.length === 0) {
    return toTextResult(`No milestones found in project "${resolved.name}"`, {
      projectId: resolved.id,
      projectName: resolved.name,
      milestoneCount: 0,
    });
  }

  const lines = [`## Milestones in project "${resolved.name}" (${milestones.length})\n`];

  // Sort by order
  const sorted = [...milestones].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  for (const milestone of sorted) {
    const statusEmoji = {
      backlogged: '📋',
      planned: '📅',
      inProgress: '🚀',
      paused: '⏸️',
      completed: '✅',
      cancelled: '❌',
    }[milestone.status] || '📌';

    const progressLabel = milestone.progress !== undefined && milestone.progress !== null
      ? `${milestone.progress}%`
      : 'N/A';

    const dateLabel = milestone.targetDate
      ? ` → ${milestone.targetDate.split('T')[0]}`
      : '';

    lines.push(`- ${statusEmoji} **${milestone.name}** _[${milestone.status}]_ (${progressLabel})${dateLabel}`);
    if (milestone.description) {
      lines.push(`  ${milestone.description.split('\n')[0].slice(0, 100)}${milestone.description.length > 100 ? '...' : ''}`);
    }
  }

  return toTextResult(lines.join('\n'), {
    projectId: resolved.id,
    projectName: resolved.name,
    milestoneCount: milestones.length,
    milestones: milestones.map(m => ({ id: m.id, name: m.name, status: m.status, progress: m.progress })),
  });
}

async function executeMilestoneView(client, params) {
  const milestoneId = ensureNonEmpty(params.milestone, 'milestone');

  const milestoneData = await fetchMilestoneDetails(client, milestoneId);

  // Format as markdown
  const lines = [];

  // Title
  lines.push(`# Milestone: ${milestoneData.name}`);

  // Meta information
  const metaParts = [];
  if (milestoneData.project?.name) {
    metaParts.push(`**Project:** ${milestoneData.project.name}`);
  }
  metaParts.push(`**Status:** ${milestoneData.status}`);
  if (milestoneData.progress !== undefined && milestoneData.progress !== null) {
    metaParts.push(`**Progress:** ${milestoneData.progress}%`);
  }
  if (milestoneData.targetDate) {
    metaParts.push(`**Target Date:** ${milestoneData.targetDate.split('T')[0]}`);
  }

  if (metaParts.length > 0) {
    lines.push('');
    lines.push(metaParts.join(' | '));
  }

  // Description
  if (milestoneData.description) {
    lines.push('');
    lines.push(milestoneData.description);
  }

  // Issues
  if (milestoneData.issues?.length > 0) {
    lines.push('');
    lines.push(`## Issues (${milestoneData.issues.length})`);
    lines.push('');

    for (const issue of milestoneData.issues) {
      const stateLabel = issue.state?.name || 'Unknown';
      const assigneeLabel = issue.assignee?.displayName || 'Unassigned';
      const priorityLabel = issue.priority !== undefined && issue.priority !== null
        ? ['None', 'Urgent', 'High', 'Medium', 'Low'][issue.priority] || `P${issue.priority}`
        : null;

      const metaParts = [`[${stateLabel}]`, `@${assigneeLabel}`];
      if (priorityLabel) metaParts.push(priorityLabel);
      if (issue.estimate !== undefined && issue.estimate !== null) metaParts.push(`${issue.estimate}pt`);

      lines.push(`- **${issue.identifier}**: ${issue.title} _${metaParts.join(' ')}_`);
    }
  } else {
    lines.push('');
    lines.push('_No issues associated with this milestone._');
  }

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    details: {
      milestoneId: milestoneData.id,
      name: milestoneData.name,
      status: milestoneData.status,
      progress: milestoneData.progress,
      project: milestoneData.project,
      issueCount: milestoneData.issues?.length || 0,
    },
  };
}

async function executeMilestoneCreate(client, params) {
  const name = ensureNonEmpty(params.name, 'name');

  // Resolve project reference
  let projectRef = params.project;
  if (!projectRef) {
    projectRef = process.cwd().split('/').pop();
  }

  const resolved = await resolveProjectRef(client, projectRef);

  // Build create input
  const createInput = {
    projectId: resolved.id,
    name,
  };

  if (params.description) {
    createInput.description = params.description;
  }

  if (params.targetDate) {
    createInput.targetDate = params.targetDate;
  }

  if (params.status) {
    createInput.status = params.status;
  }

  const milestone = await createProjectMilestone(client, createInput);

  const statusEmoji = {
    backlogged: '📋',
    planned: '📅',
    inProgress: '🚀',
    paused: '⏸️',
    completed: '✅',
    cancelled: '❌',
  }[milestone.status] || '📌';

  return toTextResult(
    `Created milestone ${statusEmoji} **${milestone.name}** _[${milestone.status}]_ in project "${resolved.name}"`,
    {
      milestoneId: milestone.id,
      name: milestone.name,
      status: milestone.status,
      project: milestone.project,
    }
  );
}

async function executeMilestoneUpdate(client, params) {
  const milestoneId = ensureNonEmpty(params.milestone, 'milestone');

  const result = await updateProjectMilestone(client, milestoneId, {
    name: params.name,
    description: params.description,
    targetDate: params.targetDate,
    status: params.status,
  });

  const friendlyChanges = result.changed;
  const suffix = friendlyChanges.length > 0
    ? ` (${friendlyChanges.join(', ')})`
    : '';

  const statusEmoji = {
    backlogged: '📋',
    planned: '📅',
    inProgress: '🚀',
    paused: '⏸️',
    completed: '✅',
    cancelled: '❌',
  }[result.milestone.status] || '📌';

  return toTextResult(
    `Updated milestone ${statusEmoji} **${result.milestone.name}**${suffix}`,
    {
      milestoneId: result.milestone.id,
      name: result.milestone.name,
      status: result.milestone.status,
      changed: friendlyChanges,
    }
  );
}

// ===== EXTENSION ENTRY POINT =====

export default function piLinearServiceExtension(pi) {
  registerLinearTools(pi);

  pi.registerCommand('linear-daemon-setup', {
    description: 'Interactive setup for project daemon config (use --id or --name, or run interactively)',
    handler: async (argsText, ctx) => {
      const args = parseArgs(argsText);
      await collectSetupArgsWithUI(pi, ctx, args);

      if (!readFlag(args, '--id')) {
        return;
      }

      const effective = effectiveConfigFromArgs(args);
      effective.openStates = effective.openStates.length > 0 ? effective.openStates : ['Todo', 'In Progress'];
      validateProjectConfigInput(effective);

      return withCommandFeedback(ctx, 'Setup complete', async () => {
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

      return withCommandFeedback(ctx, 'Reconfigured', async () => {
        await reconfigureProjectDaemon(args);
      });
    },
  });

  pi.registerCommand('linear-daemon-status', {
    description: 'Show daemon config status (optional: --id or --name for specific project)',
    handler: async (argsText, ctx) => {
      const args = parseArgs(argsText);

      try {
        await collectProjectRefWithUI(pi, ctx, args);
      } catch {
        // If user cancels, just show all projects
      }

      return withCommandFeedback(ctx, 'Status retrieved', async () => {
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

      return withCommandFeedback(ctx, 'Disabled', async () => {
        await disableProjectDaemon(args);
      });
    },
  });

  pi.registerCommand('linear-daemon-start', {
    description: 'Start systemd user service for pi-linear-service',
    handler: async (argsText, ctx) => withCommandFeedback(ctx, 'Started', async () => {
      await daemonStart(parseArgs(argsText));
    }),
  });

  pi.registerCommand('linear-daemon-stop', {
    description: 'Stop systemd user service for pi-linear-service',
    handler: async (argsText, ctx) => withCommandFeedback(ctx, 'Stopped', async () => {
      await daemonStop(parseArgs(argsText));
    }),
  });

  pi.registerCommand('linear-daemon-restart', {
    description: 'Restart systemd user service for pi-linear-service',
    handler: async (argsText, ctx) => withCommandFeedback(ctx, 'Restarted', async () => {
      await daemonRestart(parseArgs(argsText));
    }),
  });

  pi.registerCommand('linear-daemon-install', {
    description: 'Install systemd user service for pi-linear-service',
    handler: async (argsText, ctx) => withCommandFeedback(ctx, 'Service installed', async () => {
      await daemonInstall(parseArgs(argsText));
    }),
  });

  pi.registerCommand('linear-daemon-config', {
    description: 'Configure extension settings (API key, default team, etc.)',
    handler: async (argsText, ctx) => {
      const args = parseArgs(argsText);
      const apiKey = readFlag(args, '--api-key');
      const defaultTeam = readFlag(args, '--default-team');
      const projectTeam = readFlag(args, '--team');
      const projectName = readFlag(args, '--project');

      // Set API key
      if (apiKey) {
        const settings = await loadSettings();
        settings.linearApiKey = apiKey;
        await saveSettings(settings);
        cachedApiKey = null;
        if (ctx?.hasUI) {
          ctx.ui.notify('LINEAR_API_KEY saved to settings', 'info');
        }
        return;
      }

      // Set global default team
      if (defaultTeam) {
        const settings = await loadSettings();
        settings.defaultTeam = defaultTeam;
        await saveSettings(settings);
        if (ctx?.hasUI) {
          ctx.ui.notify(`Default team set to: ${defaultTeam}`, 'info');
        }
        return;
      }

      // Set project-level team
      if (projectTeam && projectName) {
        const settings = await loadSettings();

        // Resolve project ID if we have API key
        let projectId = projectName;
        try {
          const apiKey = await getLinearApiKey();
          const client = createLinearClient(apiKey);
          const resolved = await resolveProjectRef(client, projectName);
          projectId = resolved.id;
        } catch {
          // Use projectName as-is (might be a project ID)
        }

        if (!settings.projects[projectId]) {
          settings.projects[projectId] = {
            enabled: false,
            scope: {},
            repo: {},
            runtime: {},
          };
        }
        if (!settings.projects[projectId].scope) {
          settings.projects[projectId].scope = {};
        }
        settings.projects[projectId].scope.team = projectTeam;
        await saveSettings(settings);
        if (ctx?.hasUI) {
          ctx.ui.notify(`Team for project "${projectName}" set to: ${projectTeam}`, 'info');
        }
        return;
      }

      // Show current config
      const settings = await loadSettings();
      const hasKey = !!(settings.linearApiKey || process.env.LINEAR_API_KEY);
      const keySource = process.env.LINEAR_API_KEY ? 'environment' : (settings.linearApiKey ? 'settings' : 'not set');

      pi.sendMessage({
        customType: 'pi-linear-service',
        content: `Configuration:
  LINEAR_API_KEY: ${hasKey ? 'configured' : 'not set'} (source: ${keySource})
  Default team: ${settings.defaultTeam || 'not set'}

Commands:
  /linear-daemon-config --api-key lin_xxx
  /linear-daemon-config --default-team inno-cli
  /linear-daemon-config --team inno-cli --project pi-linear-service

Note: Environment variable takes precedence over settings file.`,
        display: true,
      });
    },
  });

  pi.registerCommand('linear-daemon-help', {
    description: 'Show pi-linear-service daemon commands',
    handler: async (_args, ctx) => {
      const lines = [
        '/linear-daemon-config --api-key <key>  (store LINEAR_API_KEY)',
        '/linear-daemon-install  (install systemd service)',
        '/linear-daemon-setup [--id <id> | --name <name>]',
        '/linear-daemon-reconfigure [--id <id> | --name <name>]',
        '/linear-daemon-status [--id <id> | --name <name>]  (shows all if no project)',
        '/linear-daemon-disable --id <id> | --name <name>',
        '/linear-daemon-start',
        '/linear-daemon-stop',
        '/linear-daemon-restart',
        '',
        'Note: --name requires LINEAR_API_KEY (set via /linear-daemon-config or env)',
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
