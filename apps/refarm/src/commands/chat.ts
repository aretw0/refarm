import {
	dispatchCapability,
	isCapabilityGroup,
	type CapabilityEnvelope,
} from "@refarm.dev/capabilities";
import {
	loadChatHistory,
	MAX_CHAT_HISTORY_LINES,
	rememberChatHistoryLine,
	saveChatHistory,
} from "@refarm.dev/cli/chat-history";
import {
	CHAT_HELP_TEXT,
	CHAT_RUNTIME_COMMANDS_HELP,
	parseChatLine,
} from "@refarm.dev/cli/chat-repl";
import { executeProcessHandoff } from "@refarm.dev/cli/process-handoff";
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
import { fetchSidecarWithTimeout } from "@refarm.dev/sidecar-client";
import type { StreamChunk } from "@refarm.dev/stream-contract-v1";
import chalk from "chalk";
import { Command } from "commander";
import readline from "node:readline";
import { REFARM_BINARY, REFARM_PRODUCT_NAME } from "../brand.js";
import {
	capabilityHooksFor,
	capabilityRegistry,
	capabilitySlashNames,
} from "./capability-registry.js";
import { armEscapeCancel, createTurnCancelController } from "./chat-cancel.js";
import { submitEffortWithRuntimeRecovery } from "./chat-runtime-recovery.js";
import {
	buildCurrentModelStatus,
	defaultModelDeps,
	resolveRuntimeModelRoute,
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
import { autoStartFarmhand, defaultLaunchDeps, findRepoRoot } from "./session-launch.js";
import {
	clearActiveSessionId,
	readActiveSessionId,
	writeActiveSessionIdAndVerify,
} from "./session-lock.js";
import { isSidecarUnavailable, printSidecarUnavailable } from "./sidecar-error.js";
import { resolveSidecarUrlAsync, sidecarUrlAsync } from "./sidecar-url.js";
export {
	loadChatHistory,
	rememberChatHistoryLine,
	resolveChatHistoryPath,
	saveChatHistory,
} from "@refarm.dev/cli/chat-history";

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
	reloadPlugins(pluginIds?: string[]): Promise<{ reloaded: string[]; skipped: string[] }>;
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
	return `urn:sovereign:session:v1:${crypto.randomUUID().replace(/-/g, "")}`;
	}

	async function submitViaHttp(effort: Effort): Promise<string> {
	const response = await fetchSidecarWithTimeout(await sidecarUrlAsync("/efforts"), {
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

	async function resolveSessionIdPrefixFromSidecar(prefix: string): Promise<string> {
	if (isFullSessionId(prefix)) return prefix;
	const response = await fetchSidecarWithTimeout(await sidecarUrlAsync("/sessions"));
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
					process.stdout.write(chalk.yellow(`⏳ ${pluginId}: waiting for active tasks...\n`));
				},
			});
			if (!result) throw new Error("Refarm runtime plugin reload is unavailable");
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
		recoverRuntime: () => autoStartFarmhand(findRepoRoot(), defaultLaunchDeps()),
	};
	}

	async function runStatusCommand(args: string[] = []): Promise<void> {
	const node = process.argv[0];
	const entrypoint = process.argv[1];
	if (!node || !entrypoint) {
		throw new Error("Cannot locate the refarm CLI entrypoint for status check.");
	}
	const exitCode = await executeProcessHandoff({
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
		throw new Error("Cannot locate the refarm CLI entrypoint for credential setup.");
	}
	const exitCode = await executeProcessHandoff({
		command: node,
		args: [entrypoint, "sow", ...args],
		display: ["refarm", "sow", ...args].join(" "),
	});
	if (exitCode !== 0) {
		throw new Error(`Credential setup exited with ${exitCode}`);
	}
	}

	const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

	export function startThinkingSpinner(
	getMessage?: (frame: number, elapsedMs: number) => string,
	): () => void {
	if (!process.stdout.isTTY) return () => {};
	const startMs = Date.now();
	let frame = 0;
	const timer = setInterval(() => {
		const msg = getMessage ? getMessage(frame, Date.now() - startMs) : "Thinking…";
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
	if (metadata.pricing_mode === "subscription" || metadata.provider === "openai-codex") {
		return "subscription";
	}
	if (metadata.pricing_mode === "local" || metadata.provider === "ollama") {
		return "local";
	}
	return metadata.estimated_usd != null ? `~$${Number(metadata.estimated_usd).toFixed(4)}` : "";
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
	// Called once the turn's effort is submitted, so the REPL can wire ESC-to-cancel to
	// THIS effort id (the id `POST /efforts/:id/cancel` needs). Absent → no cancel wiring.
	onEffortStarted?: (effortId: string) => void,
	): Promise<void> {
	const providers = [
		// Resolved sidecar URL (env → .refarm config → config graph node → default),
		// not the provider's hardcoded 42001 which ignored REFARM_SIDECAR_URL.
		new SessionDigestContextProvider({
			sidecarUrl: await resolveSidecarUrlAsync(),
		}),
		new CwdContextProvider(),
		new PolicyFilesContextProvider(),
		new OperatorStateProvider(REFARM_BINARY),
		new DateContextProvider(),
		new GitStatusContextProvider(),
	];
	const registry = new ContextRegistry(providers);
	const entries = await registry.collect({ cwd: process.cwd(), query });
	const system = buildSystemPrompt(entries, {
		productName: REFARM_PRODUCT_NAME,
		binary: REFARM_BINARY,
	});

	const modelDeps = deps.model ?? defaultModelDeps();
	const effort = await createChatEffort(query, sessionId, modelDeps, {
		system,
	});

	// The hint that a turn is in flight. Default enriches "Thinking…" with the Esc-to-cancel
	// affordance once a couple of seconds pass (so a quick turn stays quiet, a slow one tells
	// the operator how to stop it). A caller-supplied spinnerMessage overrides.
	const spinnerMessage =
		deps.spinnerMessage?.bind(deps) ??
		((_frame: number, elapsedMs: number) =>
			elapsedMs > 2000 ? "Thinking…  (Esc to cancel)" : "Thinking…");
	const stopSpinner = startThinkingSpinner(spinnerMessage);
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
		onEffortStarted?.(effortId);
		await deps.followStream(
			effortId,
			(chunk) => {
				clearSpinner();
				process.stdout.write(chunk.content);
				if (chunk.is_final) {
					process.stdout.write("\n");
					const metadata = chunk.metadata as Record<string, unknown> | undefined;
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
	const persistActiveSession = deps.persistActiveSessionId ?? writeActiveSessionIdAndVerify;

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
		let hasHistoryChanges = false;
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
			const command = parseChatLine(line, capabilitySlashNames());

			const trimmedLine = line.trim();
			if (trimmedLine && command.kind !== "history") {
				commandHistory = [trimmedLine, ...commandHistory].slice(0, MAX_CHAT_HISTORY_LINES);
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
						const hadPersistableHistory = chatHistory.length > 0;
						chatHistory = [];
						commandHistory = [];
						if (hadPersistableHistory) {
							hasHistoryChanges = true;
						}
						console.log(chalk.dim("✓ Chat history cleared."));
					} else {
						const allHistory = [...commandHistory, ...chatHistory].slice(0, MAX_CHAT_HISTORY_LINES);
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
							const message = error instanceof Error ? error.message : String(error);
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
					if (!prefix) {
						console.log(chalk.dim(`✓ Active session: ${activeSessionId.slice(-8)}`));
						console.log();
						rl.prompt();
						break;
					}
					rl.pause();
					void (async () => {
						try {
							activeSessionId = deps.resolveSessionIdPrefix
								? await deps.resolveSessionIdPrefix(prefix)
								: prefix;
							persistActiveSession(activeSessionId);
							console.log(chalk.dim(`✓ Switched to session: ${activeSessionId.slice(-8)}`));
						} catch (error) {
							const message = error instanceof Error ? error.message : String(error);
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
							const message = error instanceof Error ? error.message : String(error);
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
							console.log(chalk.dim("Refarm runtime reloads saved credentials before each task."));
						} catch (error) {
							const message = error instanceof Error ? error.message : String(error);
							console.error(chalk.red(`✗  ${message}`));
						}
						console.log();
						rl.resume();
						rl.prompt();
					})();
					break;
				}

				case "capability": {
					// Deterministic verb: run the declared capability and print its
					// envelope. This never calls the model (that is only case
					// "message" → runTurn); a `/slash` is a local action.
					const entry = capabilityRegistry.get(command.name);
					if (!entry) {
						rl.prompt();
						break;
					}
					rl.pause();
					void (async () => {
						try {
							// One shared dispatch: resolve (a group's sub-action or a flat verb's argv),
							// validate against the derived schema, then run — the same path the TUI and web use.
							const outcome = await dispatchCapability(entry, command.argv);
							if (outcome.status === "unresolved") {
								console.log(`Usage: /${entry.name} <action>`);
								console.log();
								rl.resume();
								rl.prompt();
								return;
							}
							if (outcome.status === "invalid") {
								const detail = outcome.validation?.errors
									.map((e) => (e.field ? `${e.field} ${e.message}` : e.message))
									.join("; ");
								console.error(chalk.red(`✗  invalid input: ${detail ?? "invalid"}`));
							} else {
								const hookName = isCapabilityGroup(entry)
									? `${entry.name} ${outcome.invocation!.key}`
									: command.name;
								const hooks = capabilityHooksFor(hookName);
								console.log(
									hooks.renderText
										? hooks.renderText(outcome.envelope as CapabilityEnvelope, outcome.invocation!.input)
										: JSON.stringify(outcome.envelope, null, 2),
								);
							}
						} catch (error) {
							const message = error instanceof Error ? error.message : String(error);
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
					const nextHistory = rememberChatHistoryLine(chatHistory, command.text);
					if (nextHistory !== chatHistory) {
						chatHistory = nextHistory;
						hasHistoryChanges = true;
					}
					rl.pause();
					void (async () => {
						// ESC-to-cancel: interrupt THIS turn's effort without killing the
						// session (Ctrl-C/SIGINT does that). The controller learns the effort id
						// from runTurn's onEffortStarted, then an Escape keypress cancels it over
						// the sidecar (the real WASM epoch-interrupt). Disarmed in finally.
						const cancelController = createTurnCancelController({
							onResult: (result) => {
								process.stdout.write(`\n${chalk.yellow(result.message)}\n`);
								// Cancelling epoch-interrupts the WASM and tears down the agent's
								// runner, but the runtime respawns a fresh instance in ~1s, so the
								// next turn just works. Only if the respawn itself fails (rare) would
								// a `refarm runtime restart` be needed — so keep the note light.
								if (result.status === "cancelled") {
									process.stdout.write(
										chalk.dim("(the agent restarts automatically — give it a moment)\n"),
									);
								}
							},
						});
						const disarmEscape = armEscapeCancel({ onEscape: cancelController.onEscape });
						try {
							await runTurn(command.text, activeSessionId, deps, (effortId) =>
								cancelController.setEffortId(effortId),
							);
							persistActiveSession(activeSessionId);
						} catch (error) {
							const message = error instanceof Error ? error.message : String(error);
							printChatError(message);
						} finally {
							disarmEscape();
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
			if (hasHistoryChanges) {
				saveChatHistory(chatHistory);
			}
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
		.action(async (message: string | undefined, opts: { new?: boolean; session?: string }) => {
			const { runSessionLaunchFlow } = await import("./session.js");
			await runSessionLaunchFlow({ ...opts, message }, deps);
		});
	}

	export const chatCommand = createChatCommand();
