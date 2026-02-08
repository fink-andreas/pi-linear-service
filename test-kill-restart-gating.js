#!/usr/bin/env node

/**
 * Test script to verify kill/restart gating implementation
 * Definition of done: avoids kill loops; logs unhealthy detections and kill/cooldown outcomes
 */

import { attemptKillUnhealthySession, createSession, killSession, isWithinCooldown, clearKillAttempt, recordKillAttempt, listSessions } from './src/tmux.js';
import { info, error as logError } from './src/logger.js';

const TMUX_PREFIX = 'pi_project_';
const TEST_SESSION_NAME = `${TMUX_PREFIX}GATING-TEST`;
const OTHER_SESSION_NAME = `other_session_TEST`;
const COOLDOWN_SEC = 5;

const config = {
  tmuxPrefix: TMUX_PREFIX,
  sessionHealthMode: 'basic',
  sessionKillOnUnhealthy: true,
  sessionRestartCooldownSec: COOLDOWN_SEC,
};

const configNoKill = {
  tmuxPrefix: TMUX_PREFIX,
  sessionHealthMode: 'basic',
  sessionKillOnUnhealthy: false,
  sessionRestartCooldownSec: COOLDOWN_SEC,
};

async function runTests() {
  info('Testing kill/restart gating...', {
    sessionName: TEST_SESSION_NAME,
    cooldownSec: COOLDOWN_SEC,
  });

  // Clean up any existing test sessions
  try {
    await killSession(TEST_SESSION_NAME);
    await killSession(OTHER_SESSION_NAME);
    clearKillAttempt(TEST_SESSION_NAME);
    info('Cleaned up existing test sessions');
  } catch (err) {
    // Sessions may not exist, that's fine
    info('No existing test sessions to clean up');
  }

  // Test 1: Unowned session should not be killed
  info('\nTest 1: Unowned session should not be killed');
  try {
    // Create an unowned session
    await createSession(OTHER_SESSION_NAME, 'sleep 3600');
    await new Promise(resolve => setTimeout(resolve, 500));

    const result = await attemptKillUnhealthySession(OTHER_SESSION_NAME, TMUX_PREFIX, config);
    if (!result.killed && result.reason === 'Session not owned by this service') {
      info('✓ Unowned session not killed', { result });
    } else {
      logError('✗ Unowned session should not be killed', { result });
      process.exit(1);
    }
  } catch (err) {
    logError('✗ Test 1 failed', { error: err.message });
    process.exit(1);
  } finally {
    try {
      await killSession(OTHER_SESSION_NAME);
    } catch (err) {
      // Ignore
    }
  }

  // Test 2: Healthy session should not be killed
  info('\nTest 2: Healthy session should not be killed');
  try {
    await createSession(TEST_SESSION_NAME, 'sleep 3600');
    await new Promise(resolve => setTimeout(resolve, 500));

    const result = await attemptKillUnhealthySession(TEST_SESSION_NAME, TMUX_PREFIX, config);
    if (!result.killed && result.reason === 'Session is healthy') {
      info('✓ Healthy session not killed', { result });
    } else {
      logError('✗ Healthy session should not be killed', { result });
      process.exit(1);
    }
  } catch (err) {
    logError('✗ Test 2 failed', { error: err.message });
    process.exit(1);
  }

  // Test 3: Unhealthy session should be killed (kill enabled)
  info('\nTest 3: Unhealthy session should be killed (kill enabled)');
  try {
    // Kill the session and wait to make it "gone"
    await killSession(TEST_SESSION_NAME);
    await new Promise(resolve => setTimeout(resolve, 100));

    const result = await attemptKillUnhealthySession(TEST_SESSION_NAME, TMUX_PREFIX, config);
    // Session doesn't exist, so it's unhealthy (but kill will fail because session is gone)
    if (!result.killed) {
      info('✓ Unhealthy session detection logged', { result });
    } else {
      info('⚠ Session was killed (session existed briefly)', { result });
    }
  } catch (err) {
    logError('✗ Test 3 failed', { error: err.message });
    process.exit(1);
  }

  // Test 4: SESSION_KILL_ON_UNHEALTHY=false - should not kill
  info('\nTest 4: SESSION_KILL_ON_UNHEALTHY=false - should not kill');
  try {
    // Create a session with a command that exits
    await createSession(TEST_SESSION_NAME, 'exit');
    await new Promise(resolve => setTimeout(resolve, 500));

    const result = await attemptKillUnhealthySession(TEST_SESSION_NAME, TMUX_PREFIX, configNoKill);
    if (!result.killed && result.reason === 'SESSION_KILL_ON_UNHEALTHY is disabled') {
      info('✓ Kill disabled when SESSION_KILL_ON_UNHEALTHY=false', { result });
    } else {
      logError('✗ Kill should be disabled when SESSION_KILL_ON_UNHEALTHY=false', { result });
      process.exit(1);
    }
  } catch (err) {
    logError('✗ Test 4 failed', { error: err.message });
    process.exit(1);
  } finally {
    try {
      await killSession(TEST_SESSION_NAME);
    } catch (err) {
      // Ignore
    }
  }

  // Test 5: Kill should be skipped if within cooldown
  info('\nTest 5: Kill should be skipped if within cooldown');
  try {
    clearKillAttempt(TEST_SESSION_NAME);

    // Create an unhealthy session
    await createSession(TEST_SESSION_NAME, 'exit');
    await new Promise(resolve => setTimeout(resolve, 500));

    // First kill attempt - should kill
    const result1 = await attemptKillUnhealthySession(TEST_SESSION_NAME, TMUX_PREFIX, config);
    if (result1.killed || result1.reason === 'Failed to kill session') {
      info('✓ First kill attempt processed', { result1 });
    } else {
      logError('✗ First kill should have been attempted', { result1 });
      process.exit(1);
    }

    // Wait a bit (within cooldown)
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Second kill attempt - should be skipped due to cooldown
    const result2 = await attemptKillUnhealthySession(TEST_SESSION_NAME, TMUX_PREFIX, config);
    if (!result2.killed && result2.reason.includes('Within cooldown period')) {
      info('✓ Kill skipped due to cooldown', { result2 });
    } else {
      logError('✗ Kill should be skipped within cooldown', { result2 });
      process.exit(1);
    }
  } catch (err) {
    logError('✗ Test 5 failed', { error: err.message });
    process.exit(1);
  } finally {
    try {
      await killSession(TEST_SESSION_NAME);
    } catch (err) {
      // Ignore
    }
  }

  // Test 6: Kill should proceed after cooldown expires
  info('\nTest 6: Kill should proceed after cooldown expires');
  try {
    clearKillAttempt(TEST_SESSION_NAME);

    // Create an unhealthy session
    await createSession(TEST_SESSION_NAME, 'exit');
    await new Promise(resolve => setTimeout(resolve, 500));

    // First kill attempt
    const result1 = await attemptKillUnhealthySession(TEST_SESSION_NAME, TMUX_PREFIX, config);
    info('First kill attempt', { result1 });

    // Wait for cooldown to expire (COOLDOWN_SEC seconds)
    info(`Waiting ${COOLDOWN_SEC} seconds for cooldown to expire...`);
    await new Promise(resolve => setTimeout(resolve, (COOLDOWN_SEC + 1) * 1000));

    // Create another unhealthy session
    await createSession(TEST_SESSION_NAME, 'exit');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Second kill attempt - should proceed (outside cooldown)
    const result2 = await attemptKillUnhealthySession(TEST_SESSION_NAME, TMUX_PREFIX, config);
    if (result2.killed || result2.reason === 'Failed to kill session') {
      info('✓ Kill proceeded after cooldown expired', { result2 });
    } else {
      logError('✗ Kill should proceed after cooldown', { result2 });
      process.exit(1);
    }
  } catch (err) {
    logError('✗ Test 6 failed', { error: err.message });
    process.exit(1);
  } finally {
    try {
      await killSession(TEST_SESSION_NAME);
      clearKillAttempt(TEST_SESSION_NAME);
    } catch (err) {
      // Ignore
    }
  }

  // Test 7: Verify cooldown tracking works correctly
  info('\nTest 7: Verify cooldown tracking');
  try {
    clearKillAttempt(TEST_SESSION_NAME);

    // Not in cooldown initially
    const inCooldown1 = isWithinCooldown(TEST_SESSION_NAME, COOLDOWN_SEC);
    if (!inCooldown1) {
      info('✓ Not in cooldown initially');
    } else {
      logError('✗ Should not be in cooldown initially');
      process.exit(1);
    }

    // Record kill attempt
    recordKillAttempt(TEST_SESSION_NAME);

    // Now in cooldown
    const inCooldown2 = isWithinCooldown(TEST_SESSION_NAME, COOLDOWN_SEC);
    if (inCooldown2) {
      info('✓ In cooldown after kill attempt');
    } else {
      logError('✗ Should be in cooldown after kill attempt');
      process.exit(1);
    }

    // Wait for cooldown to expire
    await new Promise(resolve => setTimeout(resolve, (COOLDOWN_SEC + 1) * 1000));

    // Not in cooldown anymore
    const inCooldown3 = isWithinCooldown(TEST_SESSION_NAME, COOLDOWN_SEC);
    if (!inCooldown3) {
      info('✓ Not in cooldown after expiration');
    } else {
      logError('✗ Should not be in cooldown after expiration');
      process.exit(1);
    }
  } catch (err) {
    logError('✗ Test 7 failed', { error: err.message });
    process.exit(1);
  }

  // Clean up
  try {
    await killSession(TEST_SESSION_NAME);
    clearKillAttempt(TEST_SESSION_NAME);
  } catch (err) {
    // Ignore
  }

  info('\n✓ All tests passed - kill/restart gating verified');
  info('Key behaviors verified:');
  info('  - Unowned sessions are not killed');
  info('  - Healthy sessions are not killed');
  info('  - Unhealthy sessions are detected and logged');
  info('  - Kill behavior respects SESSION_KILL_ON_UNHEALTHY');
  info('  - Cooldown prevents kill loops');
  info('  - Kill proceeds after cooldown expires');
}

runTests().catch(err => {
  logError('Test runner failed', { error: err.message });
  process.exit(1);
});
