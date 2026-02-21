import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { info, error } from './logger.js';

const UNIT_NAME = 'pi-linear-service.service';

export function getDefaultUnitName() {
  return UNIT_NAME;
}

function parseFlagValue(args, names, fallback) {
  for (let i = 0; i < args.length; i += 1) {
    if (names.includes(args[i]) && args[i + 1]) {
      return args[i + 1];
    }
  }
  return fallback;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function resolveCliPath() {
  const currentFile = fileURLToPath(import.meta.url);
  const srcDir = dirname(currentFile);
  return resolve(srcDir, '..', 'bin', 'pi-linear-service.js');
}

function resolveOptions(args = []) {
  // Permanent .env location that survives extension reinstalls
  const permanentEnvPath = join(homedir(), '.pi', 'agent', 'extensions', 'pi-linear-service', '.env');
  const workingDir = resolve(parseFlagValue(args, ['--working-dir', '-w'], process.cwd()));
  const envFile = parseFlagValue(args, ['--env-file', '-e'], permanentEnvPath);
  const unitName = parseFlagValue(args, ['--unit-name'], UNIT_NAME);
  const nodePath = parseFlagValue(args, ['--node-path'], process.execPath);
  const noSystemctl = hasFlag(args, '--no-systemctl');

  return {
    workingDir,
    envFile,
    unitName,
    nodePath,
    cliPath: resolveCliPath(),
    noSystemctl
  };
}

function userUnitDir() {
  return join(homedir(), '.config', 'systemd', 'user');
}

function buildUnitContent({ nodePath, cliPath, workingDir, envFile }) {
  return `[Unit]\nDescription=pi-linear-service - Node.js daemon for Linear + pi integration\nDocumentation=https://github.com/fink-andreas/pi-linear-service\n\n[Service]\nType=simple\nRestart=on-failure\nRestartSec=5s\nWorkingDirectory=${workingDir}\nEnvironmentFile=-${envFile}\nExecStart=${nodePath} ${cliPath} start\nNoNewPrivileges=true\nPrivateTmp=true\nStandardOutput=journal\nStandardError=journal\nSyslogIdentifier=pi-linear\n\n[Install]\nWantedBy=default.target\n`;
}

function runSystemctl(args) {
  const result = spawnSync('systemctl', ['--user', ...args], {
    stdio: 'pipe',
    encoding: 'utf-8'
  });

  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || 'Unknown systemctl error').trim();
    throw new Error(details);
  }

  return (result.stdout || '').trim();
}

export async function startService(args = []) {
  const options = resolveOptions(args);
  if (options.noSystemctl) {
    info('Skipped systemctl start (--no-systemctl)', { unitName: options.unitName });
    return;
  }
  runSystemctl(['start', options.unitName]);
  info('Systemd user unit started', { unitName: options.unitName });
}

export async function stopService(args = []) {
  const options = resolveOptions(args);
  if (options.noSystemctl) {
    info('Skipped systemctl stop (--no-systemctl)', { unitName: options.unitName });
    return;
  }
  runSystemctl(['stop', options.unitName]);
  info('Systemd user unit stopped', { unitName: options.unitName });
}

export async function restartService(args = []) {
  const options = resolveOptions(args);
  if (options.noSystemctl) {
    info('Skipped systemctl restart (--no-systemctl)', { unitName: options.unitName });
    return;
  }
  runSystemctl(['restart', options.unitName]);
  info('Systemd user unit restarted', { unitName: options.unitName });
}

export function isServiceActive(args = []) {
  const options = resolveOptions(args);
  if (options.noSystemctl) {
    return null;
  }

  const result = spawnSync('systemctl', ['--user', 'is-active', options.unitName], {
    stdio: 'pipe',
    encoding: 'utf-8'
  });

  if (result.status === 0) return true;
  if (result.status === 3) return false; // inactive
  return false;
}

export async function installService(args = []) {
  const options = resolveOptions(args);
  const unitDir = userUnitDir();
  const unitPath = join(unitDir, options.unitName);

  await mkdir(unitDir, { recursive: true });
  await writeFile(unitPath, buildUnitContent(options), 'utf-8');

  info('Systemd user unit written', {
    unitPath,
    workingDir: options.workingDir,
    envFile: options.envFile,
    nodePath: options.nodePath
  });

  if (options.noSystemctl) {
    info('Skipped systemctl execution (--no-systemctl)', { unitName: options.unitName });
    return;
  }

  try {
    runSystemctl(['daemon-reload']);
    runSystemctl(['enable', '--now', options.unitName]);
    info('Systemd user unit enabled and started', { unitName: options.unitName });
  } catch (err) {
    error('Failed to enable/start systemd user unit', {
      unitName: options.unitName,
      error: err.message
    });
    throw err;
  }
}

export async function uninstallService(args = []) {
  const options = resolveOptions(args);
  const unitDir = userUnitDir();
  const unitPath = join(unitDir, options.unitName);

  if (!options.noSystemctl) {
    try {
      runSystemctl(['disable', '--now', options.unitName]);
    } catch (err) {
      info('Disable/stop skipped or failed (continuing cleanup)', {
        unitName: options.unitName,
        error: err.message
      });
    }
  }

  if (existsSync(unitPath)) {
    await rm(unitPath);
    info('Removed systemd user unit file', { unitPath });
  }

  if (!options.noSystemctl) {
    runSystemctl(['daemon-reload']);
    info('Reloaded systemd user daemon', { unitName: options.unitName });
  }
}

export async function serviceStatus(args = []) {
  const options = resolveOptions(args);

  if (options.noSystemctl) {
    info('Status requires systemctl; --no-systemctl was provided', { unitName: options.unitName });
    return;
  }

  const result = spawnSync('systemctl', ['--user', 'status', options.unitName, '--no-pager'], {
    stdio: 'inherit'
  });

  process.exitCode = result.status ?? 1;
}
