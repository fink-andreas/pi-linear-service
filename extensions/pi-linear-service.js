export default function piLinearServiceExtension(pi) {
  pi.registerCommand("linear-daemon-help", {
    description: "Show pi-linear-service daemon commands",
    handler: async (_args, ctx) => {
      const lines = [
        "pi-linear-service daemon setup --project-id <id> --repo-path <path>",
        "pi-linear-service daemon reconfigure --project-id <id> [--repo-path <path>]",
        "pi-linear-service daemon disable --project-id <id>",
        "pi-linear-service daemon status --project-id <id>",
        "pi-linear-service daemon start|stop|restart",
      ];

      if (ctx.hasUI) {
        ctx.ui.notify("pi-linear-service extension loaded", "info");
      }

      pi.sendMessage({
        customType: "pi-linear-service",
        content: `Available daemon commands:\n${lines.join("\n")}`,
        display: true,
      });
    },
  });
}
