#!/usr/bin/env node

/**
 * Test script to verify session naming and ownership rule
 * Definition of done: owned/unowned classification covered with sample cases
 */

import { isOwnedSession, extractProjectId } from './src/tmux.js';
import { info, error as logError } from './src/logger.js';

const TMUX_PREFIX = 'pi_project_';

// Test cases for isOwnedSession
const testCases = [
  // Owned sessions (should return true)
  { sessionName: 'pi_project_ABC-123', expected: true, description: 'Valid owned session with project ID' },
  { sessionName: 'pi_project_TEST', expected: true, description: 'Valid owned session with short project ID' },
  { sessionName: 'pi_project_proj-1', expected: true, description: 'Valid owned session with lowercase' },
  { sessionName: 'pi_project_123', expected: true, description: 'Valid owned session with numeric project ID' },
  { sessionName: 'pi_project_A-B-C-1', expected: true, description: 'Valid owned session with multiple hyphens' },

  // Unowned sessions (should return false)
  { sessionName: 'other_prefix_ABC-123', expected: false, description: 'Wrong prefix' },
  { sessionName: 'pi_project_', expected: false, description: 'Prefix only, no project ID' },
  { sessionName: 'pi_project_', expected: false, description: 'Prefix only (empty project ID)' },
  { sessionName: 'pi_project_!@#$', expected: false, description: 'Invalid characters in project ID' },
  { sessionName: 'pi_project_ABC 123', expected: false, description: 'Space in project ID' },
  { sessionName: 'pi_project_ABC_123', expected: false, description: 'Underscore in project ID (should only be hyphens)' },
  { sessionName: 'pi_project_ABC.DEF', expected: false, description: 'Dot in project ID' },
  { sessionName: 'random_session', expected: false, description: 'Random session name' },
  { sessionName: '', expected: false, description: 'Empty string' },
  { sessionName: 'my_project_ABC-123', expected: false, description: 'Similar but different prefix' },
];

function runTests() {
  info('Testing session naming and ownership rule...', {
    prefix: TMUX_PREFIX,
  });

  let passed = 0;
  let failed = 0;

  testCases.forEach((testCase, index) => {
    const actual = isOwnedSession(testCase.sessionName, TMUX_PREFIX);
    const success = actual === testCase.expected;

    if (success) {
      passed++;
      info(`✓ Test ${index + 1}: ${testCase.description}`, {
        sessionName: testCase.sessionName,
        expected: testCase.expected,
        actual,
      });
    } else {
      failed++;
      logError(`✗ Test ${index + 1}: ${testCase.description}`, {
        sessionName: testCase.sessionName,
        expected: testCase.expected,
        actual,
      });
    }
  });

  // Test extractProjectId
  info('\nTesting extractProjectId...');

  const extractTestCases = [
    { sessionName: 'pi_project_ABC-123', expected: 'ABC-123', description: 'Valid owned session' },
    { sessionName: 'pi_project_TEST', expected: 'TEST', description: 'Valid owned session (short)' },
    { sessionName: 'other_prefix_ABC-123', expected: null, description: 'Wrong prefix' },
    { sessionName: 'pi_project_', expected: null, description: 'No project ID' },
    { sessionName: 'random', expected: null, description: 'Random name' },
  ];

  extractTestCases.forEach((testCase, index) => {
    const actual = extractProjectId(testCase.sessionName, TMUX_PREFIX);
    const success = actual === testCase.expected;

    if (success) {
      passed++;
      info(`✓ Extract test ${index + 1}: ${testCase.description}`, {
        sessionName: testCase.sessionName,
        expected: testCase.expected,
        actual,
      });
    } else {
      failed++;
      logError(`✗ Extract test ${index + 1}: ${testCase.description}`, {
        sessionName: testCase.sessionName,
        expected: testCase.expected,
        actual,
      });
    }
  });

  // Summary
  const total = passed + failed;
  info('\nTest Summary', {
    total,
    passed,
    failed,
    success: failed === 0,
  });

  return failed === 0;
}

// Run tests
const success = runTests();
process.exit(success ? 0 : 1);
