#!/usr/bin/env node

/**
 * Test script to verify idempotent session creation
 * Definition of done: repeated polls do not create duplicates; log "created N sessions" each poll
 */

import { ensureSession, killSession, listSessions } from './src/tmux.js';
import { info, error as logError } from './src/logger.js';

const TMUX_PREFIX = 'pi_project_';
const TEST_SESSION_NAME = `${TMUX_PREFIX}TEST-PROJECT`;
const TEST_PROJECT_NAME = 'Test Project';
const COMMAND_TEMPLATE = 'sleep 3600';
const PROJECT_DATA = { issueCount: 0 };

async function runTests() {
  info('Testing idempotent session creation...', {
    sessionName: TEST_SESSION_NAME,
    projectName: TEST_PROJECT_NAME,
  });

  let createdCount = 0;

  // Clean up any existing test session
  try {
    await killSession(TEST_SESSION_NAME);
    info('Cleaned up existing test session');
  } catch (err) {
    // Session may not exist, that's fine
    info('No existing test session to clean up');
  }

  // Test 1: First poll - should create the session
  info('\nTest 1: First poll - should create session');
  try {
    const result = await ensureSession(TEST_SESSION_NAME, TEST_PROJECT_NAME, PROJECT_DATA, COMMAND_TEMPLATE);
    if (result.created && !result.existed) {
      info('✓ Session created on first poll', { result });
      createdCount = 1;
    } else {
      logError('✗ First poll should create session', { result });
      process.exit(1);
    }
  } catch (err) {
    logError('✗ First poll failed', { error: err.message });
    process.exit(1);
  }

  // Verify session exists
  const sessions = await listSessions();
  const sessionExists = sessions.includes(TEST_SESSION_NAME);
  if (sessionExists) {
    info('✓ Session exists after creation', { sessions });
  } else {
    logError('✗ Session not found after creation', { sessions });
    process.exit(1);
  }

  // Test 2: Second poll - should NOT create duplicate (idempotent)
  info('\nTest 2: Second poll - should be idempotent (no duplicate)');
  try {
    const result = await ensureSession(TEST_SESSION_NAME, TEST_PROJECT_NAME, PROJECT_DATA, COMMAND_TEMPLATE);
    if (!result.created && result.existed) {
      info('✓ Second poll did not create duplicate (idempotent)', { result });
    } else {
      logError('✗ Second poll should be idempotent', { result });
      process.exit(1);
    }
  } catch (err) {
    logError('✗ Second poll failed', { error: err.message });
    process.exit(1);
  }

  // Verify only one session exists
  const sessions2 = await listSessions();
  const matchingSessions = sessions2.filter(s => s === TEST_SESSION_NAME);
  if (matchingSessions.length === 1) {
    info('✓ Only one session exists (no duplicate)', {
      matchingSessions,
      totalSessions: sessions2.length,
    });
  } else {
    logError('✗ Duplicate session detected', {
      matchingSessions,
      totalSessions: sessions2.length,
    });
    process.exit(1);
  }

  // Test 3: Multiple repeated polls - all should be idempotent
  info('\nTest 3: Multiple repeated polls - all idempotent');
  for (let i = 1; i <= 5; i++) {
    const result = await ensureSession(TEST_SESSION_NAME, TEST_PROJECT_NAME, PROJECT_DATA, COMMAND_TEMPLATE);
    if (!result.created && result.existed) {
      info(`✓ Poll ${i + 2} - idempotent`);
    } else {
      logError(`✗ Poll ${i + 2} - should be idempotent`, { result });
      process.exit(1);
    }
  }

  // Verify still only one session
  const sessions3 = await listSessions();
  const matchingSessions3 = sessions3.filter(s => s === TEST_SESSION_NAME);
  if (matchingSessions3.length === 1) {
    info('✓ After 7 polls, still only one session (no duplicates)');
  } else {
    logError('✗ Duplicate sessions after multiple polls', {
      matchingSessions: matchingSessions3.length,
      totalSessions: sessions3.length,
    });
    process.exit(1);
  }

  // Test 4: Log "created N sessions" each poll simulation
  info('\nTest 4: Simulating "created N sessions" logging per poll');
  const polls = [];
  let totalCreated = 0;

  // Clean up and simulate first poll
  await killSession(TEST_SESSION_NAME);
  const result1 = await ensureSession(TEST_SESSION_NAME, TEST_PROJECT_NAME, PROJECT_DATA, COMMAND_TEMPLATE);
  totalCreated += result1.created ? 1 : 0;
  polls.push({ poll: 1, createdThisPoll: result1.created ? 1 : 0, totalCreated });

  // Simulate second poll
  const result2 = await ensureSession(TEST_SESSION_NAME, TEST_PROJECT_NAME, PROJECT_DATA, COMMAND_TEMPLATE);
  totalCreated += result2.created ? 1 : 0;
  polls.push({ poll: 2, createdThisPoll: result2.created ? 1 : 0, totalCreated });

  info('Poll results:', { polls });

  if (totalCreated === 1 && result1.created && !result2.created) {
    info('✓ Logging pattern verified: first poll created 1 session, second poll created 0');
  } else {
    logError('✗ Unexpected creation pattern', { totalCreated, result1, result2 });
    process.exit(1);
  }

  // Clean up
  await killSession(TEST_SESSION_NAME);
  info('\n✓ All tests passed - idempotent session creation verified');
}

runTests().catch(err => {
  logError('Test runner failed', { error: err.message });
  process.exit(1);
});
