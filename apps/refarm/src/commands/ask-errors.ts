import { refarmCommand } from "@refarm.dev/cli/command-handoff";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	printJson,
} from "@refarm.dev/capabilities/envelope";
import { RUNTIME_AGENT_PLUGIN_ID } from "@refarm.dev/config";
import chalk from "chalk";
import type { AskJsonResult } from "./ask.js";
import {
	AGENT_FINISH_AFTER_EDIT_RUN_JSON_COMMAND,
	LOCAL_MODEL_JSON_COMMAND,
	MODEL_CURRENT_JSON_COMMAND,
	MODEL_DOCTOR_JSON_COMMAND,
	MODEL_PROVIDERS_JSON_COMMAND,
	OPENAI_DEFAULT_REF,
	OPENAI_MODEL_JSON_COMMAND,
	OPERATOR_LINKS_CONFIG_COMMAND,
	RESUME_JSON_COMMAND,
	SOW_INTERACTIVE_COMMAND,
	SOW_JSON_COMMAND,
} from "./credential-handoffs.js";
import {
	PLUGIN_INSTALL_COMMAND,
	PLUGIN_INSTALL_JSON_COMMAND,
	RUNTIME_AGENT_RELOAD_JSON_COMMAND,
} from "./plugin-handoffs.js";
import {
	RUNTIME_DOCTOR_COMMAND,
	RUNTIME_DOCTOR_NEXT_COMMAND,
	RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
	RUNTIME_START_COMMAND,
	RUNTIME_START_WAIT_COMMAND,
} from "./runtime-recovery.js";
import {
	buildRuntimeUnavailableRecommendation,
	isSidecarUnavailable,
	printSidecarUnavailable,
} from "./sidecar-error.js";

const OLLAMA_SERVE_COMMAND = "ollama serve";
const OLLAMA_DOCKER_BASE_URL_COMMAND = refarmCommand([
	"model",
	"base-url",
	"http://host.docker.internal:11434",
	"--json",
]);

export function usageLine(metadata: Record<string, unknown>): string {
	const model = metadata.model ?? "unknown";
	const tokensIn = metadata.tokens_in ?? 0;
	const tokensOut = metadata.tokens_out ?? 0;
	const pricing = pricingDisplay(metadata);
	return `model: ${model}  tokens: ${tokensIn} in / ${tokensOut} out  ${pricing}`;
}

export function pricingDisplay(metadata: Record<string, unknown>): string {
	if (
		metadata.pricing_mode === "subscription" ||
		metadata.provider === "openai-codex"
	) {
		return "subscription";
	}
	if (metadata.pricing_mode === "local" || metadata.provider === "ollama") {
		return "local";
	}
	return metadata.estimated_usd != null
		? `~$${Number(metadata.estimated_usd).toFixed(4)}`
		: "";
}

export function printAskError(message: string): void {
	const payload = buildAskErrorPayload(message);
	if (payload.error === "agent-not-loaded") {
		console.error(
			chalk.red("\n✗  Runtime agent is not loaded in the Refarm runtime."),
		);
		console.error(
			chalk.dim("   Install bundled plugins:  refarm plugin install"),
		);
		console.error(
			chalk.dim("   Reload runtime plugins:   /reload agent (or /r agent)"),
		);
		console.error(
			chalk.dim(`   Or restart runtime:       ${RUNTIME_START_COMMAND}`),
		);
		console.error(
			chalk.dim(`   Diagnose:                 ${RUNTIME_DOCTOR_COMMAND}`),
		);
	} else if (payload.error === "runtime-unavailable") {
		console.error();
		printSidecarUnavailable();
	} else if (payload.error === "model-provider-unavailable") {
		const provider = payload.provider ?? "the configured provider";
		console.error(chalk.red(`\n✗  Model provider unavailable: ${provider}`));
		if (provider === "ollama") {
			console.error(chalk.dim("   Start Ollama:  ollama serve"));
			console.error(chalk.dim("   Or switch provider:  refarm sow"));
		} else {
			console.error(chalk.dim("   Reconfigure/login:  refarm sow"));
			console.error(chalk.dim("   Inspect route:      refarm model current"));
			console.error(chalk.dim("   List providers:     refarm model providers"));
			console.error(
				chalk.dim(`   Switch model:       refarm model ${OPENAI_DEFAULT_REF}`),
			);
		}
	} else if (payload.error === "model-quota-exceeded") {
		console.error(chalk.red("\n✗  Model quota or billing limit reached."));
		console.error(chalk.dim("   Inspect route:       refarm model current"));
		console.error(chalk.dim("   Reconfigure/login:   refarm sow"));
		console.error(chalk.dim("   List providers:      refarm model providers"));
	} else {
		console.error(chalk.red(`\n✗  ${message}`));
	}
}

export function observedAskContentError(content: string): string | null {
	const trimmed = content.trim();
	if (trimmed.startsWith("[runtime-agent error]")) return trimmed;
	return null;
}

export function buildAskErrorPayload(message: string): {
	action: "ask";
	ok: false;
	error: string;
	message?: string;
	provider?: string;
	nextAction: string;
	nextActions: string[];
	nextCommand?: string | null;
	nextCommands?: string[];
} {
	const runtimeAgentShortId = RUNTIME_AGENT_PLUGIN_ID.split("/").at(-1) ?? "";
	const runtimeAgentShortIdText = runtimeAgentShortId.toLowerCase();
	const normalizedMessage = message.toLowerCase();
	const runtimeAgentMentioned =
		normalizedMessage.includes(RUNTIME_AGENT_PLUGIN_ID.toLowerCase()) ||
		(runtimeAgentShortIdText.length > 0 &&
			normalizedMessage.includes(runtimeAgentShortIdText));
	const isRuntimeAgentMissing =
		normalizedMessage.includes(
			`${RUNTIME_AGENT_PLUGIN_ID.toLowerCase()} not loaded`,
		) ||
		normalizedMessage.includes(
			`plugin "${RUNTIME_AGENT_PLUGIN_ID.toLowerCase()}" is not loaded`,
		) ||
		(normalizedMessage.includes("agent not loaded") &&
			runtimeAgentMentioned) ||
		(runtimeAgentShortIdText.length > 0 &&
			normalizedMessage.includes(`${runtimeAgentShortIdText} not loaded`));

	const isProviderError =
		message.includes("model-bridge request failed") ||
		message.includes("Couldn't connect to server") ||
		message.includes("curl: (7)") ||
		message.includes("Connection Failed") ||
		message.includes("Connection refused") ||
		message.includes("ECONNREFUSED") ||
		message.includes("/v1/chat/completions");
	const isQuotaError =
		normalizedMessage.includes("current quota") ||
		normalizedMessage.includes("quota exceeded") ||
		(normalizedMessage.includes("quota") &&
			normalizedMessage.includes("billing"));

	if (isRuntimeAgentMissing) {
		return buildJsonErrorEnvelope({
			command: "ask",
			operation: "submit",
			error: "agent-not-loaded",
			message: "Runtime agent is not loaded in the Refarm runtime.",
			nextAction: PLUGIN_INSTALL_COMMAND,
			nextActions: [
				PLUGIN_INSTALL_COMMAND,
				RUNTIME_AGENT_RELOAD_JSON_COMMAND,
				RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
				RUNTIME_START_COMMAND,
				RUNTIME_DOCTOR_COMMAND,
			],
			nextCommand: PLUGIN_INSTALL_JSON_COMMAND,
			nextCommands: [
				PLUGIN_INSTALL_JSON_COMMAND,
				RUNTIME_AGENT_RELOAD_JSON_COMMAND,
				RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
				RUNTIME_START_WAIT_COMMAND,
				RUNTIME_DOCTOR_NEXT_COMMAND,
			],
			extra: {
				action: "ask",
				recommendations: [
					{
						diagnostic: "agent-not-loaded",
						severity: "failure",
						summary: "The runtime agent plugin is not loaded in the runtime.",
						action:
							"Install or reload the bundled runtime agent plugin, then ensure the runtime is ready.",
						command: RUNTIME_AGENT_RELOAD_JSON_COMMAND,
					},
				],
			},
		});
	}
	if (isSidecarUnavailable(message)) {
		return buildJsonErrorEnvelope({
			command: "ask",
			operation: "submit",
			error: "runtime-unavailable",
			message,
			nextAction: RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
			nextActions: [
				RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
				RUNTIME_START_COMMAND,
				RUNTIME_DOCTOR_COMMAND,
			],
			nextCommand: RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
			nextCommands: [
				RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
				RUNTIME_START_WAIT_COMMAND,
				RUNTIME_DOCTOR_NEXT_COMMAND,
			],
			extra: {
				action: "ask",
				recommendations: [
					buildRuntimeUnavailableRecommendation({
						summary:
							"The runtime sidecar is not reachable while submitting an ask.",
						action:
							"Ensure the selected runtime is running before submitting again.",
					}),
				],
			},
		});
	}
	if (isProviderError) {
		const providerMatch = message.match(/for provider "([^"]+)"/);
		const provider =
			providerMatch?.[1] ??
			(message.includes("11434") || message.toLowerCase().includes("ollama")
				? "ollama"
				: "the configured provider");
		const providerNextCommands =
			provider === "ollama"
				? [
						MODEL_DOCTOR_JSON_COMMAND,
						OLLAMA_SERVE_COMMAND,
						OLLAMA_DOCKER_BASE_URL_COMMAND,
						MODEL_CURRENT_JSON_COMMAND,
						MODEL_PROVIDERS_JSON_COMMAND,
					]
				: [
						MODEL_CURRENT_JSON_COMMAND,
						MODEL_PROVIDERS_JSON_COMMAND,
						OPENAI_MODEL_JSON_COMMAND,
					];
		return buildJsonErrorEnvelope({
			command: "ask",
			operation: "submit",
			error: "model-provider-unavailable",
			message: `Model provider unavailable: ${provider}`,
			nextAction: providerNextCommands[0]!,
			nextActions:
				provider === "ollama"
					? [
							MODEL_DOCTOR_JSON_COMMAND,
							OLLAMA_SERVE_COMMAND,
							OLLAMA_DOCKER_BASE_URL_COMMAND,
							SOW_JSON_COMMAND,
						]
					: [
							MODEL_CURRENT_JSON_COMMAND,
							MODEL_PROVIDERS_JSON_COMMAND,
							OPENAI_MODEL_JSON_COMMAND,
							SOW_JSON_COMMAND,
						],
			nextCommand: providerNextCommands[0],
			nextCommands: providerNextCommands,
			extra: { action: "ask", provider },
		});
	}
	if (isQuotaError) {
		return buildJsonErrorEnvelope({
			command: "ask",
			operation: "submit",
			error: "model-quota-exceeded",
			message,
			nextAction: MODEL_CURRENT_JSON_COMMAND,
			nextActions: [
				MODEL_CURRENT_JSON_COMMAND,
				SOW_JSON_COMMAND,
				MODEL_PROVIDERS_JSON_COMMAND,
				OPENAI_MODEL_JSON_COMMAND,
			],
			nextCommand: MODEL_CURRENT_JSON_COMMAND,
			nextCommands: [
				MODEL_CURRENT_JSON_COMMAND,
				SOW_JSON_COMMAND,
				MODEL_PROVIDERS_JSON_COMMAND,
				OPENAI_MODEL_JSON_COMMAND,
			],
			extra: { action: "ask" },
		});
	}
	return buildJsonErrorEnvelope({
		command: "ask",
		operation: "submit",
		error: "ask-failed",
		message,
		nextAction: RUNTIME_DOCTOR_COMMAND,
		nextActions: [RUNTIME_DOCTOR_COMMAND, MODEL_CURRENT_JSON_COMMAND],
		nextCommand: RUNTIME_DOCTOR_NEXT_COMMAND,
		nextCommands: [RUNTIME_DOCTOR_NEXT_COMMAND, MODEL_CURRENT_JSON_COMMAND],
		extra: { action: "ask" },
	});
}

export function printAskErrorJson(message: string): void {
	printJson(buildAskErrorPayload(message));
}

export function printAskSuccessJson(result: AskJsonResult): void {
	const sessionShowTemplate = refarmCommand([
		"sessions",
		"show",
		result.sessionId,
		"--json",
	]);
	printJson(
		buildJsonSuccessEnvelope({
			command: "ask",
			operation: "submit",
			nextAction: RESUME_JSON_COMMAND,
			nextActions: [
				RESUME_JSON_COMMAND,
				AGENT_FINISH_AFTER_EDIT_RUN_JSON_COMMAND,
			],
			nextCommand: RESUME_JSON_COMMAND,
			nextCommands: [
				RESUME_JSON_COMMAND,
				sessionShowTemplate,
				AGENT_FINISH_AFTER_EDIT_RUN_JSON_COMMAND,
			],
			extra: result,
		}),
	);
}

export function printMissingModelCredentials(json: boolean): void {
	if (json) {
		printJson(
			buildJsonErrorEnvelope({
				command: "ask",
				operation: "credentials",
				error: "model-credentials-missing",
				message: "No usable model credentials configured.",
				nextAction: SOW_INTERACTIVE_COMMAND,
				nextActions: [
					SOW_INTERACTIVE_COMMAND,
					SOW_JSON_COMMAND,
					MODEL_CURRENT_JSON_COMMAND,
					MODEL_PROVIDERS_JSON_COMMAND,
					LOCAL_MODEL_JSON_COMMAND,
					OLLAMA_SERVE_COMMAND,
				],
				nextCommand: SOW_INTERACTIVE_COMMAND,
				nextCommands: [
					SOW_INTERACTIVE_COMMAND,
					SOW_JSON_COMMAND,
					MODEL_PROVIDERS_JSON_COMMAND,
					MODEL_CURRENT_JSON_COMMAND,
					LOCAL_MODEL_JSON_COMMAND,
					OLLAMA_SERVE_COMMAND,
				],
				extra: {
					action: "ask",
					handoffs: {
						interactive: SOW_INTERACTIVE_COMMAND,
						inspectCurrent: MODEL_CURRENT_JSON_COMMAND,
						inspectProviders: MODEL_PROVIDERS_JSON_COMMAND,
						localNoKeyModel: LOCAL_MODEL_JSON_COMMAND,
						openExternalLinks: OPERATOR_LINKS_CONFIG_COMMAND,
					},
				},
			}),
		);
		return;
	}
	console.error(chalk.red("\n✗  No usable model credentials configured."));
	console.error(chalk.dim("   Set up credentials: refarm sow"));
	console.error(chalk.dim("   Inspect route:      refarm model current"));
	console.error(chalk.dim("   List providers:     refarm model providers"));
	console.error(
		chalk.dim("   Or use Ollama:      ollama serve  (then refarm sow)"),
	);
}
