/**
 * Polling loop implementation
 */

import { info, debug, error as logError } from './logger.js';
import { setLogLevel } from './logger.js';
import { runSmokeQuery, fetchAssignedIssues, groupIssuesByProject } from './linear.js';

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

  // INN-159: Run a simple query and log success/failure cleanly.
  // IMPORTANT: Never throw here on transient API failures (daemon must keep running).
  try {
    info('Running Linear API smoke test query...');
    const viewer = await runSmokeQuery(config.linearApiKey);
    info('Linear API smoke query successful', {
      viewerId: viewer?.id,
      viewerName: viewer?.name,
    });
  } catch (err) {
    logError('Linear API smoke query failed', {
      error: err?.message || String(err),
    });
  }

  // INN-160: Query assigned issues in open states (up to LINEAR_PAGE_LIMIT)
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

    const byProject = groupIssuesByProject(issues);
    info('Projects with qualifying issues', {
      projectCount: byProject.size,
    });
  } catch (err) {
    logError('Failed to fetch assigned issues', {
      error: err?.message || String(err),
    });
  }

  // The polling loop will be fully implemented in ISSUE-008
  debug('Poll loop skeleton (full implementation in ISSUE-008)');

  // For now, just indicate ready state and exit
  // In future issues, this will run indefinitely with actual polling logic
  info('Service ready (polling will be implemented in ISSUE-008)');
}
