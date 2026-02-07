#!/usr/bin/env node

/**
 * Test script to verify tmux command runner implementation
 * Definition of done: tmux -V and tmux list-sessions calls work
 */

import { getTmuxVersion, listSessions, execTmux } from './src/tmux.js';
import { info, error as logError } from './src/logger.js';

async function runTests() {
  info('Testing tmux command runner implementation...');

  // Test 1: tmux -V
  try {
    info('Test 1: Getting tmux version...');
    const version = await getTmuxVersion();
    if (version) {
      info('✓ tmux -V works', { version });
    } else {
      logError('✗ tmux -V failed: no version returned');
    }
  } catch (err) {
    logError('✗ tmux -V failed with error', { error: err.message });
  }

  // Test 2: tmux list-sessions
  try {
    info('Test 2: Listing tmux sessions...');
    const sessions = await listSessions();
    info('✓ tmux list-sessions works', { sessionCount: sessions.length, sessions });
  } catch (err) {
    logError('✗ tmux list-sessions failed with error', { error: err.message });
  }

  // Test 3: Verify return codes, stdout/stderr capture
  try {
    info('Test 3: Verifying return codes and output capture...');

    // Valid command
    const result1 = await execTmux(['-V']);
    if (result1.exitCode === 0 && result1.stdout) {
      info('✓ Valid command returns exitCode 0 with stdout', {
        exitCode: result1.exitCode,
        stdout: result1.stdout,
      });
    } else {
      logError('✗ Valid command failed', { result: result1 });
    }

    // Invalid command (will have non-zero exit code)
    const result2 = await execTmux(['invalid-command']);
    if (result2.exitCode !== 0) {
      info('✓ Invalid command returns non-zero exit code', {
        exitCode: result2.exitCode,
        stderr: result2.stderr,
      });
    } else {
      logError('✗ Invalid command should have non-zero exit code', { result: result2 });
    }
  } catch (err) {
    logError('✗ Return code/output capture test failed', { error: err.message });
  }

  info('Tests completed');
  process.exit(0);
}

runTests().catch(err => {
  logError('Test runner failed', { error: err.message });
  process.exit(1);
});
