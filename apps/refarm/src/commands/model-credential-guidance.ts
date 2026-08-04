import { refarmCommand } from "../brand.js";

export const MODEL_CREDENTIALS_MISSING_MESSAGE = "No usable model credentials configured.";
export const MODEL_CREDENTIALS_SETUP_COMMAND = refarmCommand(["sow"]);
export const MODEL_CREDENTIALS_INSPECT_ROUTE_COMMAND = refarmCommand(["model", "current"]);
export const MODEL_CREDENTIALS_LIST_PROVIDERS_COMMAND = refarmCommand(["model", "providers"]);
export const MODEL_CREDENTIALS_OLLAMA_SERVE_COMMAND = "ollama serve";

function formatCommand(command: string, wrapCommands: boolean): string {
	return wrapCommands ? `\`${command}\`` : command;
}

export function missingModelCredentialActionLines(options?: {
	includeOllama?: boolean;
	wrapCommands?: boolean;
}): string[] {
	const includeOllama = options?.includeOllama ?? true;
	const wrapCommands = options?.wrapCommands ?? false;
	const setup = formatCommand(MODEL_CREDENTIALS_SETUP_COMMAND, wrapCommands);
	const inspect = formatCommand(MODEL_CREDENTIALS_INSPECT_ROUTE_COMMAND, wrapCommands);
	const providers = formatCommand(MODEL_CREDENTIALS_LIST_PROVIDERS_COMMAND, wrapCommands);
	const ollamaServe = formatCommand(MODEL_CREDENTIALS_OLLAMA_SERVE_COMMAND, wrapCommands);
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
	const [setup, inspect, providers] = missingModelCredentialActionLines({
		includeOllama: false,
		wrapCommands: true,
	});
	return [
		setup.replace(/^Set up credentials:/, "Run") + " when ready.",
		inspect + ".",
		providers + ".",
	];
}