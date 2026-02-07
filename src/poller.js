/**
 * Polling loop implementation
 */

import { info, debug, error as logError, warn } from './logger.js';
import { setLogLevel } from './logger.js';
import { runSmokeQuery, fetchAssignedIssues, groupIssuesByProject } from './linear.js';
import { ensureSession } from './tmux.js';

/**
 * Perform a single poll
 * @param {Object} config - Configuration object
 */
async function performPoll(config) {
  // INN-159: Run a simple query and log success/failure cleanly.
  // IMPORTANT: Never throw here on transient API failures (daemon must keep running).
  try {
    debug('Running Linear API smoke test query...');
    const viewer = await runSmokeQuery(config.linearApiKey);
    debug('Linear API smoke query successful', {
      viewerId: viewer?.id,
      viewerName: viewer?.name,
    });
  } catch (err) {
    logError('Linear API smoke query failed', {
      error: err?.message || String(err),
    });
  }

  // INN-160: Query assigned issues in open states (up to LINEAR_PAGE_LIMIT)
  let byProject = new Map();
  try {
    info('Fetching assigned issues in open states...', {
      assigneeId: config.assigneeId,
      openStates: config.linearOpenStates,
      limit: config.linearPageLimit,
    });

    const { issues, truncated } = await fetchAssignedIssues(
      config.linearApiKey,
      config.assigneeId,
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

  for (const [projectId, { projectName }] of byProject) {
    const sessionName = `${config.tmuxPrefix}${projectId}`;
    const result = await ensureSession(sessionName, projectName);

    if (result.created) {
      createdCount++;
      debug('Session created this poll', {
        sessionName,
        projectName,
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
