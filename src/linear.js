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

async function issueUpdateMutation(apiKey, issueId, input, _operationName = 'IssueUpdate') {
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

  const data = await executeQuery(apiKey, mutation, { id: issueId, input }, { operationName: 'IssueUpdate' });
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

/**
 * Fetch all accessible projects from Linear API
 * @param {string} apiKey - Linear API key
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function fetchProjects(apiKey) {
  const query = `query Projects {
    projects(first: 50) {
      nodes {
        id
        name
      }
    }
  }`;

  const data = await executeQuery(apiKey, query, {}, { operationName: 'Projects' });
  const nodes = data?.projects?.nodes ?? [];

  debug('Fetched Linear projects', {
    projectCount: nodes.length,
    projects: nodes.map((p) => ({ id: p.id, name: p.name })),
  });

  return nodes;
}

/**
 * Resolve a project reference (name or ID) to a project ID
 * @param {string} apiKey - Linear API key
 * @param {string} projectRef - Project name or ID
 * @returns {Promise<{id: string, name: string}>}
 */
export async function resolveProjectRef(apiKey, projectRef) {
  const ref = String(projectRef || '').trim();
  if (!ref) {
    throw new Error('Missing project reference');
  }

  // If it looks like a Linear ID (UUID), try direct lookup first
  if (isLinearId(ref)) {
    const projects = await fetchProjects(apiKey);
    const byId = projects.find((p) => p.id === ref);
    if (byId) {
      return { id: byId.id, name: byId.name };
    }
    throw new Error(`Project not found with ID: ${ref}`);
  }

  // Otherwise, search by name
  const projects = await fetchProjects(apiKey);

  // Try exact name match
  const exactName = projects.find((p) => p.name === ref);
  if (exactName) {
    return { id: exactName.id, name: exactName.name };
  }

  // Try case-insensitive name match
  const lowerRef = ref.toLowerCase();
  const insensitiveName = projects.find((p) => p.name?.toLowerCase() === lowerRef);
  if (insensitiveName) {
    return { id: insensitiveName.id, name: insensitiveName.name };
  }

  throw new Error(`Project not found: ${ref}. Available projects: ${projects.map((p) => p.name).join(', ')}`);
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

/**
 * Fetch detailed issue information including comments, parent, children, and attachments
 * @param {string} apiKey - Linear API key
 * @param {string} issue - Issue identifier (ABC-123) or Linear issue ID
 * @param {Object} options
 * @param {boolean} [options.includeComments=true] - Include comments in response
 * @returns {Promise<Object>} Issue details
 */
export async function fetchIssueDetails(apiKey, issue, options = {}) {
  const { includeComments = true } = options;
  const targetIssue = await resolveIssue(apiKey, issue);
  const issueId = targetIssue.id;

  const queryWithComments = `query GetIssueDetailsWithComments($id: String!) {
    issue(id: $id) {
      identifier
      title
      description
      url
      branchName
      priority
      estimate
      createdAt
      updatedAt
      state {
        name
        color
        type
      }
      team {
        id
        key
        name
      }
      project {
        id
        name
      }
      assignee {
        id
        name
        displayName
      }
      creator {
        id
        name
        displayName
      }
      labels {
        nodes {
          id
          name
          color
        }
      }
      parent {
        identifier
        title
        state {
          name
          color
        }
      }
      children(first: 50) {
        nodes {
          identifier
          title
          state {
            name
            color
          }
        }
      }
      comments(first: 50, orderBy: createdAt) {
        nodes {
          id
          body
          createdAt
          updatedAt
          user {
            name
            displayName
          }
          externalUser {
            name
            displayName
          }
          parent {
            id
          }
        }
      }
      attachments(first: 20) {
        nodes {
          id
          title
          url
          subtitle
          sourceType
          createdAt
        }
      }
    }
  }`;

  const queryWithoutComments = `query GetIssueDetails($id: String!) {
    issue(id: $id) {
      identifier
      title
      description
      url
      branchName
      priority
      estimate
      createdAt
      updatedAt
      state {
        name
        color
        type
      }
      team {
        id
        key
        name
      }
      project {
        id
        name
      }
      assignee {
        id
        name
        displayName
      }
      creator {
        id
        name
        displayName
      }
      labels {
        nodes {
          id
          name
          color
        }
      }
      parent {
        identifier
        title
        state {
          name
          color
        }
      }
      children(first: 50) {
        nodes {
          identifier
          title
          state {
            name
            color
          }
        }
      }
      attachments(first: 20) {
        nodes {
          id
          title
          url
          subtitle
          sourceType
          createdAt
        }
      }
    }
  }`;

  const query = includeComments ? queryWithComments : queryWithoutComments;
  const data = await executeQuery(apiKey, query, { id: issueId }, {
    operationName: includeComments ? 'GetIssueDetailsWithComments' : 'GetIssueDetails',
  });

  const issueData = data?.issue;
  if (!issueData) {
    throw new Error(`Issue not found: ${issueId}`);
  }

  return {
    ...issueData,
    children: issueData.children?.nodes || [],
    comments: issueData.comments?.nodes || [],
    attachments: issueData.attachments?.nodes || [],
    labels: issueData.labels?.nodes || [],
  };
}

/**
 * Format relative time from ISO date string
 * @param {string} isoDate - ISO date string
 * @returns {string} Human-readable relative time
 */
function formatRelativeTime(isoDate) {
  if (!isoDate) return 'unknown';

  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffSeconds < 60) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  if (diffWeeks < 4) return `${diffWeeks} week${diffWeeks > 1 ? 's' : ''} ago`;
  if (diffMonths < 12) return `${diffMonths} month${diffMonths > 1 ? 's' : ''} ago`;
  return `${diffYears} year${diffYears > 1 ? 's' : ''} ago`;
}

/**
 * Format issue details as markdown
 * @param {Object} issueData - Issue data from fetchIssueDetails
 * @param {Object} options
 * @param {boolean} [options.includeComments=true] - Include comments in markdown
 * @returns {string} Markdown formatted issue
 */
export function formatIssueAsMarkdown(issueData, options = {}) {
  const { includeComments = true } = options;
  const lines = [];

  // Title
  lines.push(`# ${issueData.identifier}: ${issueData.title}`);

  // Meta information
  const metaParts = [];
  if (issueData.state?.name) {
    metaParts.push(`**State:** ${issueData.state.name}`);
  }
  if (issueData.team?.name) {
    metaParts.push(`**Team:** ${issueData.team.name}`);
  }
  if (issueData.project?.name) {
    metaParts.push(`**Project:** ${issueData.project.name}`);
  }
  if (issueData.assignee?.displayName) {
    metaParts.push(`**Assignee:** ${issueData.assignee.displayName}`);
  }
  if (issueData.priority !== undefined && issueData.priority !== null) {
    const priorityNames = ['No priority', 'Urgent', 'High', 'Medium', 'Low'];
    metaParts.push(`**Priority:** ${priorityNames[issueData.priority] || issueData.priority}`);
  }
  if (issueData.estimate !== undefined && issueData.estimate !== null) {
    metaParts.push(`**Estimate:** ${issueData.estimate}`);
  }
  if (issueData.labels?.length > 0) {
    const labelNames = issueData.labels.map((l) => l.name).join(', ');
    metaParts.push(`**Labels:** ${labelNames}`);
  }

  if (metaParts.length > 0) {
    lines.push('');
    lines.push(metaParts.join(' | '));
  }

  // URLs
  if (issueData.url) {
    lines.push('');
    lines.push(`**URL:** ${issueData.url}`);
  }
  if (issueData.branchName) {
    lines.push(`**Branch:** ${issueData.branchName}`);
  }

  // Description
  if (issueData.description) {
    lines.push('');
    lines.push(issueData.description);
  }

  // Parent issue
  if (issueData.parent) {
    lines.push('');
    lines.push('## Parent');
    lines.push('');
    lines.push(`- **${issueData.parent.identifier}**: ${issueData.parent.title} _[${issueData.parent.state?.name || 'unknown'}]_`);
  }

  // Sub-issues
  if (issueData.children?.length > 0) {
    lines.push('');
    lines.push('## Sub-issues');
    lines.push('');
    for (const child of issueData.children) {
      lines.push(`- **${child.identifier}**: ${child.title} _[${child.state?.name || 'unknown'}]_`);
    }
  }

  // Attachments
  if (issueData.attachments?.length > 0) {
    lines.push('');
    lines.push('## Attachments');
    lines.push('');
    for (const attachment of issueData.attachments) {
      const sourceLabel = attachment.sourceType ? ` _[${attachment.sourceType}]_` : '';
      lines.push(`- **${attachment.title}**: ${attachment.url}${sourceLabel}`);
      if (attachment.subtitle) {
        lines.push(`  _${attachment.subtitle}_`);
      }
    }
  }

  // Comments
  if (includeComments && issueData.comments?.length > 0) {
    lines.push('');
    lines.push('## Comments');
    lines.push('');

    // Separate root comments from replies
    const rootComments = issueData.comments.filter((c) => !c.parent);
    const replies = issueData.comments.filter((c) => c.parent);

    // Create a map of parent ID to replies
    const repliesMap = new Map();
    replies.forEach((reply) => {
      const parentId = reply.parent.id;
      if (!repliesMap.has(parentId)) {
        repliesMap.set(parentId, []);
      }
      repliesMap.get(parentId).push(reply);
    });

    // Sort root comments by creation date (newest first)
    const sortedRootComments = rootComments.slice().reverse();

    for (const rootComment of sortedRootComments) {
      const threadReplies = repliesMap.get(rootComment.id) || [];

      // Sort replies by creation date (oldest first within thread)
      threadReplies.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

      const rootAuthor = rootComment.user?.displayName
        || rootComment.user?.name
        || rootComment.externalUser?.displayName
        || rootComment.externalUser?.name
        || 'Unknown';
      const rootDate = formatRelativeTime(rootComment.createdAt);

      lines.push(`- **@${rootAuthor}** - _${rootDate}_`);
      lines.push('');
      lines.push(`  ${rootComment.body.split('\n').join('\n  ')}`);
      lines.push('');

      // Format replies
      for (const reply of threadReplies) {
        const replyAuthor = reply.user?.displayName
          || reply.user?.name
          || reply.externalUser?.displayName
          || reply.externalUser?.name
          || 'Unknown';
        const replyDate = formatRelativeTime(reply.createdAt);

        lines.push(`  - **@${replyAuthor}** - _${replyDate}_`);
        lines.push('');
        lines.push(`    ${reply.body.split('\n').join('\n    ')}`);
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}
