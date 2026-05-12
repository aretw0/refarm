import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
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
import { parseChatLine, CHAT_HELP_TEXT } from "./chat-repl.js";
import { isFullSessionId, resolveSessionIdPrefix } from "./session-ids.js";
import {
	clearActiveSessionId,
	readActiveSessionId,
	writeActiveSessionIdAndVerify,
} from "./session-lock.js";

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
	reloadPlugins(): Promise<{ reloaded: number; skipped: number }>;
}

const SIDECAR_URL = "http://127.0.0.1:42001";
const DEFAULT_HISTORY_TURNS = 20;

function newSessionId(): string {
	return `urn:refarm:session:v1:${crypto.randomUUID().replace(/-/g, "")}`;
}

async function submitViaHttp(effort: Effort): Promise<string> {
	const response = await fetch(`${SIDECAR_URL}/efforts`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(effort),
	});
	if (!response.ok) {
		throw new Error(`Farmhand HTTP ${response.status}`);
	}
	const payload = (await response.json()) as { effortId: string };
	return payload.effortId;
}

async function reloadPluginsViaHttp(): Promise<{ reloaded: number; skipped: number }> {
	const response = await fetch(`${SIDECAR_URL}/plugins/reload`, {
		method: "POST",
	});
	if (!response.ok) {
		throw new Error(`Farmhand HTTP ${response.status}`);
	}
	return response.json() as Promise<{ reloaded: number; skipped: number }>;
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
	const response = await fetch(`${SIDECAR_URL}/sessions`);
	if (!response.ok) throw new Error(`sidecar HTTP ${response.status}`);
	const body = (await response.json()) as { sessions?: Array<{ "@id": string }> };
	return resolveSessionIdPrefix(prefix, body.sessions ?? []);
}

export function defaultChatDeps(): ChatDeps {
	const streamsDir = path.join(os.homedir(), ".refarm", "streams");
	const resultsDir = path.join(os.homedir(), ".refarm", "task-results");
	return {
		submitEffort: submitViaHttp,
		reloadPlugins: reloadPluginsViaHttp,
		resolveSessionIdPrefix: resolveSessionIdPrefixFromSidecar,
		followStream: (effortId, onChunk, options) =>
			followStreamFile(streamsDir, effortId, onChunk, options),
		readEffortResult: (effortId) => readEffortResultFile(resultsDir, effortId),
		readActiveSessionId,
		clearActiveSessionId,
		persistActiveSessionId: writeActiveSessionIdAndVerify,
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
	const isFarmhandDown =
		message.includes("ECONNREFUSED") ||
		message.includes("fetch failed") ||
		message.includes("Farmhand HTTP");
	if (isFarmhandDown) {
		console.error(chalk.red("\n✗  Farmhand is not running."));
		console.error(chalk.dim("   Start it:  npm run farmhand:daemon"));
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

	const effort: Effort = {
		id: crypto.randomUUID(),
		direction: "ask",
		tasks: [
			{
				id: crypto.randomUUID(),
				pluginId: "@refarm/pi-agent",
				fn: "respond",
				args: {
					prompt: query,
					system,
					session_id: sessionId,
					history_turns: DEFAULT_HISTORY_TURNS,
				},
			},
		],
		source: "refarm-chat",
		submittedAt: new Date().toISOString(),
	};

	const submittedAtMs = Date.now();
	const effortId = await deps.submitEffort(effort);

	try {
		await deps.followStream(
			effortId,
			(chunk) => {
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
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
			prompt: chalk.cyan("› "),
			terminal: true,
		});

		rl.prompt();

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
							const result = await deps.reloadPlugins();
							console.log(
								chalk.dim(
									`✓ Plugins reloaded: ${result.reloaded} loaded, ${result.skipped} skipped`,
								),
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

				case "message": {
					if (command.text.length === 0) {
						rl.prompt();
						break;
					}
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
			console.log(chalk.dim("\nSession saved."));
			resolve();
		});
	});
}

export function createChatCommand(deps?: ChatDeps): Command {
	return new Command("chat")
		.description("Alias for `refarm session` — interactive REPL")
		.option("--new", "Start a fresh session")
		.option("--session <id>", "Resume a specific session ID or prefix")
		.action(async (opts: { new?: boolean; session?: string }) => {
			const { runSessionLaunchFlow } = await import("./session.js");
			await runSessionLaunchFlow(opts, deps);
		});
}

export const chatCommand = createChatCommand();
