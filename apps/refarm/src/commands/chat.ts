import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import {
	buildSystemPrompt,
	ContextRegistry,
	CwdContextProvider,
	DateContextProvider,
	GitStatusContextProvider,
	SessionDigestContextProvider,
} from "@refarm.dev/context-provider-v1";
import type { Effort } from "@refarm.dev/effort-contract-v1";
import type { StreamChunk } from "@refarm.dev/stream-contract-v1";
import chalk from "chalk";
import { Command } from "commander";
import {
	parseChatLine,
	CHAT_HELP_TEXT,
	CHAT_RUNTIME_COMMANDS_HELP,
} from "./chat-repl.js";
import {
	defaultModelDeps,
	printCurrentModel,
	resetScopedModelRoute,
	setFallbackModelRoute,
	setModelBaseUrl,
	setModelRoute,
	type ModelCommandDeps,
} from "./model.js";
import { createPiAgentRespondEffort } from "./pi-agent-effort.js";
import { isFullSessionId, resolveSessionIdPrefix } from "./session-ids.js";
import {
	clearActiveSessionId,
	readActiveSessionId,
	writeActiveSessionIdAndVerify,
} from "./session-lock.js";
import { isSidecarUnavailable, printSidecarUnavailable } from "./sidecar-error.js";
import { sidecarUrl } from "./sidecar-url.js";
import { reloadRuntimePluginsAndWait } from "./runtime-plugins.js";

export interface ChatDeps {
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
	reloadPlugins(pluginIds?: string[]): Promise<{ reloaded: string[]; skipped: string[] }>;
	model?: ModelCommandDeps;
	configureCredentials?(args?: string[]): Promise<void>;
	/** Override the spinner label. Receives the tick frame index and elapsed ms. */
	spinnerMessage?(frame: number, elapsedMs: number): string;
}

const DEFAULT_HISTORY_TURNS = 20;
const MAX_CHAT_HISTORY_LINES = 500;

function newSessionId(): string {
	return `urn:refarm:session:v1:${crypto.randomUUID().replace(/-/g, "")}`;
}

export function resolveChatHistoryPath(homeDir = os.homedir()): string {
	return path.join(homeDir, ".refarm", "chat-history");
}

export function loadChatHistory(historyPath = resolveChatHistoryPath()): string[] {
	if (!fs.existsSync(historyPath)) return [];
	return fs
		.readFileSync(historyPath, "utf-8")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.slice(0, MAX_CHAT_HISTORY_LINES);
}

export function rememberChatHistoryLine(
	history: string[],
	line: string,
): string[] {
	const trimmed = line.trim();
	if (!trimmed || trimmed.startsWith("/")) return history;
	return [
		trimmed,
		...history.filter((entry) => entry !== trimmed),
	].slice(0, MAX_CHAT_HISTORY_LINES);
}

export function saveChatHistory(
	history: readonly string[],
	historyPath = resolveChatHistoryPath(),
): void {
	fs.mkdirSync(path.dirname(historyPath), { recursive: true });
	fs.writeFileSync(historyPath, `${history.slice(0, MAX_CHAT_HISTORY_LINES).join("\n")}\n`, "utf-8");
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
	options?: { timeoutMs?: number; submittedAtMs?: number },
): Promise<void> {
	return new Promise((resolve, reject) => {
		const submittedAtMs = options?.submittedAtMs ?? Date.now();
		const timeoutMs = options?.timeoutMs ?? 60_000;
		const deadline = Date.now() + timeoutMs;
		let filePath: string | null = null;
		let offset = 0;
		let finished = false;
		let polling = false;

		function resolveStreamFilePath(): string | null {
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
		}

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
				if (!filePath) filePath = resolveStreamFilePath();
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
		const parsed = JSON.parse(raw) as unknown;
		return extractResultPayload(parsed);
	} catch {
		return null;
	}
}

function extractResultPayload(result: unknown): {
	status: "ok" | "error";
	content?: string;
	metadata?: Record<string, unknown>;
	error?: string;
} | null {
	if (!result || typeof result !== "object") return null;
	const effort = result as { status?: string; results?: Array<{ status?: string; result?: unknown; error?: unknown }> };
	if (effort.status !== "done" && effort.status !== "failed") return null;
	const task = Array.isArray(effort.results) ? effort.results[0] : undefined;
	if (!task || typeof task !== "object") return null;
	if (task.status === "error") {
		return {
			status: "error",
			error: typeof task.error === "string" ? task.error : "Effort finished with task error",
		};
	}
	let payload: unknown = task.result;
	if (typeof payload === "string") {
		const rawContent = payload;
		try { payload = JSON.parse(payload); } catch { return { status: "ok", content: rawContent }; }
	}
	if (typeof payload === "string") return { status: "ok", content: payload };
	if (!payload || typeof payload !== "object") return null;
	const value = payload as { content?: unknown; model?: unknown; provider?: unknown; usage?: unknown };
	const content = value.content;
	if (typeof content !== "string") return null;
	const metadata: Record<string, unknown> = {};
	if (typeof value.model === "string") metadata.model = value.model;
	if (typeof value.provider === "string") metadata.provider = value.provider;
	if (value.usage && typeof value.usage === "object") {
		const usage = value.usage as { tokens_in?: unknown; tokens_out?: unknown; estimated_usd?: unknown };
		if (typeof usage.tokens_in === "number") metadata.tokens_in = usage.tokens_in;
		if (typeof usage.tokens_out === "number") metadata.tokens_out = usage.tokens_out;
		if (typeof usage.estimated_usd === "number") metadata.estimated_usd = usage.estimated_usd;
	}
	return { status: "ok", content, metadata: Object.keys(metadata).length > 0 ? metadata : undefined };
}

async function resolveSessionIdPrefixFromSidecar(prefix: string): Promise<string> {
	if (isFullSessionId(prefix)) return prefix;
	const response = await fetch(sidecarUrl("/sessions"));
	if (!response.ok) throw new Error(`sidecar HTTP ${response.status}`);
	const body = (await response.json()) as { sessions?: Array<{ "@id": string }> };
	return resolveSessionIdPrefix(prefix, body.sessions ?? []);
}

export function defaultChatDeps(): ChatDeps {
	const streamsDir = path.join(os.homedir(), ".refarm", "streams");
	const resultsDir = path.join(os.homedir(), ".refarm", "task-results");
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
			if (!result) throw new Error("Refarm runtime plugin reload is unavailable");
			return result;
		},
		resolveSessionIdPrefix: resolveSessionIdPrefixFromSidecar,
		followStream: (effortId, onChunk, options) =>
			followStreamFile(streamsDir, effortId, onChunk, options),
		readEffortResult: (effortId) => readEffortResultFile(resultsDir, effortId),
		readActiveSessionId,
		clearActiveSessionId,
		persistActiveSessionId: writeActiveSessionIdAndVerify,
		configureCredentials: runSowCommand,
	};
}

async function runSowCommand(args: string[] = []): Promise<void> {
	const node = process.argv[0];
	const entrypoint = process.argv[1];
	if (!node || !entrypoint) {
		throw new Error("Cannot locate the refarm CLI entrypoint for credential setup.");
	}
	const result = spawnSync(node, [entrypoint, "sow", ...args], { stdio: "inherit" });
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(
			`Credential setup exited with ${result.status ?? result.signal ?? "unknown status"}`,
		);
	}
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

function startThinkingSpinner(getMessage?: (frame: number, elapsedMs: number) => string): () => void {
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
	const usd =
		metadata.estimated_usd != null
			? `~$${Number(metadata.estimated_usd).toFixed(4)}`
			: "";
	return `model: ${model}  tokens: ${tokensIn} in / ${tokensOut} out  ${usd}`;
}

function printChatError(message: string): void {
	if (isSidecarUnavailable(message)) {
		console.error();
		printSidecarUnavailable();
	} else {
		console.error(chalk.red(`\n✗  ${message}`));
	}
}

async function runTurn(
	query: string,
	sessionId: string,
	deps: ChatDeps,
): Promise<void> {
	const providers = [
		new SessionDigestContextProvider(),
		new CwdContextProvider(),
		new DateContextProvider(),
		new GitStatusContextProvider(),
	];
	const registry = new ContextRegistry(providers);
	const entries = await registry.collect({ cwd: process.cwd(), query });
	const system = buildSystemPrompt(entries);

	const effort = createPiAgentRespondEffort({
		prompt: query,
		system,
		sessionId,
		source: "refarm-chat",
		historyTurns: DEFAULT_HISTORY_TURNS,
	});

	const submittedAtMs = Date.now();
	const effortId = await deps.submitEffort(effort);

	const stopSpinner = startThinkingSpinner(deps.spinnerMessage?.bind(deps));
	let spinnerCleared = false;
	function clearSpinner() {
		if (!spinnerCleared) {
			stopSpinner();
			spinnerCleared = true;
		}
	}

	try {
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
			{ submittedAtMs },
		);
	} catch (streamError) {
		clearSpinner();
		const fallback = await deps.readEffortResult?.(effortId);
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

	console.log(
		chalk.bold.cyan(label) +
			chalk.dim(`  session:${activeSessionId.slice(-8)}  /help for commands`),
	);
	console.log();

	return new Promise((resolve) => {
		let chatHistory = loadChatHistory();
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

			switch (command.kind) {
				case "exit":
					console.log(chalk.dim("Goodbye."));
					rl.close();
					resolve();
					break;

				case "help":
					console.log(chalk.dim(CHAT_HELP_TEXT));
					console.log();
					rl.prompt();
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
								chalk.dim(`✓ Switched to session: ${activeSessionId.slice(-8)}`),
							);
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

				case "model":
					rl.pause();
					void (async () => {
						try {
							const modelDeps = deps.model ?? defaultModelDeps();
							if (command.action === "current") {
								printCurrentModel(await modelDeps.loadTokens());
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
							const message = error instanceof Error ? error.message : String(error);
							console.error(chalk.red(`✗  ${message}`));
						}
						console.log();
						rl.resume();
						rl.prompt();
					})();
					break;

				case "login":
					rl.pause();
					void (async () => {
						try {
							await (deps.configureCredentials ?? runSowCommand)(command.args);
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
							const message = error instanceof Error ? error.message : String(error);
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

		rl.on("close", () => {
			saveChatHistory(chatHistory);
			console.log(chalk.dim("\nSession saved."));
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
