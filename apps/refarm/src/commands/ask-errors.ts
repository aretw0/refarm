import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	printJson,
} from "@refarm.dev/capabilities/envelope";
import { RUNTIME_AGENT_PLUGIN_ID } from "@refarm.dev/config";
import chalk from "chalk";
import { refarmCommand } from "../brand.js";
import type { AskJsonResult } from "./ask.js";
import {
	AGENT_FINISH_AFTER_EDIT_RUN_JSON_COMMAND,
	CREDENTIAL_QUOTA_JSON_COMMAND,
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
	MODEL_CREDENTIALS_MISSING_MESSAGE,
	missingModelCredentialActionLines,
} from "./model-credential-guidance.js";
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
	if (metadata.pricing_mode === "subscription" || metadata.provider === "openai-codex") {
		return "subscription";
	}
	if (metadata.pricing_mode === "local" || metadata.provider === "ollama") {
		return "local";
	}
	return metadata.estimated_usd != null ? `~$${Number(metadata.estimated_usd).toFixed(4)}` : "";
}

/** One seat a dispatch actually tried, named the way an operator declared it. */
export interface RefusedSeat {
	readonly credentialId: string;
	readonly alias: string;
}

export interface QuotaRefusalContext {
	readonly provider: string | undefined;
	/** The seats this dispatch really attempted, in the order it attempted them. */
	readonly tried: readonly RefusedSeat[];
	/** True when the workspace declared an order and the walk ran off the end of it. */
	readonly declaredExhausted: boolean;
}

/**
 * PURE. What a quota refusal can say from what the node ALREADY HOLDS.
 *
 * ISS-157, question 1. Measured on the operator's node 2026-08-20: the corporate seat was
 * 0/10000 on `premium_interactions` and UNLIMITED on `chat` and `completions`, the personal seat
 * had 1500 idle, and the refusal said "Model quota or billing limit reached" followed by three
 * commands about the ROUTE — none of which is the situation, and a headline that is false as a
 * statement about the account.
 *
 * BOUNDED BY WHAT COSTS NOTHING. Which meter, its numbers and its reset date would need a second
 * request to the provider that just refused — on a failure path, where it could itself fail and
 * turn one clear answer into a slow ambiguous one. `credential quota` already reads all of it per
 * account, so this NAMES that command instead of racing it. The seats and the walk's outcome are
 * free: the dispatch just lived them.
 *
 * IT NEVER OFFERS `credential bind`. The personal/corporate frontier is the operator's, and
 * ISS-157 says it in his terms: "a node that silently spends a personal seat for corporate work
 * has crossed it without being asked. The gap is INFORMATION, not policy." Whether the refusal
 * should hand back a one-keystroke crossing is question 1, and it is his to answer.
 */
export function quotaRefusalDetail(context: QuotaRefusalContext): string[] {
	const lines: string[] = [];
	if (context.tried.length > 0) {
		const aliases = context.tried.map((seat) => seat.alias).join(", ");
		const provider = context.provider ? `${context.provider} ` : "";
		lines.push(`   Seat refused:  ${provider}${aliases}`);
	}
	// ONLY WHEN A DECLARATION RAN OUT. A declared list is exclusive, so exhausting it is a
	// different fact from having none — and saying "declared" where nothing was declared would
	// describe a choice the operator never made.
	if (context.declaredExhausted) {
		lines.push("   Every seat you declared for this workspace has been tried.");
	}
	lines.push("   Which meter, and what is left:  refarm credential quota");
	return lines;
}

const EMPTY_QUOTA_CONTEXT: QuotaRefusalContext = {
	provider: undefined,
	tried: [],
	declaredExhausted: false,
};

/**
 * @param quotaContext OPTIONAL, so every caller that has no seat information is unchanged. A
 * caller that lived the walk hands in what it tried; one that did not gets the command and no
 * invented seat.
 */
export function printAskError(message: string, quotaContext?: QuotaRefusalContext): void {
	const payload = buildAskErrorPayload(message);
	if (payload.error === "agent-not-loaded") {
		console.error(chalk.red("\n✗  Runtime agent is not loaded in the Refarm runtime."));
		console.error(chalk.dim("   Install bundled plugins:  refarm plugin install"));
		console.error(chalk.dim("   Reload runtime plugins:   /reload agent (or /r agent)"));
		console.error(chalk.dim(`   Or restart runtime:       ${RUNTIME_START_COMMAND}`));
		console.error(chalk.dim(`   Diagnose:                 ${RUNTIME_DOCTOR_COMMAND}`));
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
			console.error(chalk.dim(`   Switch model:       refarm model ${OPENAI_DEFAULT_REF}`));
		}
	} else if (payload.error === "model-quota-exceeded") {
		// THE HEADLINE NAMES A METER IT DOES NOT KNOW, and the old one named the ACCOUNT — which
		// was measurably false: the seat that refused had `chat` and `completions` unlimited while
		// one meter was empty. "A limit" is what the provider actually said.
		console.error(chalk.red("\n✗  The provider refused this dispatch: a quota limit is reached."));
		for (const line of quotaRefusalDetail(quotaContext ?? EMPTY_QUOTA_CONTEXT)) {
			console.error(chalk.dim(line));
		}
	} else {
		console.error(chalk.red(`\n✗  ${message}`));
	}
}

export function observedAskContentError(content: string): string | null {
	const trimmed = content.trim();
	if (trimmed.startsWith("[runtime-agent error]")) return trimmed;
	return null;
}

/**
 * @param quotaContext OPTIONAL, mirroring `printAskError`. A caller that lived the walk hands in
 * what it tried; one that did not gets the commands and no invented seat. The human rendering has
 * taken this since 2026-08-24 and the JSON one did not, so the two surfaces DESCRIBED THE SAME
 * REFUSAL DIFFERENTLY — measured live 2026-08-25, see the quota branch below.
 */
export function buildAskErrorPayload(
	message: string,
	quotaContext?: QuotaRefusalContext,
): {
	action: "ask";
	ok: false;
	error: string;
	message?: string;
	provider?: string;
	seats?: readonly RefusedSeat[];
	declaredExhausted?: boolean;
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
		(runtimeAgentShortIdText.length > 0 && normalizedMessage.includes(runtimeAgentShortIdText));
	const isRuntimeAgentMissing =
		normalizedMessage.includes(`${RUNTIME_AGENT_PLUGIN_ID.toLowerCase()} not loaded`) ||
		normalizedMessage.includes(`plugin "${RUNTIME_AGENT_PLUGIN_ID.toLowerCase()}" is not loaded`) ||
		(normalizedMessage.includes("agent not loaded") && runtimeAgentMentioned) ||
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
		(normalizedMessage.includes("quota") && normalizedMessage.includes("billing"));

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
						summary: "The runtime sidecar is not reachable while submitting an ask.",
						action: "Ensure the selected runtime is running before submitting again.",
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
				: [MODEL_CURRENT_JSON_COMMAND, MODEL_PROVIDERS_JSON_COMMAND, OPENAI_MODEL_JSON_COMMAND];
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
		// THE SAME REFUSAL, SAID THE SAME WAY. Measured on the operator's node 2026-08-25, with the
		// corporate seat at 0/10000 on `premium_interactions` and the personal one at 1500/1500:
		//
		//   refarm ask --workspace refarm        "Seat refused: github-copilot corporativo"
		//   refarm ask --workspace refarm --json  no seat, no workspace, no `credential quota`
		//
		// A HANDOFF THAT SPENDS. The four commands this branch used to return were all about the
		// ROUTE, and the last of them wrote it: `refarm model openai/<ref>` resolves through
		// `resolveModelGrammar`'s bare-ref sugar, so an agent following `nextCommand` — which
		// AGENTS.md section 4 instructs it to do — moved the NODE'S route (not the workspace's)
		// from a subscription provider to `openai`, which docs/model-provider-strata.md:17 records
		// as public pay-as-you-go API pricing, and for which this node holds no credential at all.
		// A subscription meter emptying is not a reason to start paying per token, and it is not a
		// reason to rewrite a route the workspace's binding decided (ISS-131's operator ruling:
		// "the node must never silently spend an account the scope did not name").
		//
		// What is left is what the human rendering settled on: the surface that HAS the numbers,
		// and a read-only look at the route that ran. Both are inspections; neither writes.
		const quotaCommands = [CREDENTIAL_QUOTA_JSON_COMMAND, MODEL_CURRENT_JSON_COMMAND];
		return buildJsonErrorEnvelope({
			command: "ask",
			operation: "submit",
			error: "model-quota-exceeded",
			message,
			nextAction: quotaCommands[0]!,
			nextActions: quotaCommands,
			nextCommand: quotaCommands[0],
			nextCommands: quotaCommands,
			extra: {
				action: "ask",
				// SAYS NOTHING IT DID NOT MEASURE. Absent entirely when no context was handed in,
				// rather than present and empty — an empty list reads as "nothing was tried".
				...(quotaContext
					? {
							...(quotaContext.provider ? { provider: quotaContext.provider } : {}),
							seats: quotaContext.tried,
							declaredExhausted: quotaContext.declaredExhausted,
						}
					: {}),
			},
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

export function printAskErrorJson(message: string, quotaContext?: QuotaRefusalContext): void {
	printJson(buildAskErrorPayload(message, quotaContext));
}

export function printAskSuccessJson(result: AskJsonResult): void {
	const sessionShowTemplate = refarmCommand(["sessions", "show", result.sessionId, "--json"]);
	printJson(
		buildJsonSuccessEnvelope({
			command: "ask",
			operation: "submit",
			nextAction: RESUME_JSON_COMMAND,
			nextActions: [RESUME_JSON_COMMAND, AGENT_FINISH_AFTER_EDIT_RUN_JSON_COMMAND],
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
				message: MODEL_CREDENTIALS_MISSING_MESSAGE,
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
	console.error(chalk.red(`\n✗  ${MODEL_CREDENTIALS_MISSING_MESSAGE}`));
	for (const line of missingModelCredentialActionLines({ includeOllama: true })) {
		console.error(chalk.dim(`   ${line}`));
	}
}
