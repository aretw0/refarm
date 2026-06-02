import { isPiAgentPluginId, PI_AGENT_PLUGIN_ID } from "@refarm.dev/config";
import {
	buildSystemPrompt,
	ContextRegistry,
	CwdContextProvider,
	DateContextProvider,
	FilesContextProvider,
	GitStatusContextProvider,
	OperatorStateProvider,
	PolicyFilesContextProvider,
	SessionDigestContextProvider,
	type ContextProvider,
} from "@refarm.dev/context-provider-v1";
import type { Effort } from "@refarm.dev/effort-contract-v1";
import type { StreamChunk } from "@refarm.dev/stream-contract-v1";
import chalk from "chalk";
import { Command } from "commander";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RUNTIME_AUTOSTART_ENV_VAR } from "../utils/runtime-config.js";
import { quoteCommandArg, refarmCommand } from "./command-handoff.js";
import {
	AGENT_FINISH_AFTER_EDIT_RUN_JSON_COMMAND,
	LOCAL_MODEL_JSON_COMMAND,
	MODEL_CURRENT_JSON_COMMAND,
	MODEL_PROVIDERS_JSON_COMMAND,
	OPENAI_DEFAULT_REF,
	OPENAI_MODEL_JSON_COMMAND,
	OPERATOR_LINKS_CONFIG_COMMAND,
	RESUME_JSON_COMMAND,
	SOW_INTERACTIVE_COMMAND,
	SOW_JSON_COMMAND,
} from "./credential-handoffs.js";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	printJson,
} from "./json-output.js";
import { createPiAgentRespondEffort } from "./pi-agent-effort.js";
import {
	PLUGIN_INSTALL_COMMAND as PI_AGENT_INSTALL_COMMAND,
	PLUGIN_INSTALL_JSON_COMMAND as PI_AGENT_INSTALL_JSON_COMMAND,
	PI_AGENT_RELOAD_JSON_COMMAND,
} from "./plugin-handoffs.js";
import {
	readRuntimePluginState,
	reloadRuntimePlugins,
	type RuntimePluginReloadResult,
	type RuntimePluginState,
} from "./runtime-plugins.js";
import {
	RUNTIME_AUTOSTART_ALWAYS_COMMAND,
	RUNTIME_AUTOSTART_NEVER_COMMAND,
	RUNTIME_DOCTOR_COMMAND,
	RUNTIME_DOCTOR_NEXT_COMMAND,
	RUNTIME_ENGINE_AUTO_COMMAND,
	RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
	RUNTIME_START_COMMAND,
	RUNTIME_START_WAIT_COMMAND,
} from "./runtime-recovery.js";
import { isFullSessionId, resolveSessionIdPrefix } from "./session-ids.js";
import {
	autoStartRuntime,
	checkSessionReadiness,
	defaultLaunchDeps,
	findRepoRoot,
	isRuntimeRunning,
	type LaunchDeps,
} from "./session-launch.js";
import {
	clearActiveSessionId,
	readActiveSessionId,
	writeActiveSessionIdAndVerify,
} from "./session-lock.js";
import {
	buildRuntimeUnavailableRecommendation,
	isSidecarUnavailable,
	printSidecarUnavailable,
} from "./sidecar-error.js";
import { sidecarUrl } from "./sidecar-url.js";

const SESSIONS_LIST_JSON_COMMAND = refarmCommand(["sessions", "list", "--json"]);
const OLLAMA_SERVE_COMMAND = "ollama serve";
const REFARM_STREAMS_DIR_ENV_VAR = "REFARM_STREAMS_DIR";
const REFARM_TASK_RESULTS_DIR_ENV_VAR = "REFARM_TASK_RESULTS_DIR";

export interface AskDeps {
	submitEffort(effort: Effort): Promise<string>;
	followStream(
		effortId: string,
		onChunk: (chunk: StreamChunk) => void,
		options?: { timeoutMs?: number; submittedAtMs?: number },
	): Promise<void>;
	readEffortResult?(effortId: string): Promise<{
		status: "ok" | "error";
		content?: string;
		metadata?: Record<string, unknown>;
		error?: string;
	} | null>;
	readSessionFallback?(sessionId: string): Promise<{
		status: "ok";
		content: string;
		metadata?: Record<string, unknown>;
	} | null>;
	resolveSessionIdPrefix?(prefix: string): Promise<string>;
	readActiveSessionId?(): string | null;
	clearActiveSessionId?(): boolean;
	persistActiveSessionId?(id: string): void;
	readPluginState?(): Promise<RuntimePluginState | null>;
	reloadPlugins?(pluginIds: string[]): Promise<RuntimePluginReloadResult | null>;
	collectSystemPrompt?(request: {
		cwd: string;
		query: string;
		files: string[];
	}): Promise<string>;
}

interface SessionNode {
	"@id": string;
}

interface AskJsonResult {
	effortId: string;
	sessionId: string;
	content: string;
	metadata?: Record<string, unknown>;
}

async function submitViaHttp(effort: Effort): Promise<string> {
	const response = await fetch(sidecarUrl("/efforts"), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(effort),
	});
	if (!response.ok) {
		throw new Error(`Runtime HTTP ${response.status}`);
	}
	const payload = (await response.json()) as { effortId: string };
	return payload.effortId;
}

async function readLatestAgentEntryFromSession(sessionId: string): Promise<{
	status: "ok";
	content: string;
	metadata?: Record<string, unknown>;
} | null> {
	try {
		const response = await fetch(
			sidecarUrl(`/sessions/${encodeURIComponent(sessionId)}/history`),
		);
		if (!response.ok) return null;
		const payload = (await response.json()) as {
			entries?: Array<{
				kind?: unknown;
				content?: unknown;
				timestamp_ns?: unknown;
			}>;
		};
		const agentEntry = [...(payload.entries ?? [])]
			.reverse()
			.find(
				(entry) =>
					entry.kind === "agent" && typeof entry.content === "string",
			);
		if (!agentEntry || typeof agentEntry.content !== "string") return null;
		return {
			status: "ok",
			content: agentEntry.content,
			metadata: { source: "session-history" },
		};
	} catch {
		return null;
	}
}

function followStreamFile(
	streamsDir: string,
	effortId: string,
	onChunk: (chunk: StreamChunk) => void,
	readFallback?: () => Promise<{
		status: "ok" | "error";
		content?: string;
		metadata?: Record<string, unknown>;
		error?: string;
	} | null>,
	options?: { timeoutMs?: number; submittedAtMs?: number },
): Promise<void> {
	return new Promise((resolve, reject) => {
		const submittedAtMs = options?.submittedAtMs ?? Date.now();
		const timeoutMs = options?.timeoutMs ?? 45_000;
		const deadline = Date.now() + timeoutMs;

		const resolveStreamFilePath = (): string | null => {
			const exactPath = path.join(streamsDir, `${effortId}.ndjson`);
			if (fs.existsSync(exactPath)) return exactPath;
			if (!fs.existsSync(streamsDir)) return null;

			const candidates = fs
				.readdirSync(streamsDir)
				.filter((filename) => filename.endsWith(".ndjson"))
				.map((filename) => {
					const filePath = path.join(streamsDir, filename);
					const mtimeMs = fs.statSync(filePath).mtimeMs;
					return { filePath, mtimeMs };
				})
				.filter((entry) => entry.mtimeMs >= submittedAtMs - 2_000)
				.sort((left, right) => right.mtimeMs - left.mtimeMs);

			return candidates[0]?.filePath ?? null;
		};

		let filePath: string | null = null;
		let offset = 0;
		let finished = false;
		let polling = false;

		function stopAndReject(message: string): void {
			if (finished) return;
			finished = true;
			clearInterval(timer);
			reject(new Error(message));
		}

		async function readNew(): Promise<void> {
			if (polling) return;
			polling = true;

			try {
				if (finished) return;
				if (!filePath) {
					filePath = resolveStreamFilePath();
				}
				if (filePath && fs.existsSync(filePath)) {
					const content = fs.readFileSync(filePath, "utf-8");
					const lines = content.split("\n").filter(Boolean);
					for (let index = offset; index < lines.length; index++) {
						let chunk: StreamChunk;
						try {
							chunk = JSON.parse(lines[index]!) as StreamChunk;
						} catch {
							continue;
						}
						onChunk(chunk);
						if (chunk.is_final) {
							finished = true;
							clearInterval(timer);
							resolve();
							return;
						}
					}
					offset = lines.length;
				}

				if (readFallback) {
					try {
						const fallback = await readFallback();
						if (
							fallback?.status === "ok" &&
							typeof fallback.content === "string"
						) {
							onChunk({
								stream_ref: effortId,
								sequence: Number.MAX_SAFE_INTEGER,
								content: fallback.content,
								is_final: true,
								metadata: fallback.metadata,
							});
							finished = true;
							clearInterval(timer);
							resolve();
							return;
						}

						if (fallback?.status === "error") {
							stopAndReject(
								fallback.error ?? `Effort ${effortId} failed without details`,
							);
							return;
						}
					} catch {
						// ignore fallback read errors and keep stream polling path
					}
				}

				if (Date.now() >= deadline) {
					stopAndReject(
						filePath
							? `Timed out waiting final stream chunk for effort ${effortId}`
							: `Timed out waiting for stream file for effort ${effortId}`,
					);
				}
			} finally {
				polling = false;
			}
		}

		const timer = setInterval(() => {
			void readNew();
		}, 100);
		void readNew();
	});
}

function extractAskResultFromEffortResult(result: unknown): {
	status: "ok" | "error";
	content?: string;
	metadata?: Record<string, unknown>;
	error?: string;
} | null {
	if (!result || typeof result !== "object") return null;
	const effort = result as {
		status?: string;
		results?: Array<{
			status?: string;
			result?: unknown;
			error?: unknown;
		}>;
	};

	if (effort.status !== "done" && effort.status !== "failed") return null;

	const task = Array.isArray(effort.results) ? effort.results[0] : undefined;
	if (!task || typeof task !== "object") return null;

	if (task.status === "error") {
		return {
			status: "error",
			error:
				typeof task.error === "string"
					? task.error
					: "Effort finished with task error",
		};
	}

	let payload: unknown = task.result;
	if (typeof payload === "string") {
		try {
			payload = JSON.parse(payload);
		} catch {
			const rawContent = payload;
			return typeof rawContent === "string"
				? { status: "ok", content: rawContent }
				: null;
		}
	}

	if (typeof payload === "string") {
		return { status: "ok", content: payload };
	}

	if (!payload || typeof payload !== "object") {
		return null;
	}

	const value = payload as {
		content?: unknown;
		model?: unknown;
		provider?: unknown;
		usage?: unknown;
	};
	const content = value.content;
	if (typeof content !== "string") return null;

	const metadata: Record<string, unknown> = {};
	if (typeof value.model === "string") metadata.model = value.model;
	if (typeof value.provider === "string") metadata.provider = value.provider;
	if (value.usage && typeof value.usage === "object") {
		const usage = value.usage as {
			tokens_in?: unknown;
			tokens_out?: unknown;
			estimated_usd?: unknown;
		};
		if (typeof usage.tokens_in === "number")
			metadata.tokens_in = usage.tokens_in;
		if (typeof usage.tokens_out === "number")
			metadata.tokens_out = usage.tokens_out;
		if (typeof usage.estimated_usd === "number")
			metadata.estimated_usd = usage.estimated_usd;
	}

	return {
		status: "ok",
		content,
		metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
	};
}

async function readEffortResultFile(
	resultsDir: string,
	effortId: string,
): Promise<{
	status: "ok" | "error";
	content?: string;
	metadata?: Record<string, unknown>;
	error?: string;
} | null> {
	const resultPath = path.join(resultsDir, `${effortId}.json`);
	if (!fs.existsSync(resultPath)) return null;

	try {
		const raw = fs.readFileSync(resultPath, "utf-8");
		const parsed = JSON.parse(raw);
		return extractAskResultFromEffortResult(parsed);
	} catch {
		return null;
	}
}

const DEFAULT_HISTORY_TURNS = 10;

function stringEnv(value: string | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

export function resolveRuntimeStreamsDir(env: NodeJS.ProcessEnv = process.env): string {
	return (
		stringEnv(env[REFARM_STREAMS_DIR_ENV_VAR]) ??
		path.join(os.homedir(), ".refarm", "streams")
	);
}

export function resolveRuntimeTaskResultsDir(
	env: NodeJS.ProcessEnv = process.env,
): string {
	return (
		stringEnv(env[REFARM_TASK_RESULTS_DIR_ENV_VAR]) ??
		path.join(os.homedir(), ".refarm", "task-results")
	);
}

function newSessionId(): string {
	return `urn:refarm:session:v1:${crypto.randomUUID().replace(/-/g, "")}`;
}

async function collectDefaultSystemPrompt(request: {
	cwd: string;
	query: string;
	files: string[];
}): Promise<string> {
	const providers: ContextProvider[] = [
		new SessionDigestContextProvider(),
		new CwdContextProvider(),
		new PolicyFilesContextProvider(),
		new OperatorStateProvider(),
		new DateContextProvider(),
		new GitStatusContextProvider(),
		...(request.files.length > 0
			? [new FilesContextProvider(request.files)]
			: []),
	];

	const registry = new ContextRegistry(providers);
	const entries = await registry.collect({
		cwd: request.cwd,
		query: request.query,
	});
	return buildSystemPrompt(entries);
}

async function resolveSessionIdPrefixFromSidecar(
	prefix: string,
): Promise<string> {
	if (isFullSessionId(prefix)) return prefix;

	const response = await fetch(sidecarUrl("/sessions"));
	if (!response.ok) {
		throw new Error(`sidecar HTTP ${response.status}`);
	}
	const body = (await response.json()) as { sessions?: SessionNode[] };
	return resolveSessionIdPrefix(prefix, body.sessions ?? []);
}

function defaultDeps(): AskDeps {
	const streamsDir = resolveRuntimeStreamsDir();
	const resultsDir = resolveRuntimeTaskResultsDir();
	return {
		submitEffort: submitViaHttp,
		resolveSessionIdPrefix: resolveSessionIdPrefixFromSidecar,
		followStream: (effortId, onChunk, options) =>
			followStreamFile(
				streamsDir,
				effortId,
				onChunk,
				() => readEffortResultFile(resultsDir, effortId),
				options,
			),
		readEffortResult: (effortId) => readEffortResultFile(resultsDir, effortId),
		readSessionFallback: readLatestAgentEntryFromSession,
		readActiveSessionId,
		clearActiveSessionId,
		persistActiveSessionId: writeActiveSessionIdAndVerify,
		readPluginState: readRuntimePluginState,
		reloadPlugins: reloadRuntimePlugins,
	};
}

function usageLine(metadata: Record<string, unknown>): string {
	const model = metadata.model ?? "unknown";
	const tokensIn = metadata.tokens_in ?? 0;
	const tokensOut = metadata.tokens_out ?? 0;
	const usd =
		metadata.estimated_usd != null
			? `~$${Number(metadata.estimated_usd).toFixed(4)}`
			: "";
	return `model: ${model}  tokens: ${tokensIn} in / ${tokensOut} out  ${usd}`;
}

function printAskError(message: string): void {
	const payload = buildAskErrorPayload(message);
	if (payload.error === "pi-agent-not-loaded") {
		console.error(chalk.red("\n✗  pi-agent is not loaded in the Refarm runtime."));
		console.error(chalk.dim("   Install bundled plugins:  refarm plugin install"));
		console.error(chalk.dim("   Reload runtime plugins:   /reload @refarm/pi-agent"));
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
	} else {
		console.error(chalk.red(`\n✗  ${message}`));
	}
}

function buildAskErrorPayload(message: string): {
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
	const isPiAgentMissing =
		message.includes(`${PI_AGENT_PLUGIN_ID} not loaded`) ||
		message.includes("pi-agent not loaded") ||
		message.includes(`Plugin "${PI_AGENT_PLUGIN_ID}" is not loaded`);

	const isProviderError =
		message.includes("model-bridge request failed") ||
		message.includes("Couldn't connect to server") ||
		message.includes("curl: (7)");

	if (isPiAgentMissing) {
		return buildJsonErrorEnvelope({
			command: "ask",
			operation: "submit",
			error: "pi-agent-not-loaded",
			message: "pi-agent is not loaded in the Refarm runtime.",
			nextAction: PI_AGENT_INSTALL_COMMAND,
			nextActions: [
				PI_AGENT_INSTALL_COMMAND,
				PI_AGENT_RELOAD_JSON_COMMAND,
				RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
				RUNTIME_START_COMMAND,
				RUNTIME_DOCTOR_COMMAND,
			],
			nextCommand: PI_AGENT_INSTALL_JSON_COMMAND,
			nextCommands: [
				PI_AGENT_INSTALL_JSON_COMMAND,
				PI_AGENT_RELOAD_JSON_COMMAND,
				RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
				RUNTIME_START_WAIT_COMMAND,
				RUNTIME_DOCTOR_NEXT_COMMAND,
			],
			extra: {
				action: "ask",
				recommendations: [
					{
						diagnostic: "pi-agent-not-loaded",
						severity: "failure",
						summary: "The pi-agent plugin is not loaded in the runtime.",
						action: "Install or reload pi-agent, then ensure the runtime is ready.",
						command: PI_AGENT_RELOAD_JSON_COMMAND,
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
		const provider = providerMatch?.[1] ?? "the configured provider";
		const providerNextCommands =
			provider === "ollama"
				? [
						OLLAMA_SERVE_COMMAND,
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
					? [OLLAMA_SERVE_COMMAND, SOW_JSON_COMMAND]
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

function printAskErrorJson(message: string): void {
	printJson(buildAskErrorPayload(message));
}

function printAskSuccessJson(result: AskJsonResult): void {
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

function printMissingModelCredentials(json: boolean): void {
	if (json) {
		printJson(
			buildJsonErrorEnvelope({
				command: "ask",
				operation: "credentials",
				error: "model-credentials-missing",
				message: "No usable model credentials configured.",
				nextAction: LOCAL_MODEL_JSON_COMMAND,
				nextActions: [
					LOCAL_MODEL_JSON_COMMAND,
					SOW_JSON_COMMAND,
					MODEL_CURRENT_JSON_COMMAND,
					MODEL_PROVIDERS_JSON_COMMAND,
					OLLAMA_SERVE_COMMAND,
				],
				nextCommand: LOCAL_MODEL_JSON_COMMAND,
				nextCommands: [
					LOCAL_MODEL_JSON_COMMAND,
					SOW_JSON_COMMAND,
					MODEL_PROVIDERS_JSON_COMMAND,
					MODEL_CURRENT_JSON_COMMAND,
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

async function ensureAskRuntimeReady(launch: LaunchDeps, json = false): Promise<boolean> {
	let readiness = await checkSessionReadiness();

	const canPrompt = Boolean(process.stdin.isTTY && process.stdout.isTTY);
	if (!readiness.providerConfigured && canPrompt && launch.recoverProvider) {
		const recovered = await launch.recoverProvider();
		if (recovered) readiness = { ...readiness, providerConfigured: true };
	}

	if (!readiness.providerConfigured) {
		printMissingModelCredentials(json);
		return false;
	}

	if (!isRuntimeRunning(readiness)) {
		return autoStartRuntime(findRepoRoot(), launch);
	}

	return true;
}

async function ensureAgentReady(
	readPluginState: (() => Promise<RuntimePluginState | null>) | undefined,
	reloadPlugins:
		| ((pluginIds: string[]) => Promise<RuntimePluginReloadResult | null>)
		| undefined,
	json = false,
): Promise<boolean> {
	if (!readPluginState) return true;
	const state = await readPluginState();
	if (!state) return true;

	// Primary check: sidecar exposes the active agent by capability.
	if (typeof state.activeAgent === "string" && state.activeAgent.length > 0)
		return true;

	// Recovery: if a known agent plugin is installed, attempt reload.
	// Falls back to PI_AGENT_PLUGIN_ID as the default installable agent.
	const reloadId = state.installed.find(isPiAgentPluginId) ?? PI_AGENT_PLUGIN_ID;
	if (state.installed.some(isPiAgentPluginId) && reloadPlugins) {
		const reload = await reloadPlugins([reloadId]);
		if (reload?.reloaded.length) return true;
		const refreshed = await readPluginState();
		if (
			typeof refreshed?.activeAgent === "string" &&
			refreshed.activeAgent.length > 0
		)
			return true;
		if (json && reload?.skipped.length) {
			printJson(
				buildJsonErrorEnvelope({
					command: "ask",
					operation: "plugin-readiness",
					error: "agent-reload-failed",
					message: "Agent reload was requested but the runtime skipped it.",
					nextAction: PI_AGENT_RELOAD_JSON_COMMAND,
					nextActions: [
						PI_AGENT_RELOAD_JSON_COMMAND,
						RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
						RUNTIME_START_COMMAND,
						RUNTIME_DOCTOR_COMMAND,
					],
					nextCommand: PI_AGENT_RELOAD_JSON_COMMAND,
					nextCommands: [
						PI_AGENT_RELOAD_JSON_COMMAND,
						RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
						RUNTIME_DOCTOR_NEXT_COMMAND,
					],
					extra: {
						action: "ask",
						installed: true,
						reloaded: reload.reloaded,
						skipped: reload.skipped,
						deferred: reload.deferred,
						recommendations: [
							{
								diagnostic: "agent-reload-failed",
								severity: "failure",
								summary: "The runtime did not reload the agent.",
								action: "Inspect plugin status and retry agent reload.",
								command: PI_AGENT_RELOAD_JSON_COMMAND,
							},
						],
					},
				}),
			);
			return false;
		}
	}

	const agentInstalled = state.installed.some(isPiAgentPluginId);
	if (json) {
		printJson(
			buildJsonErrorEnvelope({
				command: "ask",
				operation: "plugin-readiness",
				error: "agent-not-loaded",
				message: "No agent is loaded in the Refarm runtime.",
				nextAction: agentInstalled ? PI_AGENT_RELOAD_JSON_COMMAND : PI_AGENT_INSTALL_COMMAND,
				nextActions: [
					...(agentInstalled ? [PI_AGENT_RELOAD_JSON_COMMAND] : [PI_AGENT_INSTALL_COMMAND]),
					RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
					RUNTIME_START_COMMAND,
					RUNTIME_DOCTOR_COMMAND,
				],
				nextCommand: agentInstalled ? PI_AGENT_RELOAD_JSON_COMMAND : PI_AGENT_INSTALL_JSON_COMMAND,
				nextCommands: [
					...(agentInstalled ? [PI_AGENT_RELOAD_JSON_COMMAND] : [PI_AGENT_INSTALL_JSON_COMMAND]),
					RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
					RUNTIME_START_WAIT_COMMAND,
					RUNTIME_DOCTOR_NEXT_COMMAND,
				],
				extra: {
					action: "ask",
					installed: agentInstalled,
					recommendations: [
						{
							diagnostic: "agent-not-loaded",
							severity: "failure",
							summary: "No agent plugin is loaded in the runtime.",
							action: "Install or reload an agent plugin, then ensure the runtime is ready.",
							command: agentInstalled ? PI_AGENT_RELOAD_JSON_COMMAND : PI_AGENT_INSTALL_JSON_COMMAND,
						},
					],
				},
			}),
		);
		return false;
	}
	console.error(chalk.red("\n✗  No agent is loaded in the Refarm runtime."));
	if (!agentInstalled) {
		console.error(chalk.dim("   Install bundled plugins:  refarm plugin install"));
	}
	console.error(chalk.dim("   Reload runtime plugins:   /reload"));
	console.error(chalk.dim(`   Diagnose:                 ${RUNTIME_DOCTOR_COMMAND}`));
	return false;
}

export function createAskCommand(deps?: AskDeps, launchDeps?: LaunchDeps): Command {
	const resolved = deps ?? defaultDeps();
	const readActiveSession = resolved.readActiveSessionId ?? readActiveSessionId;
	const clearActiveSession =
		resolved.clearActiveSessionId ?? clearActiveSessionId;
	const persistActiveSession =
		resolved.persistActiveSessionId ?? writeActiveSessionIdAndVerify;

	return new Command("ask")
		.description("Ask pi-agent with automatic project context")
		.argument("<query>", "Question or instruction for pi-agent")
		.option("--files <files>", "Comma-separated file paths to include")
		.option("--new", "Start a fresh session, discarding conversation history")
		.option("--session <id>", "Use a specific session ID or unique prefix")
		.option("--json", "Output machine-readable ask result")
		.addHelpText(
			"after",
			`

Examples:
  $ refarm ask "hello"
  $ refarm ask "hello" --json
  $ refarm ask "explain this package" --files README.md,package.json
  $ refarm ask "start fresh" --new

Runtime:
  refarm ask uses the Refarm runtime. If credentials are configured and the
  runtime is stopped, refarm can start it before submitting the question.

  Configure credentials:  refarm sow
  Inspect model route:    refarm model current
  List model defaults:    refarm model providers
  Switch default model:   refarm model ${OPENAI_DEFAULT_REF}
  Diagnose runtime:       ${RUNTIME_DOCTOR_COMMAND}
  Always autostart:       ${RUNTIME_AUTOSTART_ALWAYS_COMMAND}
  Disable autostart:      ${RUNTIME_AUTOSTART_NEVER_COMMAND}
  Select runtime engine:  ${RUNTIME_ENGINE_AUTO_COMMAND}
  One-shot override:      ${RUNTIME_AUTOSTART_ENV_VAR}=always refarm ask "hello"
`,
		)
		.action(
			async (
				query: string,
				opts: { files?: string; new?: boolean; session?: string; json?: boolean },
			) => {
				if (!deps || launchDeps) {
					const ready = await ensureAskRuntimeReady(
						launchDeps ?? defaultLaunchDeps(),
						Boolean(opts.json),
					);
					if (!ready) {
						process.exitCode = 1;
						return;
					}
					if (
						!(await ensureAgentReady(
							resolved.readPluginState,
							resolved.reloadPlugins,
							Boolean(opts.json),
						))
					) {
						process.exitCode = 1;
						return;
					}
				}

				if (opts.new && opts.session) {
					if (opts.json) {
						const recoveryCommand = refarmCommand([
							"ask",
							quoteCommandArg(query),
							"--new",
							"--json",
						]);
						printJson(
							buildJsonErrorEnvelope({
								command: "ask",
								operation: "options",
								error: "invalid-options",
								message: "--new and --session cannot be used together.",
								nextAction: recoveryCommand,
								nextActions: [
									recoveryCommand,
								],
								nextCommand: recoveryCommand,
								nextCommands: [
									recoveryCommand,
								],
								extra: { action: "ask" },
							}),
						);
						process.exitCode = 1;
						return;
					}
					console.error(
						chalk.red("\n✗  --new and --session cannot be used together."),
					);
					process.exitCode = 1;
					return;
				}

				if (opts.new) {
					clearActiveSession();
				}

				const explicitSession = opts.session?.trim();
				let sessionId = opts.new
					? newSessionId()
					: (readActiveSession() ?? newSessionId());
				if (explicitSession && explicitSession.length > 0) {
					if (resolved.resolveSessionIdPrefix) {
						try {
							sessionId =
								await resolved.resolveSessionIdPrefix(explicitSession);
						} catch (error) {
							const message =
								error instanceof Error ? error.message : String(error);
							if (
								message.includes("No session matching") ||
								message.includes("Ambiguous session prefix")
							) {
								if (opts.json) {
									printJson(
										buildJsonErrorEnvelope({
											command: "ask",
											operation: "session-resolve",
											error: message.includes("Ambiguous session prefix")
												? "ambiguous-session-prefix"
												: "session-not-found",
											message,
											nextAction: SESSIONS_LIST_JSON_COMMAND,
											nextActions: [SESSIONS_LIST_JSON_COMMAND],
											nextCommand: SESSIONS_LIST_JSON_COMMAND,
											nextCommands: [SESSIONS_LIST_JSON_COMMAND],
											extra: { action: "ask" },
										}),
									);
									process.exitCode = 1;
									return;
								}
								console.error(chalk.red(`\n✗  ${message}`));
								console.error(
									chalk.dim(
										"   Use: refarm sessions list  to inspect available IDs.",
									),
								);
							} else {
								printAskError(message);
							}
							process.exitCode = 1;
							return;
						}
					} else {
						sessionId = explicitSession;
					}
				}

				const files = opts.files
					? opts.files
							.split(",")
							.map((file) => file.trim())
							.filter(Boolean)
					: [];

				const system = await (
					resolved.collectSystemPrompt ?? collectDefaultSystemPrompt
				)({
					cwd: process.cwd(),
					query,
					files,
				});

				const effort = createPiAgentRespondEffort({
					prompt: query,
					system,
					sessionId,
					source: "refarm-ask",
					historyTurns: DEFAULT_HISTORY_TURNS,
				});

				if (!opts.json) {
					console.log(chalk.bold.cyan(`pi-agent ▸ ${query}\n`));
				}

				try {
					const submittedAtMs = Date.now();
					const effortId = await resolved.submitEffort(effort);
					let content = "";
					let metadata: Record<string, unknown> | undefined;

					try {
						await resolved.followStream(
							effortId,
							(chunk) => {
								content += chunk.content;
								if (!opts.json) {
									process.stdout.write(chunk.content);
								}
								if (chunk.is_final) {
									if (!opts.json) {
										process.stdout.write("\n");
									}
									metadata = chunk.metadata as
										| Record<string, unknown>
										| undefined;
									if (metadata && !opts.json) {
										console.log(chalk.gray(`\n${"─".repeat(41)}`));
										console.log(chalk.gray(usageLine(metadata)));
									}
								}
							},
							{ submittedAtMs },
						);
					} catch (streamError) {
						const fallback = await resolved.readEffortResult?.(effortId);
						if (
							fallback?.status === "ok" &&
							typeof fallback.content === "string"
						) {
							content = fallback.content;
							metadata = fallback.metadata;
							if (!opts.json) {
								process.stdout.write(`${fallback.content}\n`);
							}
							if (fallback.metadata && !opts.json) {
								console.log(chalk.gray(`\n${"─".repeat(41)}`));
								console.log(chalk.gray(usageLine(fallback.metadata)));
							}
							persistActiveSession(sessionId);
							if (opts.json) {
								const result: AskJsonResult = {
									effortId,
									sessionId,
									content,
									...(metadata ? { metadata } : {}),
								};
								printAskSuccessJson(result);
							}
							return;
						}

						if (fallback?.status === "error") {
							throw new Error(
								fallback.error ?? "Effort failed without details",
							);
						}

						const sessionFallback =
							await resolved.readSessionFallback?.(sessionId);
						if (sessionFallback?.status === "ok") {
							content = sessionFallback.content;
							metadata = sessionFallback.metadata;
							if (!opts.json) {
								process.stdout.write(`${sessionFallback.content}\n`);
							}
							if (sessionFallback.metadata && !opts.json) {
								console.log(chalk.gray(`\n${"─".repeat(41)}`));
								console.log(chalk.gray(usageLine(sessionFallback.metadata)));
							}
							persistActiveSession(sessionId);
							if (opts.json) {
								const result: AskJsonResult = {
									effortId,
									sessionId,
									content,
									...(metadata ? { metadata } : {}),
								};
								printAskSuccessJson(result);
							}
							return;
						}

						throw streamError;
					}

					persistActiveSession(sessionId);
					if (opts.json) {
						const result: AskJsonResult = {
							effortId,
							sessionId,
							content,
							...(metadata ? { metadata } : {}),
						};
						printAskSuccessJson(result);
					}
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					if (opts.json) {
						printAskErrorJson(message);
					} else {
						printAskError(message);
					}
					process.exitCode = 1;
					return;
				}
			},
		);
}

export const askCommand = createAskCommand();
