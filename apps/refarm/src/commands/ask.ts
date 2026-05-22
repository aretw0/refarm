import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	buildSystemPrompt,
	ContextRegistry,
	CwdContextProvider,
	DateContextProvider,
	FilesContextProvider,
	GitStatusContextProvider,
	SessionDigestContextProvider,
	type ContextProvider,
} from "@refarm.dev/context-provider-v1";
import { PI_AGENT_PLUGIN_ID } from "@refarm.dev/config";
import type { Effort } from "@refarm.dev/effort-contract-v1";
import type { StreamChunk } from "@refarm.dev/stream-contract-v1";
import chalk from "chalk";
import { Command } from "commander";
import { createPiAgentRespondEffort } from "./pi-agent-effort.js";
import {
	readRuntimePluginState,
	reloadRuntimePlugins,
	type RuntimePluginReloadResult,
	type RuntimePluginState,
} from "./runtime-plugins.js";
import { isFullSessionId, resolveSessionIdPrefix } from "./session-ids.js";
import {
	clearActiveSessionId,
	readActiveSessionId,
	writeActiveSessionIdAndVerify,
} from "./session-lock.js";
import {
	autoStartRuntime,
	checkSessionReadiness,
	defaultLaunchDeps,
	findRepoRoot,
	isRuntimeRunning,
	type LaunchDeps,
} from "./session-launch.js";
import {
	RUNTIME_AUTOSTART_ALWAYS_COMMAND,
	RUNTIME_AUTOSTART_NEVER_COMMAND,
	RUNTIME_DOCTOR_COMMAND,
	RUNTIME_ENGINE_AUTO_COMMAND,
	RUNTIME_START_COMMAND,
} from "./runtime-recovery.js";
import { isSidecarUnavailable, printSidecarUnavailable } from "./sidecar-error.js";
import { sidecarUrl } from "./sidecar-url.js";
import { defaultProviderModelRef } from "../model-routing.js";

const OPENAI_DEFAULT_REF = defaultProviderModelRef("openai");

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
	const streamsDir = path.join(os.homedir(), ".refarm", "streams");
	const resultsDir = path.join(os.homedir(), ".refarm", "task-results");
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
	const isPiAgentMissing =
		message.includes(`${PI_AGENT_PLUGIN_ID} not loaded`) ||
		message.includes("pi-agent not loaded") ||
		message.includes(`Plugin "${PI_AGENT_PLUGIN_ID}" is not loaded`);

	const isProviderError =
		message.includes("model-bridge request failed") ||
		message.includes("Couldn't connect to server") ||
		message.includes("curl: (7)");

	if (isPiAgentMissing) {
		console.error(chalk.red("\n✗  pi-agent is not loaded in the Refarm runtime."));
		console.error(chalk.dim("   Install bundled plugins:  refarm plugin install"));
		console.error(chalk.dim("   Reload runtime plugins:   /reload @refarm/pi-agent"));
		console.error(chalk.dim(`   Or restart runtime:       ${RUNTIME_START_COMMAND}`));
		console.error(chalk.dim(`   Diagnose:                 ${RUNTIME_DOCTOR_COMMAND}`));
	} else if (isSidecarUnavailable(message)) {
		console.error();
		printSidecarUnavailable();
	} else if (isProviderError) {
		const providerMatch = message.match(/for provider "([^"]+)"/);
		const provider = providerMatch?.[1] ?? "the configured provider";
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

async function ensureAskRuntimeReady(launch: LaunchDeps): Promise<boolean> {
	let readiness = await checkSessionReadiness();

	const canPrompt = Boolean(process.stdin.isTTY && process.stdout.isTTY);
	if (!readiness.providerConfigured && canPrompt && launch.recoverProvider) {
		const recovered = await launch.recoverProvider();
		if (recovered) readiness = { ...readiness, providerConfigured: true };
	}

	if (!readiness.providerConfigured) {
		console.error(chalk.red("\n✗  No usable model credentials configured."));
		console.error(chalk.dim("   Set up credentials: refarm sow"));
		console.error(chalk.dim("   Inspect route:      refarm model current"));
		console.error(chalk.dim("   List providers:     refarm model providers"));
		console.error(
			chalk.dim("   Or use Ollama:      ollama serve  (then refarm sow)"),
		);
		return false;
	}

	if (!isRuntimeRunning(readiness)) {
		return autoStartRuntime(findRepoRoot(), launch);
	}

	return true;
}

async function ensurePiAgentReady(
	readPluginState: (() => Promise<RuntimePluginState | null>) | undefined,
	reloadPlugins:
		| ((pluginIds: string[]) => Promise<RuntimePluginReloadResult | null>)
		| undefined,
): Promise<boolean> {
	if (!readPluginState) return true;
	const state = await readPluginState();
	if (!state) return true;
	if (state.loaded.includes(PI_AGENT_PLUGIN_ID)) return true;

	if (state.installed.includes(PI_AGENT_PLUGIN_ID) && reloadPlugins) {
		const reload = await reloadPlugins([PI_AGENT_PLUGIN_ID]);
		if (reload?.reloaded.includes(PI_AGENT_PLUGIN_ID)) return true;
		const refreshed = await readPluginState();
		if (refreshed?.loaded.includes(PI_AGENT_PLUGIN_ID)) return true;
	}

	console.error(chalk.red("\n✗  pi-agent is not loaded in the Refarm runtime."));
	if (!state.installed.includes(PI_AGENT_PLUGIN_ID)) {
		console.error(chalk.dim("   Install bundled plugins:  refarm plugin install"));
	}
	if (state.known.includes(PI_AGENT_PLUGIN_ID)) {
		console.error(chalk.dim("   Reload runtime plugins:   /reload @refarm/pi-agent"));
	} else {
		console.error(chalk.dim("   Restart runtime:          refarm"));
	}
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
		.addHelpText(
			"after",
			`

Examples:
  $ refarm ask "hello"
  $ refarm ask "explain this package" --files README.md,package.json
  $ refarm ask "start fresh" --new

Runtime:
  refarm ask uses the Refarm runtime. If credentials are configured and the
  runtime is stopped, refarm can start it before submitting the question.

  Configure credentials:  refarm sow
  Diagnose runtime:       ${RUNTIME_DOCTOR_COMMAND}
  Always autostart:       ${RUNTIME_AUTOSTART_ALWAYS_COMMAND}
  Disable autostart:      ${RUNTIME_AUTOSTART_NEVER_COMMAND}
  Select runtime engine:  ${RUNTIME_ENGINE_AUTO_COMMAND}
  One-shot override:      REFARM_RUNTIME_AUTOSTART=always refarm ask "hello"
`,
		)
		.action(
			async (
				query: string,
				opts: { files?: string; new?: boolean; session?: string },
			) => {
				if (!deps || launchDeps) {
					const ready = await ensureAskRuntimeReady(
						launchDeps ?? defaultLaunchDeps(),
					);
					if (!ready) {
						process.exit(1);
					}
					if (
						!(await ensurePiAgentReady(
							resolved.readPluginState,
							resolved.reloadPlugins,
						))
					) {
						process.exit(1);
					}
				}

				if (opts.new && opts.session) {
					console.error(
						chalk.red("\n✗  --new and --session cannot be used together."),
					);
					process.exit(1);
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
								console.error(chalk.red(`\n✗  ${message}`));
								console.error(
									chalk.dim(
										"   Use: refarm sessions list  to inspect available IDs.",
									),
								);
							} else {
								printAskError(message);
							}
							process.exit(1);
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

				console.log(chalk.bold.cyan(`pi-agent ▸ ${query}\n`));

				try {
					const submittedAtMs = Date.now();
					const effortId = await resolved.submitEffort(effort);

					try {
						await resolved.followStream(
							effortId,
							(chunk) => {
								process.stdout.write(chunk.content);
								if (chunk.is_final) {
									process.stdout.write("\n");
									const metadata = chunk.metadata as
										| Record<string, unknown>
										| undefined;
									if (metadata) {
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
							process.stdout.write(`${fallback.content}\n`);
							if (fallback.metadata) {
								console.log(chalk.gray(`\n${"─".repeat(41)}`));
								console.log(chalk.gray(usageLine(fallback.metadata)));
							}
							persistActiveSession(sessionId);
							return;
						}

						if (fallback?.status === "error") {
							throw new Error(
								fallback.error ?? "Effort failed without details",
							);
						}

						throw streamError;
					}

					persistActiveSession(sessionId);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					printAskError(message);
					process.exit(1);
				}
			},
		);
}

export const askCommand = createAskCommand();
