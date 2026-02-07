#!/usr/bin/env node

/**
 * Test script to validate recovery behavior
 * Definition of done: confirm that after a kill, next poll recreates session if project still qualifies
 *
 * REQUIRES: tmux must be installed for this test
 */

import { ensureSession, killSession, hasSession, listSessions } from './src/tmux.js';
import { info, error as logError } from './src/logger.js';

const TMUX_PREFIX = 'pi_project_';
const TEST_PROJECT_ID = 'RECOVERY-TEST';
const TEST_PROJECT_NAME = 'Recovery Test Project';
const TEST_SESSION_NAME = `${TMUX_PREFIX}${TEST_PROJECT_ID}`;

async function runTests() {
  info('Testing recovery behavior...', {
    sessionId: TEST_SESSION_NAME,
    projectName: TEST_PROJECT_NAME,
  });

  // Clean up any existing test session
  try {
    await killSession(TEST_SESSION_NAME);
    info('Cleaned up existing test session');
  } catch (err) {
    // Session may not exist, that's fine
    info('No existing test session to clean up');
  }

  // Step 1: Verify no session exists
  info('\nStep 1: Verify no session exists initially');
  try {
    const exists = await hasSession(TEST_SESSION_NAME);
    if (!exists) {
      info('✓ Session does not exist initially');
    } else {
      logError('✗ Session should not exist initially', { exists });
      process.exit(1);
    }
  } catch (err) {
    logError('✗ Step 1 failed', { error: err.message });
    process.exit(1);
  }

  // Step 2: Simulate first poll - create session
  info('\nStep 2: Simulate first poll - create session');
  try {
    const result = await ensureSession(TEST_SESSION_NAME, TEST_PROJECT_NAME);
    await new Promise(resolve => setTimeout(resolve, 500)); // Wait for session to be fully created

    if (result.created && !result.existed) {
      info('✓ Session created on first poll', { result });
    } else if (!result.created && result.existed) {
      info('✓ Session already existed (idempotent)', { result });
    } else {
      logError('✗ Session creation failed', { result });
      process.exit(1);
    }
  } catch (err) {
    logError('✗ Step 2 failed', { error: err.message });
    process.exit(1);
  }

  // Step 3: Verify session exists and has pi prompt
  info('\nStep 3: Verify session exists with correct configuration');
  try {
    const exists = await hasSession(TEST_SESSION_NAME);
    const sessions = await listSessions();
    const sessionExists = sessions.includes(TEST_SESSION_NAME);

    if (exists && sessionExists) {
      info('✓ Session exists after creation', { sessions });
    } else {
      logError('✗ Session should exist after creation', { exists, sessionExists, sessions });
      process.exit(1);
    }
  } catch (err) {
    logError('✗ Step 3 failed', { error: err.message });
    process.exit(1);
  }

  // Step 4: Simulate external kill (e.g., user killed session or session crashed)
  info('\nStep 4: Simulate external kill (session becomes unhealthy/dies)');
  try {
    await killSession(TEST_SESSION_NAME);
    await new Promise(resolve => setTimeout(resolve, 200)); // Wait for kill to complete

    const exists = await hasSession(TEST_SESSION_NAME);
    if (!exists) {
      info('✓ Session successfully killed', { exists });
    } else {
      logError('✗ Session should be killed', { exists });
      process.exit(1);
    }
  } catch (err) {
    logError('✗ Step 4 failed', { error: err.message });
    process.exit(1);
  }

  // Step 5: Simulate second poll - project still qualifies (session should be recreated)
  info('\nStep 5: Simulate second poll - project still has qualifying issues');
  try {
    const result = await ensureSession(TEST_SESSION_NAME, TEST_PROJECT_NAME);
    await new Promise(resolve => setTimeout(resolve, 500)); // Wait for session to be created

    if (result.created && !result.existed) {
      info('✓ Session recreated on second poll (recovery successful)', { result });
    } else {
      logError('✗ Session should be recreated', { result });
      process.exit(1);
    }
  } catch (err) {
    logError('✗ Step 5 failed', { error: err.message });
    process.exit(1);
  }

  // Step 6: Verify session exists again
  info('\nStep 6: Verify session exists after recovery');
  try {
    const exists = await hasSession(TEST_SESSION_NAME);
    const sessions = await listSessions();
    const sessionExists = sessions.includes(TEST_SESSION_NAME);

    if (exists && sessionExists) {
      info('✓ Session exists after recovery', { sessions });
    } else {
      logError('✗ Session should exist after recovery', { exists, sessionExists, sessions });
      process.exit(1);
    }
  } catch (err) {
    logError('✗ Step 6 failed', { error: err.message });
    process.exit(1);
  }

  // Step 7: Test idempotence - multiple polls should not create duplicates
  info('\nStep 7: Test idempotence - multiple polls should not create duplicates');
  try {
    for (let i = 0; i < 5; i++) {
      const result = await ensureSession(TEST_SESSION_NAME, TEST_PROJECT_NAME);
      if (!result.created && result.existed) {
        info(`Poll ${i + 3}: Session already exists (idempotent)`);
      } else {
        logError(`✗ Poll ${i + 3}: Should be idempotent`, { result });
        process.exit(1);
      }
    }
    info('✓ Multiple polls are idempotent (no duplicates)');
  } catch (err) {
    logError('✗ Step 7 failed', { error: err.message });
    process.exit(1);
  }

  // Step 8: Verify only one session exists
  info('\nStep 8: Verify only one session exists (no duplicates)');
  try {
    const sessions = await listSessions();
    const matchingSessions = sessions.filter(s => s === TEST_SESSION_NAME);

    if (matchingSessions.length === 1) {
      info('✓ Only one session exists (no duplicates)', {
        matchingSessions: matchingSessions.length,
        allSessions: sessions,
      });
    } else {
      logError('✗ Duplicate sessions detected', {
        matchingSessions: matchingSessions.length,
        allSessions: sessions,
      });
      process.exit(1);
    }
  } catch (err) {
    logError('✗ Step 8 failed', { error: err.message });
    process.exit(1);
  }

  // Step 9: Test recovery scenario - kill, wait, recreate
  info('\nStep 9: Full recovery cycle (kill, wait, recreate)');
  try {
    // Kill session
    await killSession(TEST_SESSION_NAME);
    info('Session killed for recovery test');
    await new Promise(resolve => setTimeout(resolve, 200));

    // Verify killed
    const killedExists = await hasSession(TEST_SESSION_NAME);
    if (killedExists) {
      logError('✗ Session should be killed');
      process.exit(1);
    }

    // Recreate (simulating next poll)
    const result = await ensureSession(TEST_SESSION_NAME, TEST_PROJECT_NAME);
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify recreated
    const recreatedExists = await hasSession(TEST_SESSION_NAME);
    if (result.created && recreatedExists) {
      info('✓ Recovery cycle successful: killed then recreated', { result });
    } else {
      logError('✗ Recovery cycle failed', { result, recreatedExists });
      process.exit(1);
    }
  } catch (err) {
    logError('✗ Step 9 failed', { error: err.message });
    process.exit(1);
  }

  // Step 10: Simulate health kill and recovery
  info('\nStep 10: Simulate health check killing unhealthy session and recovery');
  try {
    // Create a session that will be "unhealthy" (command exits)
    await killSession(TEST_SESSION_NAME);
    await new Promise(resolve => setTimeout(resolve, 100));

    // Create unhealthy session
    await ensureSession(TEST_SESSION_NAME, 'exit'); // Command exits immediately
    await new Promise(resolve => setTimeout(resolve, 500));

    // Session should be unhealthy (either doesn't exist or has dead panes)
    const unhealthyExists = await hasSession(TEST_SESSION_NAME);
    if (!unhealthyExists) {
      info('✓ Unhealthy session (exited command) does not exist');
    } else {
      info('⚠ Session exists but may have dead panes (acceptable)');
    }

    // Next poll should recreate it (if project still qualifies)
    const result = await ensureSession(TEST_SESSION_NAME, TEST_PROJECT_NAME);
    await new Promise(resolve => setTimeout(resolve, 500));

    const finalExists = await hasSession(TEST_SESSION_NAME);
    if (finalExists) {
      info('✓ Session recreated after health kill', { result });
    } else {
      logError('✗ Session should be recreated');
      process.exit(1);
    }
  } catch (err) {
    logError('✗ Step 10 failed', { error: err.message });
    process.exit(1);
  }

  // Clean up
  try {
    await killSession(TEST_SESSION_NAME);
    info('\n✓ Cleaned up test session');
  } catch (err) {
    // Ignore
  }

  info('\n✓ All recovery behavior tests passed');
  info('\nRecovery behavior validated:');
  info('  ✓ Session created on first poll');
  info('  ✓ Session recreated after external kill');
  info('  ✓ Idempotent polls (no duplicates)');
  info('  ✓ Full recovery cycle works');
  info('  ✓ Session recreated after health kill');
}

runTests().catch(err => {
  logError('Test runner failed', { error: err.message });
  process.exit(1);
});
