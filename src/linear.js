/**
 * Linear GraphQL API client
 */

import { error as logError, debug, info } from './logger.js';

const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql';

/**
 * Execute a GraphQL query against Linear API
 * @param {string} apiKey - Linear API key
 * @param {string} query - GraphQL query
 * @param {Object} variables - Query variables
 * @returns {Promise<Object>} Query response data
 * @throws {Error} If request fails or GraphQL errors occur
 */
export async function executeQuery(apiKey, query, variables = {}) {
  try {
    debug('Executing Linear GraphQL query', { query: query.split('\n')[0] });

    const response = await fetch(LINEAR_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logError('Linear API request failed', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      throw new Error(`Linear API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();

    // Check for GraphQL errors
    if (result.errors && result.errors.length > 0) {
      logError('GraphQL query returned errors', {
        errors: result.errors.map(e => e.message),
      });
      throw new Error(`GraphQL errors: ${result.errors.map(e => e.message).join(', ')}`);
    }

    debug('Linear GraphQL query successful');
    return result.data;
  } catch (error) {
    // Don't log here - let caller handle it
    throw error;
  }
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
  // This will be fully implemented in ISSUE-006
  // For now, return a placeholder structure
  debug('fetchAssignedIssues called (will be implemented in ISSUE-006)', {
    assigneeId,
    openStates,
    limit,
  });

  return {
    issues: [],
    truncated: false,
  };
}

/**
 * Group issues by project
 * @param {Array<Object>} issues - Array of issues from Linear API
 * @returns {Object} Map of projectId -> { projectName, issueCount }
 */
export function groupIssuesByProject(issues) {
  // This will be fully implemented in ISSUE-007
  // For now, return empty map
  debug('groupIssuesByProject called (will be implemented in ISSUE-007)', {
    issueCount: issues.length,
  });

  return new Map();
}
