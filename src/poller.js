/**
 * Polling loop implementation
 */

import { info, debug, error as logError, warn } from './logger.js';
import { setLogLevel } from './logger.js';
import { runSmokeQuery, fetchAssignedIssues, groupIssuesByProject } from './linear.js';
import { createSessionManager, attemptKillUnhealthySession } from './session-manager.js';
import { RpcSessionManager } from './rpc-session-manager.js';

/**
 * Perform a single poll
 * @param {Object} config - Configuration object
 * @param {Object} sessionManager - Session manager instance
 */
async function performPoll(config, sessionManager) {
  const pollStartTimestamp = Date.now();
  info('Poll started');

  // Initialize poll metrics
  const metrics = {
    issueCount: 0,
    projectCount: 0,
    sessionsCreated: 0,
    sessionsChecked: 0,
    unhealthyDetected: 0,
    sessionsKilled: 0,
    errors: []
  };

  // INN-159: Run a simple query and log success/failure cleanly.
  // IMPORTANT: Never throw here on transient API failures (daemon must keep running).
  let viewerId = config.assigneeId;
  try {
    debug('Running Linear API smoke test query...');
    const viewer = await runSmokeQuery(config.linearApiKey);
    debug('Linear API smoke query successful', {
      viewerId: viewer?.id,
      viewerName: viewer?.name,
    });
    // Use viewer ID from smoke test if ASSIGNEE_ID is not a valid UUID format
    // Linear user IDs are UUIDs (e.g., 536c7744-75f7-4403-854f-43bca171d0fa)
    if (viewer?.id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(config.assigneeId)) {
      info('Using viewer ID from Linear API instead of ASSIGNEE_ID', {
        configAssigneeId: config.assigneeId,
        actualViewerId: viewer.id,
      });
      viewerId = viewer.id;
    }
  } catch (err) {
    logError('Linear API smoke query failed', {
      error: err?.message || String(err),
    });
    metrics.errors.push('Linear API smoke query failed');
  }

  // INN-160: Query assigned issues in open states (up to LINEAR_PAGE_LIMIT)
  let byProject = new Map();
  try {
    info('Fetching assigned issues in open states...', {
      assigneeId: viewerId,
      openStates: config.linearOpenStates,
      limit: config.linearPageLimit,
    });

    const { issues, truncated } = await fetchAssignedIssues(
      config.linearApiKey,
      viewerId,
      config.linearOpenStates,
      config.linearPageLimit
    );

    metrics.issueCount = issues.length;
    info('Fetched assigned issues', {
      issueCount: issues.length,
      truncated,
    });

    byProject = groupIssuesByProject(issues);
    metrics.projectCount = byProject.size;
    info('Projects with qualifying issues', {
      projectCount: byProject.size,
      projects: Array.from(byProject.keys()),
    });
  } catch (err) {
    logError('Failed to fetch assigned issues', {
      error: err?.message || String(err),
    });
    metrics.errors.push('Failed to fetch assigned issues');
  }

  // INN-166: Create sessions for projects with qualifying issues (idempotent)
  try {
    const createdCount = await createSessionsForProjects(byProject, config, sessionManager);
    metrics.sessionsCreated = createdCount;
    info('Session creation completed', { createdCount });
  } catch (err) {
    logError('Failed to create sessions', {
      error: err?.message || String(err),
    });
    metrics.errors.push('Failed to create sessions');
  }

  // INN-168: Check and kill unhealthy owned sessions
  // RPC mode: handled via RPC timeouts + abort/restart, skip legacy health checks.
  if ((config.mode || 'rpc') !== 'rpc') {
    try {
      const healthCheckResult = await checkAndKillUnhealthySessions(config, sessionManager);
      metrics.sessionsChecked = healthCheckResult.sessionsChecked;
      metrics.unhealthyDetected = healthCheckResult.unhealthyDetected;
      metrics.sessionsKilled = healthCheckResult.killed;
      info('Health check completed', healthCheckResult);
    } catch (err) {
      logError('Failed to check/kill unhealthy sessions', {
        error: err?.message || String(err),
      });
      metrics.errors.push('Failed to check/kill unhealthy sessions');
    }
  }
  // Poll completed - log summary with all metrics
  const pollEndTimestamp = Date.now();
  const pollDurationMs = pollEndTimestamp - pollStartTimestamp;

  info('Poll completed', {
    pollDurationMs,
    pollDurationSec: (pollDurationMs / 1000).toFixed(2),
    issueCount: metrics.issueCount,
    projectCount: metrics.projectCount,
    sessionsCreated: metrics.sessionsCreated,
    sessionsChecked: metrics.sessionsChecked,
    unhealthyDetected: metrics.unhealthyDetected,
    sessionsKilled: metrics.sessionsKilled,
    errorCount: metrics.errors.length,
    errors: metrics.errors.length > 0 ? metrics.errors : undefined
  });
}

/**
 * Check if a project should be processed based on filters
 *
 * @param {string} projectId - Project ID to check
 * @param {Object} config - Configuration object
 * @returns {boolean} True if project should have a session
 */
function shouldProcessProject(projectId, projectName, config) {
  const filter = config.projectFilter || [];
  const blacklist = config.projectBlacklist || [];

  // Whitelist: only allow projects in PROJECT_FILTER
  // Accept either projectId (UUID) or projectName (human friendly) for convenience.
  if (filter.length > 0) {
    return filter.includes(projectId) || (projectName ? filter.includes(projectName) : false);
  }

  // Blacklist: exclude projects in PROJECT_BLACKLIST
  if (blacklist.length > 0) {
    return !(blacklist.includes(projectId) || (projectName ? blacklist.includes(projectName) : false));
  }

  // No filters: process all projects
  return true;
}

/**
 * Create sessions for projects with qualifying issues
 * This is idempotent - won't create duplicate sessions
 *
 * @param {Map<string, Object>} byProject - Map of projectId -> {projectName, issueCount}
 * @param {Object} config - Configuration object
 * @param {Object} sessionManager - Session manager instance
 * @returns {Promise<number>} Number of sessions created in this poll
 */
async function createSessionsForProjects(byProject, config, sessionManager) {
  let createdCount = 0;
  let filteredCount = 0;

  // RPC mode: ensure RPC sessions and (optionally) prompt one issue if idle.
  if ((config.mode || 'rpc') === 'rpc') {
    /** @type {RpcSessionManager} */
    const rpcManager = sessionManager;

    for (const [projectId, projectData] of byProject) {
      if (!shouldProcessProject(projectId, projectData.projectName, config)) {
        filteredCount++;
        debug('Project filtered out', {
          projectId,
          projectName: projectData.projectName,
          reason: 'Matches filter criteria',
        });
        continue;
      }

      const sessionName = `${config.tmuxPrefix}${projectId}`;
      const ensure = await rpcManager.ensureSession(sessionName, { projectName: projectData.projectName, projectId });
      if (ensure.error) {
        warn('RPC session ensure failed', { sessionName, projectId, error: ensure.error?.message || String(ensure.error) });
        // ensureSession already records cooldown on init failure
        continue;
      }
      if (ensure.created) createdCount++;
      if (ensure.skipped) {
        debug('RPC session ensure skipped', { sessionName, reason: ensure.reason });
        continue;
      }

      // One-at-a-time policy: only prompt when idle, and only one issue.
      const firstIssue = projectData.issues?.[0];
      if (!firstIssue) continue;

      const promptMsg = `You are working on Linear project: ${projectData.projectName} (id=${projectId}).\n` +
        `If a local git clone exists at ../${projectData.projectName}, use it as your working directory.\n` +
        `Work on this issue now: ${firstIssue.title} (issueId=${firstIssue.id}).\n` +
        `Use your Linear tools to update the issue state to Done when finished.`;

      const prompted = await rpcManager.promptIfIdle(sessionName, promptMsg);
      if (prompted.ok === false) {
        warn('RPC prompt attempt failed', { sessionName, projectId, reason: prompted.reason });
        // Timeout or other RPC errors: abort -> cooldown -> restart
        await rpcManager.abortAndRestart(sessionName, prompted.reason || 'prompt failed');
        continue;
      }

      if (prompted.prompted) {
        info('Sent prompt to RPC session', { sessionName, projectId, issueId: firstIssue.id });
      } else {
        debug('Did not prompt (not idle / not running)', { sessionName, reason: prompted.reason });
      }
    }

    if (filteredCount > 0) {
      info('Projects filtered', {
        filtered: filteredCount,
        processed: byProject.size - filteredCount,
      });
    }

    return createdCount;
  }

  // Legacy mode: original behavior (ensure sessions only)
  for (const [projectId, projectData] of byProject) {
    if (!shouldProcessProject(projectId, projectData.projectName, config)) {
      filteredCount++;
      debug('Project filtered out', {
        projectId,
        projectName: projectData.projectName,
        reason: 'Matches filter criteria',
      });
      continue;
    }

    const { projectName } = projectData;
    const sessionName = `${config.tmuxPrefix}${projectId}`;
    const result = await sessionManager.ensureSession(
      sessionName,
      projectName,
      projectData,
      config.sessionCommandTemplate,
      config.dryRun
    );

    if (result.created) {
      createdCount++;
      debug('Session created this poll', {
        sessionName,
        projectName,
        commandTemplate: config.sessionCommandTemplate,
      });
    } else if (result.existed) {
      debug('Session already exists', {
        sessionName,
        projectName,
      });
    }
  }

  if (filteredCount > 0) {
    info('Projects filtered', {
      filtered: filteredCount,
      processed: byProject.size - filteredCount,
    });
  }

  return createdCount;
}

/**
 * Check and kill unhealthy owned sessions
 *
 * @param {Object} config - Configuration object
 * @param {Object} sessionManager - Session manager instance
 * @returns {Promise<{sessionsChecked: number, unhealthyDetected: number, killed: number, skipped: number}>}
 */
async function checkAndKillUnhealthySessions(config, sessionManager) {
  // Get all sessions
  const sessions = await sessionManager.listSessions();

  let sessionsChecked = 0;
  let unhealthyDetected = 0;
  let killed = 0;
  let skipped = 0;

  for (const sessionName of sessions) {
    sessionsChecked++;

    const result = await attemptKillUnhealthySession(
      sessionName,
      config.tmuxPrefix,
      config,
      sessionManager,
      config.dryRun
    );

    if (result.reason === 'Session not owned by this service') {
      // Not owned, skip
      skipped++;
      debug('Skipping unowned session', { sessionName });
    } else if (result.reason === 'Session is healthy') {
      // Healthy, no action needed
      debug('Session is healthy', { sessionName });
    } else if (result.reason === 'SESSION_KILL_ON_UNHEALTHY is disabled') {
      // Unhealthy but kill disabled
      unhealthyDetected++;
      info('Unhealthy session detected (kill disabled)', { sessionName, reason: result.reason });
    } else if (result.reason.includes('Within cooldown period')) {
      // Unhealthy but within cooldown
      unhealthyDetected++;
      skipped++;
      info('Unhealthy session (within cooldown)', { sessionName, reason: result.reason });
    } else {
      // Unhealthy
      unhealthyDetected++;
      if (result.killed) {
        killed++;
      } else {
        skipped++;
      }
    }
  }

  return {
    sessionsChecked,
    unhealthyDetected,
    killed,
    skipped,
  };
}

/**
 * Start the polling loop
 * @param {Object} config - Configuration object
 */
export async function startPollLoop(config) {
  // Set log level from config
  setLogLevel(config.logLevel);

  // Create session manager based on configuration
  const sessionManager = (config.mode || 'rpc') === 'rpc'
    ? new RpcSessionManager({
        prefix: config.tmuxPrefix,
        timeoutMs: config.rpc?.timeoutMs ?? 120000,
        restartCooldownSec: config.rpc?.restartCooldownSec ?? config.sessionRestartCooldownSec,
        piCommand: config.rpc?.piCommand || 'pi',
        piArgs: [
          ...(config.rpc?.piArgs || []),
          ...(config.rpc?.provider ? ['--provider', config.rpc.provider] : []),
          ...(config.rpc?.model ? ['--model', config.rpc.model] : []),
        ],
        workspaceRoot: config.rpc?.workspaceRoot || null,
        projectDirOverrides: config.rpc?.projectDirOverrides || {},
      })
    : await createSessionManager(config);

  info('Session manager initialized', {
    mode: config.mode || 'rpc',
    type: (config.mode || 'rpc') === 'rpc' ? 'rpc' : (config.sessionManager?.type || 'tmux'),
  });

  if (config.dryRun) {
    info('DRY-RUN MODE: session actions will be logged but not executed');
  }

  info('Starting poll loop...', {
    pollIntervalSec: config.pollIntervalSec,
    tmuxPrefix: config.tmuxPrefix,
    mode: config.mode || 'rpc',
    dryRun: config.dryRun,
  });

  // Track if a poll is currently running
  let isPolling = false;

  // Perform initial poll on startup
  info('Performing initial poll on startup');
  isPolling = true;
  try {
    await performPoll(config, sessionManager);
  } catch (err) {
    logError('Initial poll failed', {
      error: err?.message || String(err),
    });
  } finally {
    isPolling = false;
  }

  // Set up interval for polling
  const pollIntervalMs = config.pollIntervalSec * 1000;

  // Start the interval timer
  const intervalId = setInterval(() => {
    if (isPolling) {
      // Skip this tick if a poll is still running
      warn('Skipping poll tick - previous poll still in progress');
      return;
    }

    // Mark as polling and perform the poll
    isPolling = true;
    performPoll(config, sessionManager)
      .catch(err => {
        logError('Poll failed', {
          error: err?.message || String(err),
        });
      })
      .finally(() => {
        isPolling = false;
      });
  }, pollIntervalMs);

  info('Poll loop running', {
    pollIntervalMs,
  });

  // Keep the process running (Node.js will exit if no timers are active)
  // The interval timer will keep the process alive
  return new Promise(() => {
    // This promise never resolves, keeping the process running
    // To stop the poll loop, clearInterval(intervalId) would be called
  });
}
