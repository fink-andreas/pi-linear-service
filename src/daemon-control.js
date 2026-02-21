import { info } from './logger.js';
import { loadSettings, saveSettings } from './settings.js';
import {
  getDefaultUnitName,
  isServiceActive,
  restartService,
  startService,
  stopService,
} from './service-cli.js';

function parseFlagValue(args, names, fallback = undefined) {
  for (let i = 0; i < args.length; i += 1) {
    if (names.includes(args[i]) && args[i + 1]) return args[i + 1];
  }
  return fallback;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function parseList(argValue, fallback = []) {
  if (!argValue) return fallback;
  return argValue.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseIntOrUndefined(v) {
  if (v === undefined) return undefined;
  const parsed = parseInt(v, 10);
  if (Number.isNaN(parsed)) throw new Error(`Invalid numeric value: ${v}`);
  return parsed;
}

function ensureProjectId(projectId) {
  if (!projectId || !projectId.trim()) {
    throw new Error('Missing required argument --id');
  }
}

function buildProjectConfigFromArgs(args, existing = null) {
  const projectName = parseFlagValue(args, ['--name']);
  const repoPath = parseFlagValue(args, ['--repo-path']);
  const openStatesArg = parseFlagValue(args, ['--open-states']);
  const assignee = parseFlagValue(args, ['--assignee'], existing?.scope?.assignee || 'me');
  const enabled = hasFlag(args, '--disabled') ? false : true;

  const pollIntervalSec = parseIntOrUndefined(parseFlagValue(args, ['--poll-interval-sec']));
  const timeoutMs = parseIntOrUndefined(parseFlagValue(args, ['--timeout-ms']));
  const restartCooldownSec = parseIntOrUndefined(parseFlagValue(args, ['--restart-cooldown-sec']));
  const provider = parseFlagValue(args, ['--provider'], existing?.runtime?.provider);
  const model = parseFlagValue(args, ['--model'], existing?.runtime?.model);

  const next = {
    enabled,
    projectName: projectName || existing?.projectName,
    scope: {
      assignee,
      openStates: parseList(openStatesArg, existing?.scope?.openStates || ['Todo', 'In Progress']),
    },
    repo: {
      path: repoPath || existing?.repo?.path,
    },
    runtime: {
      ...(existing?.runtime || {}),
      ...(pollIntervalSec !== undefined ? { pollIntervalSec } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(restartCooldownSec !== undefined ? { restartCooldownSec } : {}),
      ...(provider !== undefined ? { provider } : {}),
      ...(model !== undefined ? { model } : {}),
    },
  };

  if (!next.repo.path) {
    throw new Error('Missing required argument --repo-path (explicit mapping required)');
  }

  return next;
}

function getControlOptions(args) {
  return {
    unitName: parseFlagValue(args, ['--unit-name'], getDefaultUnitName()),
    noSystemctl: hasFlag(args, '--no-systemctl'),
  };
}

async function applyRuntimeChange(actionName, options) {
  if (options.noSystemctl) {
    info(`Skipped runtime ${actionName} (--no-systemctl)`);
    return;
  }
  await restartService(['--unit-name', options.unitName]);
}

export async function setupProjectDaemon(args = []) {
  const projectId = parseFlagValue(args, ['--id']);
  ensureProjectId(projectId);

  const settings = await loadSettings();
  const existing = settings.projects?.[projectId] || null;
  const projectCfg = buildProjectConfigFromArgs(args, existing);

  settings.projects = settings.projects || {};
  settings.projects[projectId] = projectCfg;

  const settingsPath = await saveSettings(settings);
  const options = getControlOptions(args);
  await applyRuntimeChange('reconfigure', options);

  info('Project daemon configured', {
    projectId,
    enabled: projectCfg.enabled,
    repoPath: projectCfg.repo.path,
    settingsPath,
    unitName: options.unitName,
  });
}

export async function reconfigureProjectDaemon(args = []) {
  const projectId = parseFlagValue(args, ['--id']);
  ensureProjectId(projectId);

  const settings = await loadSettings();
  const existing = settings.projects?.[projectId];
  if (!existing) {
    throw new Error(`Project daemon does not exist for projectId=${projectId}. Run setup first.`);
  }

  settings.projects[projectId] = buildProjectConfigFromArgs(args, existing);
  const settingsPath = await saveSettings(settings);

  const options = getControlOptions(args);
  await applyRuntimeChange('reconfigure', options);

  info('Project daemon reconfigured', {
    projectId,
    settingsPath,
    unitName: options.unitName,
  });
}

export async function disableProjectDaemon(args = []) {
  const projectId = parseFlagValue(args, ['--id']);
  ensureProjectId(projectId);

  const settings = await loadSettings();
  const existing = settings.projects?.[projectId];
  if (!existing) {
    throw new Error(`Project daemon does not exist for projectId=${projectId}`);
  }

  existing.enabled = false;
  const settingsPath = await saveSettings(settings);

  const options = getControlOptions(args);
  await applyRuntimeChange('disable', options);

  info('Project daemon disabled', {
    projectId,
    settingsPath,
    unitName: options.unitName,
  });
}

export async function daemonStatus(args = []) {
  const projectId = parseFlagValue(args, ['--id']);
  const settings = await loadSettings();
  const options = getControlOptions(args);
  const serviceActive = options.noSystemctl ? null : isServiceActive(['--unit-name', options.unitName]);

  // If no project specified, show status for all configured projects
  if (!projectId) {
    const projects = settings.projects || {};
    const projectList = Object.entries(projects).map(([id, cfg]) => ({
      projectId: id,
      configured: true,
      enabled: cfg.enabled !== false,
      projectName: cfg.projectName || null,
      repo: cfg.repo || null,
    }));

    console.log(JSON.stringify({
      serviceActive,
      projectCount: projectList.length,
      projects: projectList,
    }, null, 2));
    return;
  }

  const cfg = settings.projects?.[projectId];

  if (!cfg) {
    console.log(JSON.stringify({ projectId, configured: false, serviceActive }, null, 2));
    return;
  }

  console.log(JSON.stringify({
    projectId,
    configured: true,
    serviceActive,
    enabled: cfg.enabled !== false,
    projectName: cfg.projectName || null,
    scope: cfg.scope || null,
    repo: cfg.repo || null,
    runtime: cfg.runtime || null,
  }, null, 2));
}

export async function daemonStart(args = []) {
  const options = getControlOptions(args);
  if (options.noSystemctl) {
    info('Skipped daemon start (--no-systemctl)', { unitName: options.unitName });
    return;
  }
  await startService(['--unit-name', options.unitName]);
}

export async function daemonStop(args = []) {
  const options = getControlOptions(args);
  if (options.noSystemctl) {
    info('Skipped daemon stop (--no-systemctl)', { unitName: options.unitName });
    return;
  }
  await stopService(['--unit-name', options.unitName]);
}

export async function daemonRestart(args = []) {
  const options = getControlOptions(args);
  if (options.noSystemctl) {
    info('Skipped daemon restart (--no-systemctl)', { unitName: options.unitName });
    return;
  }
  await restartService(['--unit-name', options.unitName]);
}
