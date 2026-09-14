import { refarmCommand } from "../brand.js";

export const MODEL_CREDENTIALS_MISSING_MESSAGE = "No usable model credentials configured.";
export const MODEL_CREDENTIALS_SETUP_COMMAND = refarmCommand(["sow"]);
export const MODEL_CREDENTIALS_INSPECT_ROUTE_COMMAND = refarmCommand(["model", "current"]);
export const MODEL_CREDENTIALS_LIST_PROVIDERS_COMMAND = refarmCommand(["model", "providers"]);
export const MODEL_CREDENTIALS_OLLAMA_SERVE_COMMAND = "ollama serve";

export interface ModelCredentialGuidanceCommands {
	setup: string;
	inspectRoute: string;
	listProviders: string;
	ollamaServe: string;
}

const DEFAULT_MODEL_CREDENTIAL_GUIDANCE_COMMANDS: ModelCredentialGuidanceCommands = {
	setup: MODEL_CREDENTIALS_SETUP_COMMAND,
	inspectRoute: MODEL_CREDENTIALS_INSPECT_ROUTE_COMMAND,
	listProviders: MODEL_CREDENTIALS_LIST_PROVIDERS_COMMAND,
	ollamaServe: MODEL_CREDENTIALS_OLLAMA_SERVE_COMMAND,
};

function formatCommand(command: string, wrapCommands: boolean): string {
	return wrapCommands ? `\`${command}\`` : command;
}

export function missingModelCredentialActionLines(options?: {
	includeOllama?: boolean;
	wrapCommands?: boolean;
	commands?: Partial<ModelCredentialGuidanceCommands>;
}): string[] {
	const includeOllama = options?.includeOllama ?? true;
	const wrapCommands = options?.wrapCommands ?? false;
	const commands = { ...DEFAULT_MODEL_CREDENTIAL_GUIDANCE_COMMANDS, ...(options?.commands ?? {}) };
	const setup = formatCommand(commands.setup, wrapCommands);
	const inspect = formatCommand(commands.inspectRoute, wrapCommands);
	const providers = formatCommand(commands.listProviders, wrapCommands);
	const ollamaServe = formatCommand(commands.ollamaServe, wrapCommands);
	const lines = [
		`Set up credentials: ${setup}`,
		`Inspect route:      ${inspect}`,
		`List providers:     ${providers}`,
	];
	if (includeOllama) {
		lines.push(`Or use Ollama:      ${ollamaServe}  (then ${setup})`);
	}
	return lines;
}

export function missingModelCredentialDeferredLines(): string[] {
	const lines = missingModelCredentialActionLines({
		includeOllama: false,
		wrapCommands: true,
	});
	const inspect =
		lines[1] ?? `Inspect route:      ${formatCommand(MODEL_CREDENTIALS_INSPECT_ROUTE_COMMAND, true)}`;
	const providers =
		lines[2] ??
		`List providers:     ${formatCommand(MODEL_CREDENTIALS_LIST_PROVIDERS_COMMAND, true)}`;
	return [
		`Run ${formatCommand(MODEL_CREDENTIALS_SETUP_COMMAND, true)} when ready.`,
		inspect + ".",
		providers + ".",
	];
}