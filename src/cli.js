import { boot } from './app.js';
import { installService, uninstallService, serviceStatus } from './service-cli.js';

function printHelp() {
  console.log(`pi-linear-service

Usage:
  pi-linear-service start
  pi-linear-service service install [--working-dir <dir>] [--env-file <path>] [--unit-name <name>] [--node-path <path>] [--no-systemctl]
  pi-linear-service service uninstall [--unit-name <name>] [--no-systemctl]
  pi-linear-service service status [--unit-name <name>]
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

  printHelp();
  process.exitCode = 1;
}
