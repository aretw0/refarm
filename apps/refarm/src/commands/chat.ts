import { launchProcess } from "@refarm.dev/cli/launch-process";
import {
	buildSystemPrompt,
	ContextRegistry,
	CwdContextProvider,
	DateContextProvider,
	GitStatusContextProvider,
	OperatorStateProvider,
	PolicyFilesContextProvider,
	SessionDigestContextProvider,
} from "@refarm.dev/context-provider-v1";
import type { Effort } from "@refarm.dev/effort-contract-v1";
import type { StreamChunk } from "@refarm.dev/stream-contract-v1";
import chalk from "chalk";
import { Command } from "commander";
import readline from "node:readline";
import {
	loadChatHistory,
	MAX_CHAT_HISTORY_LINES,
	rememberChatHistoryLine,
	saveChatHistory,
} from "./chat-history.js";
import {
	CHAT_HELP_TEXT,
	CHAT_RUNTIME_COMMANDS_HELP,
	parseChatLine,
} from "./chat-repl.js";
import { submitEffortWithRuntimeRecovery } from "./chat-runtime-recovery.js";
import {
	buildCurrentModelStatus,
	defaultModelDeps,
	printCurrentModel,
	printKnownModelProviders,
	resetScopedModelRoute,
	resolveRuntimeModelRoute,
	setFallbackModelRoute,
	setModelBaseUrl,
	setModelRoute,
	type ModelCommandDeps,
} from "./model.js";
import { createRuntimeAgentRespondEffort } from "./runtime-agent-effort.js";
import {
	readRuntimePluginState,
	reloadRuntimePluginsAndWait,
	type RuntimePluginState,
} from "./runtime-plugins.js";
import {
	followStreamFile,
	readEffortAndSessionFallback,
	readEffortResultFile,
	readLatestAgentEntryFromSession,
	resolveRuntimeStreamsDir,
	resolveRuntimeTaskResultsDir,
} from "./runtime-stream.js";
import { isFullSessionId, resolveSessionIdPrefix } from "./session-ids.js";
import {
	autoStartFarmhand,
	defaultLaunchDeps,
	findRepoRoot,
} from "./session-launch.js";
import {
	clearActiveSessionId,
	readActiveSessionId,
	writeActiveSessionIdAndVerify,
} from "./session-lock.js";
import {
	isSidecarUnavailable,
	printSidecarUnavailable,
} from "./sidecar-error.js";
import { fetchSidecarWithTimeout } from "./sidecar-fetch.js";
import { sidecarUrl } from "./sidecar-url.js";
export {
	loadChatHistory,
	rememberChatHistoryLine,
	resolveChatHistoryPath,
	saveChatHistory,
} from "./chat-history.js";

export {
	followStreamFile,
	readEffortResultFile,
	readLatestAgentEntryFromSession,
	resolveRuntimeStreamsDir,
	resolveRuntimeTaskResultsDir,
	};

	export interface ChatDeps {
	submitEffort(effort: Effort): Promise<string>;
	followStream(
		effortId: string,
		onChunk: (chunk: StreamChunk) => void,
		options?: {
			timeoutMs?: number;
			submittedAtMs?: number;
			readFallback?: () => Promise<{
				status: "ok" | "error";
				content?: string;
				metadata?: Record<string, unknown>;
				error?: string;
			} | null>;
		},
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
	reloadPlugins(
		pluginIds?: string[],
	): Promise<{ reloaded: string[]; skipped: string[] }>;
	readPluginState?(): Promise<RuntimePluginState | null>;
	readSessionFallback?(sessionId: string): Promise<{
		status: "ok";
		content: string;
		metadata?: Record<string, unknown>;
	} | null>;
	model?: ModelCommandDeps;
	configureCredentials?(args?: string[]): Promise<void>;
	recoverRuntime?(): Promise<boolean>;
	/** Override the spinner label. Receives the tick frame index and elapsed ms. */
	spinnerMessage?(frame: number, elapsedMs: number): string;
	}

	const DEFAULT_HISTORY_TURNS = 20;

	function newSessionId(): string {
	return `urn:refarm:session:v1:${crypto.randomUUID().replace(/-/g, "")}`;
	}

	async function submitViaHttp(effort: Effort): Promise<string> {
	const response = await fetchSidecarWithTimeout(sidecarUrl("/efforts"), {
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

	async function resolveSessionIdPrefixFromSidecar(
	prefix: string,
	): Promise<string> {
	if (isFullSessionId(prefix)) return prefix;
	const response = await fetchSidecarWithTimeout(sidecarUrl("/sessions"));
	if (!response.ok) throw new Error(`sidecar HTTP ${response.status}`);
	const body = (await response.json()) as {
		sessions?: Array<{ "@id": string }>;
	};
	return resolveSessionIdPrefix(prefix, body.sessions ?? []);
	}

	export function defaultChatDeps(): ChatDeps {
	const streamsDir = resolveRuntimeStreamsDir();
	const resultsDir = resolveRuntimeTaskResultsDir();
	return {
		submitEffort: submitViaHttp,
		reloadPlugins: async (pluginIds?: string[]) => {
			const result = await reloadRuntimePluginsAndWait(pluginIds, {
				onDeferred: (pluginId) => {
					process.stdout.write(
						chalk.yellow(`⏳ ${pluginId}: waiting for active tasks...\n`),
					);
				},
			});
			if (!result)
				throw new Error("Refarm runtime plugin reload is unavailable");
			return result;
		},
		readPluginState: readRuntimePluginState,
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
		configureCredentials: runSowCommand,
		recoverRuntime: () =>
			autoStartFarmhand(findRepoRoot(), defaultLaunchDeps()),
	};
	}

	async function runStatusCommand(args: string[] = []): Promise<void> {
	const node = process.argv[0];
	const entrypoint = process.argv[1];
	if (!node || !entrypoint) {
		throw new Error(
			"Cannot locate the refarm CLI entrypoint for status check.",
		);
	}
	const exitCode = await launchProcess({
		command: node,
		args: [entrypoint, "status", ...args],
		display: ["refarm", "status", ...args].join(" "),
	});
	if (exitCode !== 0) {
		throw new Error(`Status command exited with ${exitCode}`);
	}
	}

	async function runSowCommand(args: string[] = []): Promise<void> {
	const node = process.argv[0];
	const entrypoint = process.argv[1];
	if (!node || !entrypoint) {
		throw new Error(
			"Cannot locate the refarm CLI entrypoint for credential setup.",
		);
	}
	const exitCode = await launchProcess({
		command: node,
		args: [entrypoint, "sow", ...args],
		display: ["refarm", "sow", ...args].join(" "),
	});
	if (exitCode !== 0) {
		throw new Error(`Credential setup exited with ${exitCode}`);
	}
	}

	const SPINNER_FRAMES = [
	"⠋",
	"⠙",
	"⠹",
	"⠸",
	"⠼",
	"⠴",
	"⠦",
	"⠧",
	"⠇",
	"⠏",
	] as const;

	export function startThinkingSpinner(
	getMessage?: (frame: number, elapsedMs: number) => string,
	): () => void {
	if (!process.stdout.isTTY) return () => {};
	const startMs = Date.now();
	let frame = 0;
	const timer = setInterval(() => {
		const msg = getMessage
			? getMessage(frame, Date.now() - startMs)
			: "Thinking…";
		process.stdout.write(
			`\r${chalk.dim(SPINNER_FRAMES[frame % SPINNER_FRAMES.length])}  ${chalk.dim(msg)}`,
		);
		frame++;
	}, 80);
	return () => {
		clearInterval(timer);
		process.stdout.write("\r\x1b[2K");
	};
	}

	function usageLine(metadata: Record<string, unknown>): string {
	const model = metadata.model ?? "unknown";
	const tokensIn = metadata.tokens_in ?? 0;
	const tokensOut = metadata.tokens_out ?? 0;
	const pricing = pricingDisplay(metadata);
	return `model: ${model}  tokens: ${tokensIn} in / ${tokensOut} out  ${pricing}`;
	}

	function pricingDisplay(metadata: Record<string, unknown>): string {
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

	function printChatError(message: string): void {
	if (isSidecarUnavailable(message)) {
		console.error();
		printSidecarUnavailable();
	} else {
		console.error(chalk.red(`\n✗  ${message}`));
	}
	}

	export function resolveChatRuntimeModelRoute(
	modelStatus: ReturnType<typeof buildCurrentModelStatus>,
	): { modelProvider?: string; modelId?: string } {
	return resolveRuntimeModelRoute(modelStatus, "default");
	}

	export function buildChatSessionResumeHint(sessionId: string): string {
	return `To continue this session, run: refarm session --session ${sessionId}`;
	}

	export function buildChatOperatorResumeHint(): string {
	return "To inspect next operator action, run: refarm resume --next-action";
	}

	export async function createChatEffort(
	query: string,
	sessionId: string,
	modelDeps: ModelCommandDeps,
	options:
		| {
				system: string;
				historyTurns?: number;
		  }
		| undefined,
	): Promise<Effort> {
	const modelStatus = buildCurrentModelStatus(await modelDeps.loadTokens());
	const { modelProvider, modelId } = resolveChatRuntimeModelRoute(modelStatus);
	const historyTurns = options?.historyTurns ?? DEFAULT_HISTORY_TURNS;

	return createRuntimeAgentRespondEffort({
		prompt: query,
		system: options?.system ?? "",
		sessionId,
		source: "refarm-chat",
		historyTurns,
		modelProvider,
		modelId,
	});
	}

	async function runTurn(
	query: string,
	sessionId: string,
	deps: ChatDeps,
	): Promise<void> {
	const providers = [
		new SessionDigestContextProvider(),
		new CwdContextProvider(),
		new PolicyFilesContextProvider(),
		new OperatorStateProvider(),
		new DateContextProvider(),
		new GitStatusContextProvider(),
	];
	const registry = new ContextRegistry(providers);
	const entries = await registry.collect({ cwd: process.cwd(), query });
	const system = buildSystemPrompt(entries);

	const modelDeps = deps.model ?? defaultModelDeps();
	const effort = await createChatEffort(query, sessionId, modelDeps, {
		system,
	});

	const stopSpinner = startThinkingSpinner(deps.spinnerMessage?.bind(deps));
	let spinnerCleared = false;
	function clearSpinner() {
		if (!spinnerCleared) {
			stopSpinner();
			spinnerCleared = true;
		}
	}

	const submittedAtMs = Date.now();
	let effortId: string | null = null;
	try {
		effortId = await submitEffortWithRuntimeRecovery(effort, {
			...deps,
			onRecoveringRuntime: () => {
				console.error(chalk.yellow("\nRefarm runtime stopped responding."));
			},
		});
		await deps.followStream(
			effortId,
			(chunk) => {
				clearSpinner();
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
			{
				submittedAtMs,
				readFallback: () => {
					if (!effortId || !deps.readEffortResult) {
						return Promise.resolve(null);
					}
					return deps.readEffortResult(effortId);
				},
			},
		);
	} catch (streamError) {
		if (!effortId) {
			throw streamError;
		}
		const fallback = await readEffortAndSessionFallback(effortId, sessionId, {
			readEffortResult: deps.readEffortResult,
			readSessionFallback: deps.readSessionFallback,
		});
		if (fallback?.status === "ok" && typeof fallback.content === "string") {
			process.stdout.write(`${fallback.content}\n`);
			if (fallback.metadata) {
				console.log(chalk.gray(`\n${"─".repeat(41)}`));
				console.log(chalk.gray(usageLine(fallback.metadata)));
			}
			return;
		}
		if (fallback?.status === "error") {
			throw new Error(fallback.error ?? "Effort failed without details");
		}

		throw streamError;
	} finally {
		clearSpinner();
	}
	}

	/**
 * Core REPL loop. Call this after all readiness checks pass.
 * Both `refarm` (bare) and `refarm session` converge here.
 */
	export async function runSessionRepl(
	sessionId: string,
	deps: ChatDeps,
	label = "refarm",
	initialMessage?: string,
	): Promise<void> {
	const clearActiveSession = deps.clearActiveSessionId ?? clearActiveSessionId;
	const persistActiveSession =
		deps.persistActiveSessionId ?? writeActiveSessionIdAndVerify;

	let activeSessionId = sessionId;
	let hasPrintedResumeHint = false;
	const printResumeHints = () => {
		hasPrintedResumeHint = true;
		console.log(chalk.dim(buildChatSessionResumeHint(activeSessionId)));
		console.log(chalk.dim(buildChatOperatorResumeHint()));
	};

	console.log(
		chalk.bold.cyan(label) +
			chalk.dim(`  session:${activeSessionId.slice(-8)}  /help for commands`),
	);
	console.log();

	return new Promise((resolve) => {
		let chatHistory = loadChatHistory();
		let commandHistory: string[] = [];
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
			prompt: chalk.cyan("› "),
			terminal: true,
			historySize: 1000,
		});
		(rl as typeof rl & { history: string[] }).history = [...chatHistory];

		rl.prompt();

		if (initialMessage) {
			rl.emit("line", initialMessage);
		}

		rl.on("line", (line) => {
			const command = parseChatLine(line);

			const trimmedLine = line.trim();
			if (trimmedLine && command.kind !== "history") {
				commandHistory = [trimmedLine, ...commandHistory].slice(
					0,
					MAX_CHAT_HISTORY_LINES,
				);
			}
			switch (command.kind) {
				case "exit":
					console.log(chalk.dim("Goodbye."));
					printResumeHints();
					rl.close();
					break;

				case "help":
					console.log(chalk.dim(CHAT_HELP_TEXT));
					console.log();
					rl.prompt();
					break;

				case "history":
					if (command.action === "clear") {
						chatHistory = [];
						commandHistory = [];
						saveChatHistory(chatHistory);
						console.log(chalk.dim("✓ Chat history cleared."));
					} else {
						const allHistory = [...commandHistory, ...chatHistory];
						if (allHistory.length === 0) {
							console.log(chalk.dim("No chat history yet."));
						} else {
							for (let index = 0; index < allHistory.length; index++) {
								console.log(chalk.dim(`${index + 1}. ${allHistory[index]}`));
							}
						}
					}
					console.log();
					rl.prompt();
					break;

				case "status":
					rl.pause();
					void (async () => {
						try {
							await runStatusCommand();
						} catch (error) {
							const message =
								error instanceof Error ? error.message : String(error);
							console.error(chalk.red(`✗  ${message}`));
						}
						console.log();
						rl.resume();
						rl.prompt();
					})();
					break;

				case "new":
					activeSessionId = newSessionId();
					clearActiveSession();
					persistActiveSession(activeSessionId);
					console.log(chalk.dim(`✓ New session: ${activeSessionId.slice(-8)}`));
					console.log();
					rl.prompt();
					break;

				case "session": {
					const prefix = command.prefix;
					rl.pause();
					void (async () => {
						try {
							activeSessionId = deps.resolveSessionIdPrefix
								? await deps.resolveSessionIdPrefix(prefix)
								: prefix;
							persistActiveSession(activeSessionId);
							console.log(
								chalk.dim(
									`✓ Switched to session: ${activeSessionId.slice(-8)}`,
								),
							);
						} catch (error) {
							const message =
								error instanceof Error ? error.message : String(error);
							console.error(chalk.red(`✗  ${message}`));
						}
						console.log();
						rl.resume();
						rl.prompt();
					})();
					break;
				}

				case "reload":
					rl.pause();
					void (async () => {
						try {
							const ids = command.pluginIds;
							const { reloaded, skipped } = await deps.reloadPlugins(
								ids.length > 0 ? ids : undefined,
							);
							for (const p of reloaded) {
								console.log(chalk.green(`✓  ${p} reloaded`));
							}
							for (const p of skipped) {
								console.error(chalk.red(`✗  ${p} failed to reload`));
							}
							if (reloaded.length === 0 && skipped.length === 0) {
								console.log(chalk.dim("No plugins to reload."));
							}
						} catch (error) {
							const message =
								error instanceof Error ? error.message : String(error);
							console.error(chalk.red(`✗  ${message}`));
						}
						console.log();
						rl.resume();
						rl.prompt();
					})();
					break;

				case "model":
					rl.pause();
					void (async () => {
						try {
							const modelDeps = deps.model ?? defaultModelDeps();
							if (command.action === "current") {
								printCurrentModel(await modelDeps.loadTokens());
							} else if (command.action === "providers") {
								printKnownModelProviders();
							} else if (command.action === "fallback") {
								await setFallbackModelRoute(command.ref, modelDeps);
							} else if (command.action === "base-url") {
								await setModelBaseUrl(command.url, modelDeps);
							} else if (command.action === "reset") {
								await resetScopedModelRoute(command.scope, modelDeps);
							} else {
								await setModelRoute(command.ref, command.scope, modelDeps);
							}
						} catch (error) {
							const message =
								error instanceof Error ? error.message : String(error);
							console.error(chalk.red(`✗  ${message}`));
						}
						console.log();
						rl.resume();
						rl.prompt();
					})();
					break;

				case "login":
				case "keys": {
					rl.pause();
					void (async () => {
						try {
							await (deps.configureCredentials ?? runSowCommand)(
								command.kind === "keys" ? ["--reconfigure"] : command.args,
							);
							console.log(
								chalk.dim(
									"Refarm runtime reloads saved credentials before each task.",
								),
							);
						} catch (error) {
							const message =
								error instanceof Error ? error.message : String(error);
							console.error(chalk.red(`✗  ${message}`));
						}
						console.log();
						rl.resume();
						rl.prompt();
					})();
					break;
				}

				case "message": {
					if (command.text.length === 0) {
						rl.prompt();
						break;
					}
					chatHistory = rememberChatHistoryLine(chatHistory, command.text);
					rl.pause();
					void (async () => {
						try {
							await runTurn(command.text, activeSessionId, deps);
							persistActiveSession(activeSessionId);
						} catch (error) {
							const message =
								error instanceof Error ? error.message : String(error);
							printChatError(message);
						}
						console.log();
						rl.resume();
						rl.prompt();
					})();
					break;
				}
			}
		});

		rl.on("SIGINT", () => {
			console.log(chalk.dim("Goodbye."));
			printResumeHints();
			rl.close();
		});

		rl.on("close", () => {
			saveChatHistory(chatHistory);
			console.log(chalk.dim("\nSession saved."));
			if (!hasPrintedResumeHint) {
				printResumeHints();
			}
			resolve();
		});
	});
	}

	export function createChatCommand(deps?: ChatDeps): Command {
	return new Command("chat")
		.description("Interactive REPL — optionally send an initial message")
		.argument("[message]", "Initial message to send immediately")
		.option("--new", "Start a fresh session")
		.option("--session <id>", "Resume a specific session ID or prefix")
		.addHelpText(
			"after",
			`

	Examples:
  $ refarm chat
  $ refarm chat --new
  $ refarm chat --session <id-prefix>
  $ refarm chat "continue daqui"

	Runtime commands:
	${CHAT_RUNTIME_COMMANDS_HELP}
	`,
		)
		.action(
			async (
				message: string | undefined,
				opts: { new?: boolean; session?: string },
			) => {
				const { runSessionLaunchFlow } = await import("./session.js");
				await runSessionLaunchFlow({ ...opts, message }, deps);
			},
		);
	}

	export const chatCommand = createChatCommand();
