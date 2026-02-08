/**
 * Linear GraphQL API client
 */

import { error as logError, warn, info, debug } from './logger.js';
import { measureTimeAsync } from './metrics.js';
import pkg from '../package.json' with { type: 'json' };

const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql';
const USER_AGENT = `${pkg.name}/${pkg.version}`;

function truncate(str, maxLen = 800) {
  if (typeof str !== 'string') return str;
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '…(truncated)';
}

/**
 * Execute a GraphQL query against Linear API
 *
 * Notes:
 * - Logs HTTP failures and GraphQL `errors[]`
 * - Throws on failures so callers can decide whether to abort or continue
 *
 * @param {string} apiKey - Linear API key
 * @param {string} query - GraphQL query
 * @param {Object} variables - Query variables
 * @param {Object} options
 * @param {string} [options.operationName]
 * @param {number} [options.timeoutMs=15000]
 * @returns {Promise<Object>} Query response data
 */
export async function executeQuery(apiKey, query, variables = {}, options = {}) {
  const { operationName, timeoutMs = 15000 } = options;

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    debug('Executing Linear GraphQL query', {
      operationName,
      queryFirstLine: query?.split('\n')?.[0],
    });

    // Measure API latency
    const { result: response, duration: fetchDuration } = await measureTimeAsync(async () => {
      return await fetch(LINEAR_GRAPHQL_URL, {
        method: 'POST',
        headers: {
          Authorization: apiKey,
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
        },
        body: JSON.stringify({
          query,
          variables,
          ...(operationName ? { operationName } : {}),
        }),
        signal: controller.signal,
      });
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '<failed to read response body>');
      logError('Linear API request failed', {
        operationName,
        status: response.status,
        statusText: response.statusText,
        responseBodySnippet: truncate(errorText),
        durationMs: fetchDuration,
      });
      throw new Error(`Linear API HTTP error: ${response.status} ${response.statusText}`);
    }

    let result;
    try {
      result = await response.json();
    } catch (e) {
      const raw = await response.text().catch(() => '<failed to read response body>');
      logError('Linear API returned non-JSON response', {
        operationName,
        responseBodySnippet: truncate(raw),
      });
      throw new Error('Linear API returned invalid JSON');
    }

    if (result?.errors?.length) {
      logError('GraphQL query returned errors', {
        operationName,
        durationMs: fetchDuration,
        errors: result.errors.map((e) => ({
          message: e.message,
          path: e.path,
          code: e.extensions?.code,
          type: e.extensions?.type,
        })),
      });

      const messages = result.errors.map((e) => e.message).join(', ');
      throw new Error(`Linear GraphQL error(s): ${messages}`);
    }

    debug('Linear GraphQL query successful', {
      operationName,
      durationMs: fetchDuration,
    });
    return result.data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      logError('Linear API request timed out', { operationName, timeoutMs });
      throw new Error(`Linear API request timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Run a minimal smoke-test query against the Linear API.
 *
 * Definition of done for INN-159 requires a simple query and clean logging.
 *
 * @param {string} apiKey
 * @returns {Promise<{id: string, name?: string}>}
 */
export async function runSmokeQuery(apiKey) {
  const query = `query SmokeTest {\n  viewer {\n    id\n    name\n  }\n}`;
  const data = await executeQuery(apiKey, query, {}, { operationName: 'SmokeTest' });
  return data.viewer;
}

/**
 * Fetch issues assigned to a user in specific states
 * @param {string} apiKey - Linear API key
 * @param {string} assigneeId - Assignee ID to filter by
 * @param {Array<string>} openStates - List of state names to include
 * @param {number} limit - Maximum number of issues to fetch
 * @returns {Promise<Object>} Object with issues array, truncated flag
 */
export async function fetchAssignedIssues(apiKey, assigneeId, openStates, limit) {
  const query = `query FetchAssignedIssues($assigneeId: ID!, $stateNames: [String!]!, $first: Int!) {\n  issues(\n    first: $first\n    filter: {\n      assignee: { id: { eq: $assigneeId } }\n      state: { name: { in: $stateNames } }\n    }\n  ) {\n    nodes {\n      id\n      title\n      state {\n        name\n      }\n      project {\n        id\n        name\n      }\n    }\n    pageInfo {\n      hasNextPage\n    }\n  }\n}`;

  const variables = {
    assigneeId,
    stateNames: openStates,
    first: limit,
  };

  const data = await executeQuery(apiKey, query, variables, {
    operationName: 'FetchAssignedIssues',
  });

  const nodes = data?.issues?.nodes ?? [];
  const hasNextPage = Boolean(data?.issues?.pageInfo?.hasNextPage);

  // DEBUG: Log issues delivered by Linear API
  debug('Issues delivered by Linear API', {
    issueCount: nodes.length,
    issues: nodes.map(issue => ({
      id: issue.id,
      title: issue.title,
      state: issue.state?.name,
      project: issue.project?.name,
      projectId: issue.project?.id,
    })),
  });

  const truncated = hasNextPage || nodes.length >= limit;
  if (truncated) {
    warn('Linear issues query may be truncated by LINEAR_PAGE_LIMIT', {
      limit,
      returned: nodes.length,
      hasNextPage,
    });
  }

  return {
    issues: nodes,
    truncated,
  };
}

/**
 * Group issues by project
 * @param {Array<Object>} issues - Array of issues from Linear API
 * @returns {Object} Map of projectId -> { projectName, issueCount }
 */
export function groupIssuesByProject(issues) {
  const map = new Map();
  let ignoredNoProject = 0;

  for (const issue of issues) {
    const project = issue?.project;
    const projectId = project?.id;

    if (!projectId) {
      ignoredNoProject += 1;
      debug('Ignoring issue with no project', {
        issueId: issue?.id,
        title: issue?.title,
        state: issue?.state?.name,
      });
      continue;
    }

    const existing = map.get(projectId);
    if (existing) {
      existing.issueCount += 1;
      existing.issues.push(issue);
    } else {
      map.set(projectId, {
        projectName: project?.name,
        issueCount: 1,
        issues: [issue],
      });
    }
  }

  info('Grouped issues by project', {
    issueCount: issues.length,
    projectCount: map.size,
    ignoredNoProject,
  });

  return map;
}
