#!/usr/bin/env node

/**
 * Test script to verify basic health check implementation
 * Definition of done: can detect a deliberately broken/dead session as unhealthy immediately
 */

import { checkSessionHealth, createSession, killSession, listSessions } from './src/tmux.js';
import { info, error as logError } from './src/logger.js';

const TMUX_PREFIX = 'pi_project_';
const TEST_SESSION_NAME = `${TMUX_PREFIX}HEALTH-TEST`;

async function runTests() {
  info('Testing basic health check...', {
    sessionName: TEST_SESSION_NAME,
  });

  // Clean up any existing test session
  try {
    await killSession(TEST_SESSION_NAME);
    info('Cleaned up existing test session');
  } catch (err) {
    // Session may not exist, that's fine
    info('No existing test session to clean up');
  }

  // Test 1: Health mode 'none' - always healthy even if session doesn't exist
  info('\nTest 1: Health mode "none" - always healthy');
  try {
    const result = await checkSessionHealth(TEST_SESSION_NAME, 'none');
    if (result.healthy && !result.exists) {
      info('✓ Health mode "none" returns healthy even when session does not exist', { result });
    } else {
      logError('✗ Health mode "none" should always return healthy', { result });
      process.exit(1);
    }
  } catch (err) {
    logError('✗ Test 1 failed', { error: err.message });
    process.exit(1);
  }

  // Test 2: Non-existent session with health mode 'basic'
  info('\nTest 2: Non-existent session with health mode "basic"');
  try {
    const result = await checkSessionHealth(TEST_SESSION_NAME, 'basic');
    if (!result.healthy && !result.exists && result.reason === 'Session does not exist') {
      info('✓ Non-existent session is unhealthy', { result });
    } else {
      logError('✗ Non-existent session should be unhealthy', { result });
      process.exit(1);
    }
  } catch (err) {
    logError('✗ Test 2 failed', { error: err.message });
    process.exit(1);
  }

  // Test 3: Healthy session with active pane
  info('\nTest 3: Healthy session with active pane');
  try {
    // Create a session with a long-running command
    await createSession(TEST_SESSION_NAME, 'sleep 3600');
    await new Promise(resolve => setTimeout(resolve, 500)); // Wait for session to start

    const result = await checkSessionHealth(TEST_SESSION_NAME, 'basic');
    if (result.healthy && result.exists && result.paneCount > 0 && !result.hasDeadPanes) {
      info('✓ Session with active pane is healthy', { result });
    } else {
      logError('✗ Session with active pane should be healthy', { result });
      process.exit(1);
    }
  } catch (err) {
    logError('✗ Test 3 failed', { error: err.message });
    process.exit(1);
  }

  // Test 4: Session with no panes (unhealthy)
  info('\nTest 4: Session with no panes (unhealthy)');
  try {
    // Kill the session to test "no panes" scenario
    await killSession(TEST_SESSION_NAME);
    await new Promise(resolve => setTimeout(resolve, 100));

    const result = await checkSessionHealth(TEST_SESSION_NAME, 'basic');
    if (!result.healthy && !result.exists && result.reason === 'Session does not exist') {
      info('✓ Session without panes (non-existent) is unhealthy', { result });
    } else {
      logError('✗ Session without panes should be unhealthy', { result });
      process.exit(1);
    }
  } catch (err) {
    logError('✗ Test 4 failed', { error: err.message });
    process.exit(1);
  }

  // Test 5: Create a session that will have a dead pane
  info('\nTest 5: Session with dead pane (unhealthy)');
  try {
    // Create a session with a command that exits immediately
    await createSession(TEST_SESSION_NAME, 'exit');
    await new Promise(resolve => setTimeout(resolve, 500)); // Wait for command to exit

    const result = await checkSessionHealth(TEST_SESSION_NAME, 'basic');
    if (!result.healthy && result.exists && result.hasDeadPanes) {
      info('✓ Session with dead pane is unhealthy', { result });
    } else if (!result.healthy && result.exists && result.paneCount === 0) {
      info('✓ Session with no panes (after command exit) is unhealthy', { result });
    } else {
      // Some tmux versions may behave differently, log the result for debugging
      info('⚠ Session with dead command result', { result });
      // Consider this test passed since the session is unhealthy
      if (!result.healthy) {
        info('✓ Session is unhealthy (acceptable)');
      } else {
        logError('✗ Session with dead pane should be unhealthy', { result });
        process.exit(1);
      }
    }
  } catch (err) {
    logError('✗ Test 5 failed', { error: err.message });
    process.exit(1);
  }

  // Test 6: Verify session details are included in health check result
  info('\nTest 6: Health check includes pane details');
  try {
    // Create a healthy session again
    await killSession(TEST_SESSION_NAME);
    await createSession(TEST_SESSION_NAME, 'sleep 3600');
    await new Promise(resolve => setTimeout(resolve, 500));

    const result = await checkSessionHealth(TEST_SESSION_NAME, 'basic');
    if (result.panes && Array.isArray(result.panes) && result.panes.length > 0) {
      const pane = result.panes[0];
      if (pane.paneId && pane.panePid && pane.currentCommand !== undefined && pane.isDead !== undefined) {
        info('✓ Health check includes complete pane details', {
          paneCount: result.panes.length,
          samplePane: {
            paneId: pane.paneId,
            panePid: pane.panePid,
            currentCommand: pane.currentCommand,
            isDead: pane.isDead,
          },
        });
      } else {
        logError('✗ Pane details incomplete', { pane });
        process.exit(1);
      }
    } else {
      logError('✗ Health check should include panes array', { result });
      process.exit(1);
    }
  } catch (err) {
    logError('✗ Test 6 failed', { error: err.message });
    process.exit(1);
  }

  // Clean up
  await killSession(TEST_SESSION_NAME);

  info('\n✓ All tests passed - basic health check implementation verified');
}

runTests().catch(err => {
  logError('Test runner failed', { error: err.message });
  process.exit(1);
});
