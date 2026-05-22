/**
 * Pure REPL command parsing — no I/O, no Node.js deps.
 * All functions here are unit-testable without stubs.
 */

import { normalizePluginId } from "@refarm.dev/config";
import { splitCommandLine } from "@refarm.dev/cli/command-line";
import {
	defaultProviderModelRef,
	defaultScopedModelRef,
	isModelScope,
	type ModelScope,
} from "../model-routing.js";

const OPENAI_DEFAULT_REF = defaultProviderModelRef("openai");
const OPENAI_WORKER_REF = defaultScopedModelRef("worker", "openai");
const OPENAI_MONITOR_REF = defaultScopedModelRef("monitor", "openai");

export type ChatCommand =
	| { kind: "message"; text: string }
	| { kind: "reload"; pluginIds: string[] }
	| { kind: "model"; action: "current" }
	| { kind: "model"; action: "set"; scope: ModelScope; ref: string }
	| { kind: "model"; action: "fallback"; ref: string }
	| { kind: "model"; action: "base-url"; url: string }
	| { kind: "login"; args: string[] }
	| { kind: "new" }
	| { kind: "session"; prefix: string }
	| { kind: "exit" }
	| { kind: "help" };

const SLASH_COMMANDS: Record<string, ChatCommand> = {
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
	let parts: string[];
	try {
		parts = splitCommandLine(withoutSlash, "refarm chat command");
	} catch {
		return { kind: "message", text: trimmed };
	}
	const [name, ...rest] = parts;
	const commandName = (name ?? "").toLowerCase();

	if (commandName === "session") {
		const prefix = rest.join(" ").trim();
		return prefix.length > 0
			? { kind: "session", prefix }
			: { kind: "message", text: trimmed };
	}

	if (commandName === "reload") {
		return { kind: "reload", pluginIds: rest.filter(Boolean).map(normalizePluginId) };
	}

	if (commandName === "model") {
		return parseModelCommand(rest, trimmed);
	}

	if (commandName === "login" || commandName === "sow") {
		return { kind: "login", args: rest.filter(Boolean) };
	}

	return SLASH_COMMANDS[commandName] ?? { kind: "message", text: trimmed };
}

function parseModelCommand(args: string[], fallbackText: string): ChatCommand {
	const [firstRaw, ...rest] = args.filter(Boolean);
	const first = firstRaw?.toLowerCase();

	if (!first || first === "current") {
		return { kind: "model", action: "current" };
	}

	if (first === "set") {
		return parseModelSetArgs(rest, fallbackText);
	}

	if (first === "fallback") {
		const ref = rest.join(" ").trim();
		return ref.length > 0
			? { kind: "model", action: "fallback", ref }
			: { kind: "message", text: fallbackText };
	}

	if (first === "base-url") {
		const url = rest.join(" ").trim();
		return url.length > 0
			? { kind: "model", action: "base-url", url }
			: { kind: "message", text: fallbackText };
	}

	if (isModelScope(first)) {
		const ref = rest.join(" ").trim();
		return ref.length > 0
			? { kind: "model", action: "set", scope: first, ref }
			: { kind: "message", text: fallbackText };
	}

	return {
		kind: "model",
		action: "set",
		scope: "default",
		ref: [firstRaw, ...rest].join(" ").trim(),
	};
}

function parseModelSetArgs(args: string[], fallbackText: string): ChatCommand {
	let scope: ModelScope = "default";
	const refParts: string[] = [];

	for (let index = 0; index < args.length; index++) {
		const value = args[index];
		if (value === "--scope") {
			const next = args[index + 1];
			if (!isModelScope(next)) return { kind: "message", text: fallbackText };
			scope = next;
			index++;
			continue;
		}
		if (value) refParts.push(value);
	}

	const ref = refParts.join(" ").trim();
	return ref.length > 0
		? { kind: "model", action: "set", scope, ref }
		: { kind: "message", text: fallbackText };
}

export const CHAT_HELP_TEXT = `Available commands:
  /reload [id...]   Hot-reload plugins in the Refarm runtime, e.g. /reload pi-agent
  /model            Show the active model route
  /model <ref>      Set the default model route, e.g. ${OPENAI_DEFAULT_REF}
  /model worker ${OPENAI_WORKER_REF}
  /model monitor ${OPENAI_MONITOR_REF}
  /model base-url http://127.0.0.1:8000
  /model fallback ollama/llama3.2
  /login [args...]  Configure credentials without leaving the session
  /new              Start a fresh session
  /session <prefix> Switch to session matching prefix
  /exit  or  /quit  Exit refarm chat
  /help             Show this message

Any other input is sent as a message to the agent.`;
