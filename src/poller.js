/**
 * Polling loop implementation
 */

import { info, debug, error as logError, warn } from './logger.js';
import { setLogLevel } from './logger.js';
import { runSmokeQuery, fetchAssignedIssues, groupIssuesByProject } from './linear.js';
import { ensureSession, listSessions, attemptKillUnhealthySession } from './tmux.js';

/**
 * Perform a single poll
 * @param {Object} config - Configuration object
 */
async function performPoll(config) {
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

    info('Fetched assigned issues', {
      issueCount: issues.length,
      truncated,
    });

    byProject = groupIssuesByProject(issues);
    info('Projects with qualifying issues', {
      projectCount: byProject.size,
      projects: Array.from(byProject.keys()),
    });
  } catch (err) {
    logError('Failed to fetch assigned issues', {
      error: err?.message || String(err),
    });
  }

  // INN-166: Create sessions for projects with qualifying issues (idempotent)
  try {
    const createdCount = await createSessionsForProjects(byProject, config);
    info('Session creation completed', { createdCount });
  } catch (err) {
    logError('Failed to create sessions', {
      error: err?.message || String(err),
    });
  }

  // INN-168: Check and kill unhealthy owned sessions
  try {
    const healthCheckResult = await checkAndKillUnhealthySessions(config);
    info('Health check completed', healthCheckResult);
  } catch (err) {
    logError('Failed to check/kill unhealthy sessions', {
      error: err?.message || String(err),
    });
  }
}

/**
 * Create tmux sessions for projects with qualifying issues
 * This is idempotent - won't create duplicate sessions
 *
 * @param {Map<string, Object>} byProject - Map of projectId -> {projectName, issueCount}
 * @param {Object} config - Configuration object
 * @returns {Promise<number>} Number of sessions created in this poll
 */
async function createSessionsForProjects(byProject, config) {
  let createdCount = 0;

  for (const [projectId, projectData] of byProject) {
    const { projectName } = projectData;
    const sessionName = `${config.tmuxPrefix}${projectId}`;
    const result = await ensureSession(sessionName, projectName, projectData, config.sessionCommandTemplate);

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

  return createdCount;
}

/**
 * Check and kill unhealthy owned sessions
 *
 * @param {Object} config - Configuration object
 * @returns {Promise<{sessionsChecked: number, unhealthyDetected: number, killed: number, skipped: number}>}
 */
async function checkAndKillUnhealthySessions(config) {
  // Get all sessions
  const sessions = await listSessions();

  let sessionsChecked = 0;
  let unhealthyDetected = 0;
  let killed = 0;
  let skipped = 0;

  for (const sessionName of sessions) {
    sessionsChecked++;

    const result = await attemptKillUnhealthySession(
      sessionName,
      config.tmuxPrefix,
      config
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

  info('Starting poll loop...', {
    pollIntervalSec: config.pollIntervalSec,
    tmuxPrefix: config.tmuxPrefix,
  });

  // Track if a poll is currently running
  let isPolling = false;

  // Perform initial poll on startup
  info('Performing initial poll on startup');
  isPolling = true;
  try {
    await performPoll(config);
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
    performPoll(config)
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
