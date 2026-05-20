import { Command } from "commander";

// Agent runtime commands (status, repl, start/stop) live here.
// Plugin lifecycle (install, update, list) is in `refarm plugin`.
export const agentCommand = new Command("agent").description(
	"Manage the refarm AI agent",
);
