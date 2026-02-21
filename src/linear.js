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

function truncateJson(value, maxLen = 800) {
  try {
    return truncate(JSON.stringify(value), maxLen);
  } catch {
    return '<unserializable-json>';
  }
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
  const queryFirstLine = query?.split('\n')?.[0] || '<unknown-query>';
  const requestContext = {
    operationName: operationName || null,
    queryFirstLine,
    variables,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    debug('Executing Linear GraphQL query', {
      operationName,
      queryFirstLine,
      variables,
    });

    // Measure API latency and keep explicit failure details.
    const fetchResult = await measureTimeAsync(async () => {
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

    const fetchDuration = fetchResult.duration;

    if (!fetchResult.success) {
      const fetchError = fetchResult.error;

      if (fetchError?.name === 'AbortError') {
        logError('Linear API request timed out', {
          operationName,
          timeoutMs,
          durationMs: fetchDuration,
          request: requestContext,
        });
        throw new Error(
          `Linear API request timed out after ${timeoutMs}ms; request=${truncateJson(requestContext, 1500)}`
        );
      }

      logError('Linear API request failed before receiving response', {
        operationName,
        durationMs: fetchDuration,
        error: fetchError?.message || String(fetchError),
        request: requestContext,
      });
      throw new Error(
        `Linear API request failed: ${fetchError?.message || String(fetchError)}; request=${truncateJson(requestContext, 1500)}`
      );
    }

    const response = fetchResult.result;

    if (!response.ok) {
      const errorText = await response.text().catch(() => '<failed to read response body>');
      const responseSnippet = truncate(errorText, 1500);
      logError('Linear API request failed', {
        operationName,
        status: response.status,
        statusText: response.statusText,
        responseBodySnippet: responseSnippet,
        durationMs: fetchDuration,
        request: requestContext,
      });
      throw new Error(
        `Linear API HTTP error: ${response.status} ${response.statusText}; request=${truncateJson(requestContext, 1500)}; response=${responseSnippet}`
      );
    }

    let result;
    try {
      result = await response.json();
    } catch (e) {
      const raw = await response.text().catch(() => '<failed to read response body>');
      const responseSnippet = truncate(raw, 1500);
      logError('Linear API returned non-JSON response', {
        operationName,
        responseBodySnippet: responseSnippet,
        request: requestContext,
      });
      throw new Error(
        `Linear API returned invalid JSON; request=${truncateJson(requestContext, 1500)}; response=${responseSnippet}`
      );
    }

    if (result?.errors?.length) {
      const normalizedErrors = result.errors.map((e) => ({
        message: e.message,
        path: e.path,
        code: e.extensions?.code,
        type: e.extensions?.type,
      }));

      logError('GraphQL query returned errors', {
        operationName,
        durationMs: fetchDuration,
        errors: normalizedErrors,
        request: requestContext,
      });

      const messages = result.errors.map((e) => e.message).join(', ');
      throw new Error(
        `Linear GraphQL error(s): ${messages}; request=${truncateJson(requestContext, 1500)}; errors=${truncateJson(normalizedErrors, 1500)}`
      );
    }

    debug('Linear GraphQL query successful', {
      operationName,
      durationMs: fetchDuration,
    });
    return result.data;
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
 * Fetch issues in specific states, optionally filtered by assignee.
 * @param {string} apiKey - Linear API key
 * @param {string|null} assigneeId - Assignee ID to filter by (null = all assignees)
 * @param {Array<string>} openStates - List of state names to include
 * @param {number} limit - Maximum number of issues to fetch
 * @returns {Promise<Object>} Object with issues array, truncated flag
 */
export async function fetchIssues(apiKey, assigneeId, openStates, limit) {
  const assignedQuery = `query FetchAssignedIssues($assigneeId: ID!, $stateNames: [String!]!, $first: Int!) {\n  issues(\n    first: $first\n    filter: {\n      assignee: { id: { eq: $assigneeId } }\n      state: { name: { in: $stateNames } }\n    }\n  ) {\n    nodes {\n      id\n      title\n      state {\n        name\n      }\n      assignee {\n        id\n      }\n      project {\n        id\n        name\n      }\n    }\n    pageInfo {\n      hasNextPage\n    }\n  }\n}`;

  const allAssigneesQuery = `query FetchOpenIssues($stateNames: [String!]!, $first: Int!) {\n  issues(\n    first: $first\n    filter: {\n      state: { name: { in: $stateNames } }\n    }\n  ) {\n    nodes {\n      id\n      title\n      state {\n        name\n      }\n      assignee {\n        id\n      }\n      project {\n        id\n        name\n      }\n    }\n    pageInfo {\n      hasNextPage\n    }\n  }\n}`;

  const variables = assigneeId
    ? { assigneeId, stateNames: openStates, first: limit }
    : { stateNames: openStates, first: limit };

  const data = await executeQuery(apiKey, assigneeId ? assignedQuery : allAssigneesQuery, variables, {
    operationName: assigneeId ? 'FetchAssignedIssues' : 'FetchOpenIssues',
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
      assigneeId: issue.assignee?.id,
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
 * Backward-compatible wrapper for assignee-only issue queries.
 */
export async function fetchAssignedIssues(apiKey, assigneeId, openStates, limit) {
  return fetchIssues(apiKey, assigneeId, openStates, limit);
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

function isLinearId(value) {
  return typeof value === 'string' && /^[0-9a-fA-F-]{16,}$/.test(value);
}

function normalizeIssueLookupInput(issue) {
  const value = String(issue || '').trim();
  if (!value) throw new Error('Missing required issue identifier');
  return value;
}

async function queryIssueByIdentifier(apiKey, identifier) {
  const query = `query IssueByIdentifier($identifier: String!) {
    issues(first: 1, filter: { identifier: { eq: $identifier } }) {
      nodes {
        id
        identifier
        title
        branchName
        team {
          id
          key
        }
        state {
          id
          name
          type
        }
      }
    }
  }`;

  const data = await executeQuery(apiKey, query, { identifier }, { operationName: 'IssueByIdentifier' });
  return data?.issues?.nodes?.[0] || null;
}

async function queryIssueById(apiKey, id) {
  const query = `query IssueById($id: String!) {
    issue(id: $id) {
      id
      identifier
      title
      branchName
      team {
        id
        key
      }
      state {
        id
        name
        type
      }
    }
  }`;

  const data = await executeQuery(apiKey, query, { id }, { operationName: 'IssueById' });
  return data?.issue || null;
}

export async function resolveIssue(apiKey, issue) {
  const lookup = normalizeIssueLookupInput(issue);

  const byIdLike = await queryIssueById(apiKey, lookup).catch(() => null);
  if (byIdLike) return byIdLike;

  if (isLinearId(lookup)) {
    throw new Error(`Issue not found: ${lookup}`);
  }

  const byIdentifier = await queryIssueByIdentifier(apiKey, lookup).catch(() => null);
  if (byIdentifier) return byIdentifier;

  throw new Error(`Issue not found: ${lookup}`);
}

export async function getTeamWorkflowStates(apiKey, teamRef) {
  const query = `query TeamWorkflowStates($teamId: String!) {
    team(id: $teamId) {
      states {
        nodes {
          id
          name
          type
        }
      }
    }
  }`;

  const data = await executeQuery(apiKey, query, { teamId: teamRef }, { operationName: 'TeamWorkflowStates' });
  return data?.team?.states?.nodes || [];
}

function resolveStateIdFromInput(states, stateInput) {
  if (!stateInput) return null;
  const target = String(stateInput).trim();
  if (!target) return null;

  const byId = states.find((s) => s.id === target);
  if (byId) return byId.id;

  const lower = target.toLowerCase();
  const byName = states.find((s) => String(s.name || '').toLowerCase() === lower);
  if (byName) return byName.id;

  const byType = states.find((s) => String(s.type || '').toLowerCase() === lower);
  if (byType) return byType.id;

  throw new Error(`State not found in team workflow: ${target}`);
}

async function issueUpdateMutation(apiKey, issueId, input, operationName = 'IssueUpdate') {
  const mutation = `mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) {
      success
      issue {
        id
        identifier
        title
        priority
        state {
          id
          name
          type
        }
      }
    }
  }`;

  const data = await executeQuery(apiKey, mutation, { id: issueId, input }, { operationName });
  const result = data?.issueUpdate;
  if (!result?.success) {
    throw new Error('Linear issueUpdate returned success=false');
  }
  return result.issue;
}

export async function prepareIssueStart(apiKey, issue) {
  const targetIssue = await resolveIssue(apiKey, issue);
  const teamRef = targetIssue?.team?.key || targetIssue?.team?.id;
  if (!teamRef) {
    throw new Error(`Issue ${targetIssue.identifier || targetIssue.id} has no team assigned`);
  }

  const states = await getTeamWorkflowStates(apiKey, teamRef);
  const started = states.find((s) => s.type === 'started')
    || states.find((s) => String(s.name || '').toLowerCase() === 'in progress');

  if (!started?.id) {
    throw new Error(`Could not resolve a started workflow state for team ${teamRef}`);
  }

  return {
    issue: targetIssue,
    startedState: started,
    branchName: targetIssue.branchName || null,
  };
}

export async function setIssueState(apiKey, issueId, stateId, operationName = 'IssueSetState') {
  return issueUpdateMutation(apiKey, issueId, { stateId }, operationName);
}

export async function startIssue(apiKey, issue) {
  const prepared = await prepareIssueStart(apiKey, issue);
  const updated = await setIssueState(apiKey, prepared.issue.id, prepared.startedState.id, 'IssueStartEquivalent');
  return {
    issue: updated,
    startedState: prepared.startedState,
    branchName: prepared.branchName,
  };
}

export async function addIssueComment(apiKey, issue, body, parentCommentId = undefined) {
  const commentBody = String(body || '').trim();
  if (!commentBody) {
    throw new Error('Missing required comment body');
  }

  const targetIssue = await resolveIssue(apiKey, issue);
  const mutation = `mutation CommentCreate($input: CommentCreateInput!) {
    commentCreate(input: $input) {
      success
      comment {
        id
        body
        issue {
          id
          identifier
        }
      }
    }
  }`;

  const input = {
    issueId: targetIssue.id,
    body: commentBody,
    ...(parentCommentId ? { parentId: parentCommentId } : {}),
  };

  const data = await executeQuery(apiKey, mutation, { input }, { operationName: 'CommentCreate' });
  const result = data?.commentCreate;
  if (!result?.success) {
    throw new Error('Linear commentCreate returned success=false');
  }

  return {
    issue: targetIssue,
    comment: result.comment,
  };
}

export async function updateIssue(apiKey, issue, patch = {}) {
  const targetIssue = await resolveIssue(apiKey, issue);
  const nextPatch = {};

  if (patch.title !== undefined) nextPatch.title = String(patch.title);
  if (patch.description !== undefined) nextPatch.description = String(patch.description);
  if (patch.priority !== undefined) {
    const parsed = Number.parseInt(String(patch.priority), 10);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 4) {
      throw new Error(`Invalid priority: ${patch.priority}. Valid range: 0..4`);
    }
    nextPatch.priority = parsed;
  }

  if (patch.state !== undefined) {
    const teamRef = targetIssue?.team?.key || targetIssue?.team?.id;
    if (!teamRef) throw new Error(`Issue ${targetIssue.identifier || targetIssue.id} has no team assigned`);
    const states = await getTeamWorkflowStates(apiKey, teamRef);
    nextPatch.stateId = resolveStateIdFromInput(states, patch.state);
  }

  if (Object.keys(nextPatch).length === 0) {
    throw new Error('No update fields provided');
  }

  const updated = await issueUpdateMutation(apiKey, targetIssue.id, nextPatch, 'IssueUpdateTool');
  return {
    issue: updated,
    changed: Object.keys(nextPatch),
  };
}
