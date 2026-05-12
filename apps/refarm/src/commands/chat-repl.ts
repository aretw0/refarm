/**
 * Pure REPL command parsing — no I/O, no Node.js deps.
 * All functions here are unit-testable without stubs.
 */

export type ChatCommand =
	| { kind: "message"; text: string }
	| { kind: "reload" }
	| { kind: "new" }
	| { kind: "session"; prefix: string }
	| { kind: "exit" }
	| { kind: "help" };

const SLASH_COMMANDS: Record<string, ChatCommand> = {
	reload: { kind: "reload" },
	new: { kind: "new" },
	exit: { kind: "exit" },
	quit: { kind: "exit" },
	help: { kind: "help" },
};

export function parseChatLine(line: string): ChatCommand {
	const trimmed = line.trim();

	if (!trimmed.startsWith("/")) {
		return { kind: "message", text: trimmed };
	}

	const withoutSlash = trimmed.slice(1);
	const [name, ...rest] = withoutSlash.split(/\s+/);
	const commandName = (name ?? "").toLowerCase();

	if (commandName === "session") {
		const prefix = rest.join(" ").trim();
		return prefix.length > 0
			? { kind: "session", prefix }
			: { kind: "message", text: trimmed };
	}

	return SLASH_COMMANDS[commandName] ?? { kind: "message", text: trimmed };
}

export const CHAT_HELP_TEXT = `Available commands:
  /reload           Hot-reload plugins in farmhand
  /new              Start a fresh session
  /session <prefix> Switch to session matching prefix
  /exit  or  /quit  Exit refarm chat
  /help             Show this message

Any other input is sent as a message to the agent.`;
