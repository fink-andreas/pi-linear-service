#!/usr/bin/env node

/**
 * Test script to verify session command template with placeholders
 */

import { replacePlaceholders } from './src/tmux.js';
import { info, error as logError } from './src/logger.js';

function runTests() {
  info('Testing session command template with placeholders...');

  const template = 'pi -p "You are working on project: ${projectName} list issues and choose one to work on, if an issue is already in progress - continue"';

  // Test 1: Basic placeholders
  info('\nTest 1: Basic placeholder replacement');
  const placeholders1 = {
    projectName: 'My App',
    projectId: 'ABC-123',
    sessionId: 'pi_project_ABC-123',
    issueCount: 5,
  };
  const result1 = replacePlaceholders(template, placeholders1);
  const expected1 = 'pi -p "You are working on project: My App list issues and choose one to work on, if an issue is already in progress - continue"';
  if (result1 === expected1) {
    info('✓ Basic placeholders replaced correctly', { result: result1 });
  } else {
    logError('✗ Basic placeholder replacement failed', {
      expected: expected1,
      actual: result1,
    });
    process.exit(1);
  }

  // Test 2: Multiple placeholders in one template
  info('\nTest 2: Multiple placeholders');
  const template2 = 'pi -p "Project: ${projectName} (${projectId}) has ${issueCount} issues. Session: ${sessionId}"';
  const placeholders2 = {
    projectName: 'Frontend',
    projectId: 'DEF-456',
    sessionId: 'pi_project_DEF-456',
    issueCount: 10,
  };
  const result2 = replacePlaceholders(template2, placeholders2);
  const expected2 = 'pi -p "Project: Frontend (DEF-456) has 10 issues. Session: pi_project_DEF-456"';
  if (result2 === expected2) {
    info('✓ Multiple placeholders replaced correctly', { result: result2 });
  } else {
    logError('✗ Multiple placeholder replacement failed', {
      expected: expected2,
      actual: result2,
    });
    process.exit(1);
  }

  // Test 3: Placeholder with special characters
  info('\nTest 3: Special characters in project name');
  const placeholders3 = {
    projectName: 'My-Test_App (2024)',
    projectId: 'XYZ-789',
    sessionId: 'pi_project_XYZ-789',
    issueCount: 1,
  };
  const result3 = replacePlaceholders(template, placeholders3);
  const expected3 = 'pi -p "You are working on project: My-Test_App (2024) list issues and choose one to work on, if an issue is already in progress - continue"';
  if (result3 === expected3) {
    info('✓ Special characters handled correctly', { result: result3 });
  } else {
    logError('✗ Special character handling failed', {
      expected: expected3,
      actual: result3,
    });
    process.exit(1);
  }

  // Test 4: Missing placeholder (should not be replaced)
  info('\nTest 4: Missing placeholder');
  const template4 = 'pi -p "Working on ${projectName} with ${nonExistent}"';
  const placeholders4 = {
    projectName: 'Test Project',
  };
  const result4 = replacePlaceholders(template4, placeholders4);
  if (result4.includes('${nonExistent}')) {
    info('✓ Missing placeholder not replaced', { result: result4 });
  } else {
    logError('✗ Missing placeholder should not be replaced', { result: result4 });
    process.exit(1);
  }

  // Test 5: Empty placeholder value
  info('\nTest 5: Empty placeholder value');
  const placeholders5 = {
    projectName: '',
    projectId: 'TEST',
    sessionId: 'pi_project_TEST',
    issueCount: 0,
  };
  const result5 = replacePlaceholders(template, placeholders5);
  const expected5 = 'pi -p "You are working on project:  list issues and choose one to work on, if an issue is already in progress - continue"';
  if (result5 === expected5) {
    info('✓ Empty placeholder handled correctly', { result: result5 });
  } else {
    logError('✗ Empty placeholder handling failed', {
      expected: expected5,
      actual: result5,
    });
    process.exit(1);
  }

  // Test 6: Multiple occurrences of same placeholder
  info('\nTest 6: Multiple occurrences of same placeholder');
  const template6 = 'pi -p "Project: ${projectName}. Work on ${projectName}."';
  const placeholders6 = {
    projectName: 'Repeat Test',
  };
  const result6 = replacePlaceholders(template6, placeholders6);
  const expected6 = 'pi -p "Project: Repeat Test. Work on Repeat Test."';
  if (result6 === expected6) {
    info('✓ Multiple occurrences replaced correctly', { result: result6 });
  } else {
    logError('✗ Multiple occurrence replacement failed', {
      expected: expected6,
      actual: result6,
    });
    process.exit(1);
  }

  info('\n✓ All session command template tests passed');
  info('\nPlaceholder functionality verified:');
  info('  ✓ Basic placeholder replacement works');
  info('  ✓ Multiple placeholders in one template');
  info('  ✓ Special characters handled');
  info('  ✓ Missing placeholders not replaced');
  info('  ✓ Empty placeholder values handled');
  info('  ✓ Multiple occurrences of same placeholder');
}

async function main() {
  try {
    await runTests();
  } catch (err) {
    logError('Test runner failed', { error: err.message });
    process.exit(1);
  }
}

main();
