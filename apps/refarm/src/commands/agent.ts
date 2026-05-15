import { Command } from "commander";

// Agent runtime commands (start, stop, repl, status) land here.
// Plugin lifecycle (install, update, list) belongs in `refarm plugin`.
export const agentCommand = new Command("agent").description(
	"Interact with the running agent (coming soon)",
);
