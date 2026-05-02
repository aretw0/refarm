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

		function stopAndReject(message: string): void {
			if (finished) return;
			finished = true;
			clearInterval(timer);
			reject(new Error(message));
		}

		function readNew(): void {
			if (finished) return;
			if (!filePath) {
				filePath = resolveStreamFilePath();
			}
			if (!filePath || !fs.existsSync(filePath)) {
				if (Date.now() >= deadline) {
					stopAndReject(
						`Timed out waiting for stream file for effort ${effortId}`,
					);
				}
				return;
			}

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

			if (Date.now() >= deadline) {
				stopAndReject(
					`Timed out waiting final stream chunk for effort ${effortId}`,
				);
			}
		}

		const timer = setInterval(readNew, 100);
		readNew();
	});
}

function defaultDeps(): AskDeps {
	const streamsDir = path.join(os.homedir(), ".refarm", "streams");
	return {
		submitEffort: submitViaHttp,
		followStream: (effortId, onChunk, options) =>
			followStreamFile(streamsDir, effortId, onChunk, options),
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
			const submittedAtMs = Date.now();
			const effortId = await resolved.submitEffort(effort);

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
		});
}

export const askCommand = createAskCommand();
