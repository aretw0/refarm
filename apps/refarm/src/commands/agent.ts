import { Command } from "commander";

// Agent runtime commands (status, repl, start/stop) live here.
// Plugin lifecycle (install, update, list) is in `refarm plugin`.
export const agentCommand = new Command("agent").description(
	"Manage the refarm AI agent",
).addHelpText(
	"after",
	`

Runtime commands:
  $ refarm runtime              Inspect selected runtime engine and autostart
  $ refarm status               Check runtime, plugins, streams, and trust state
  $ refarm doctor               Diagnose readiness and repair hints

Agent usage:
  $ refarm ask "hello"          Send one prompt through the configured runtime
  $ refarm                     Start or resume an interactive session

Plugin lifecycle:
  $ refarm plugin list          Show bundled plugin install state
  $ refarm plugin install       Install bundled plugins such as @refarm/pi-agent

Notes:
  This command is kept as the stable namespace for future agent runtime controls.
  Today, use runtime/status/doctor for the host and plugin for installation.
`,
);
