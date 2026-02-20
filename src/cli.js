import { boot } from './app.js';
import { installService, uninstallService, serviceStatus } from './service-cli.js';
import {
  setupProjectDaemon,
  reconfigureProjectDaemon,
  disableProjectDaemon,
  daemonStatus,
  daemonStart,
  daemonStop,
  daemonRestart,
} from './daemon-control.js';

function printHelp() {
  console.log(`pi-linear-service

Usage:
  pi-linear-service start
  pi-linear-service service install [--working-dir <dir>] [--env-file <path>] [--unit-name <name>] [--node-path <path>] [--no-systemctl]
  pi-linear-service service uninstall [--unit-name <name>] [--no-systemctl]
  pi-linear-service service status [--unit-name <name>]
  pi-linear-service daemon setup --project-id <id> --repo-path <path> [--project-name <name>] [--open-states "Todo,In Progress"] [--assignee me|all]
  pi-linear-service daemon reconfigure --project-id <id> [--repo-path <path>] [--project-name <name>] [--open-states "Todo,In Progress"] [--assignee me|all]
  pi-linear-service daemon disable --project-id <id>
  pi-linear-service daemon status --project-id <id>
  pi-linear-service daemon start|stop|restart [--unit-name <name>]
  pi-linear-service --help
`);
}

export async function runCli(argv = process.argv.slice(2)) {
  const [command, subcommand, ...restArgs] = argv;

  if (!command || command === 'start') {
    await boot();
    return;
  }

  if (command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    return;
  }

  if (command === 'service') {
    if (subcommand === 'install') {
      await installService(restArgs);
      return;
    }

    if (subcommand === 'uninstall') {
      await uninstallService(restArgs);
      return;
    }

    if (subcommand === 'status') {
      await serviceStatus(restArgs);
      return;
    }

    printHelp();
    process.exitCode = 1;
    return;
  }

  if (command === 'daemon') {
    if (subcommand === 'setup') {
      await setupProjectDaemon(restArgs);
      return;
    }

    if (subcommand === 'reconfigure') {
      await reconfigureProjectDaemon(restArgs);
      return;
    }

    if (subcommand === 'disable') {
      await disableProjectDaemon(restArgs);
      return;
    }

    if (subcommand === 'status') {
      await daemonStatus(restArgs);
      return;
    }

    if (subcommand === 'start') {
      await daemonStart(restArgs);
      return;
    }

    if (subcommand === 'stop') {
      await daemonStop(restArgs);
      return;
    }

    if (subcommand === 'restart') {
      await daemonRestart(restArgs);
      return;
    }

    printHelp();
    process.exitCode = 1;
    return;
  }

  printHelp();
  process.exitCode = 1;
}
