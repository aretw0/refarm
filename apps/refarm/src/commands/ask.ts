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
} from "@refarm.dev/context-provider-v1";
import type { Effort } from "@refarm.dev/effort-contract-v1";
import type { StreamChunk } from "@refarm.dev/stream-contract-v1";
import chalk from "chalk";
import { Command } from "commander";

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
}

async function submitViaHttp(effort: Effort): Promise<string> {
	const response = await fetch("http://127.0.0.1:42001/efforts", {
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
							chunk = JSON.parse(lines[index]) as StreamChunk;
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

function defaultDeps(): AskDeps {
	const streamsDir = path.join(os.homedir(), ".refarm", "streams");
	const resultsDir = path.join(os.homedir(), ".refarm", "task-results");
	return {
		submitEffort: submitViaHttp,
		followStream: (effortId, onChunk, options) =>
			followStreamFile(
				streamsDir,
				effortId,
				onChunk,
				() => readEffortResultFile(resultsDir, effortId),
				options,
			),
		readEffortResult: (effortId) => readEffortResultFile(resultsDir, effortId),
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
	const isFarmhandDown =
		message.includes("ECONNREFUSED") ||
		message.includes("fetch failed") ||
		message.includes("Farmhand HTTP");

	const isProviderError =
		message.includes("llm-bridge request failed") ||
		message.includes("Couldn't connect to server") ||
		message.includes("curl: (7)");

	if (isFarmhandDown) {
		console.error(chalk.red("\n✗  Farmhand is not running."));
		console.error(chalk.dim("   Start it:  npm run farmhand:daemon"));
		console.error(chalk.dim("   Status:    npm run farm:status"));
	} else if (isProviderError) {
		const providerMatch = message.match(/for provider "([^"]+)"/);
		const provider = providerMatch?.[1] ?? "the configured provider";
		console.error(chalk.red(`\n✗  LLM provider unavailable: ${provider}`));
		if (provider === "ollama") {
			console.error(chalk.dim("   Start Ollama:  ollama serve"));
			console.error(chalk.dim("   Or switch provider:  refarm keys"));
		} else {
			console.error(chalk.dim("   Check your API key:  refarm keys --status"));
			console.error(chalk.dim("   Reconfigure:         refarm keys"));
		}
	} else {
		console.error(chalk.red(`\n✗  ${message}`));
	}
}

export function createAskCommand(deps?: AskDeps): Command {
	const resolved = deps ?? defaultDeps();

	return new Command("ask")
		.description("Ask pi-agent with automatic project context")
		.argument("<query>", "Question or instruction for pi-agent")
		.option("--files <files>", "Comma-separated file paths to include")
		.action(async (query: string, opts: { files?: string }) => {
			const files = opts.files
				? opts.files
						.split(",")
						.map((file) => file.trim())
						.filter(Boolean)
				: [];

			const providers = [
				new SessionDigestContextProvider(),
				new CwdContextProvider(),
				new DateContextProvider(),
				new GitStatusContextProvider(),
				...(files.length > 0 ? [new FilesContextProvider(files)] : []),
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
						args: { prompt: query, system },
					},
				],
				source: "refarm-ask",
				submittedAt: new Date().toISOString(),
			};

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
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				printAskError(message);
				process.exit(1);
			}
		});
}

export const askCommand = createAskCommand();
