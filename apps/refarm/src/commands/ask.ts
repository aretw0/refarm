import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import type { Effort } from "@refarm.dev/effort-contract-v1";
import type { StreamChunk } from "@refarm.dev/stream-contract-v1";
import {
	buildSystemPrompt,
	ContextRegistry,
	CwdContextProvider,
	DateContextProvider,
	FilesContextProvider,
	GitStatusContextProvider,
} from "@refarm.dev/context-provider-v1";

export interface AskDeps {
	submitEffort(effort: Effort): Promise<string>;
	followStream(
		effortId: string,
		onChunk: (chunk: StreamChunk) => void,
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
): Promise<void> {
	return new Promise((resolve) => {
		const filePath = path.join(streamsDir, `${effortId}.ndjson`);
		let offset = 0;

		function readNew(): void {
			if (!fs.existsSync(filePath)) return;
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
					clearInterval(timer);
					resolve();
					return;
				}
			}
			offset = lines.length;
		}

		const timer = setInterval(readNew, 100);
		readNew();
	});
}

function defaultDeps(): AskDeps {
	const streamsDir = path.join(os.homedir(), ".refarm", "streams");
	return {
		submitEffort: submitViaHttp,
		followStream: (effortId, onChunk) =>
			followStreamFile(streamsDir, effortId, onChunk),
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
						pluginId: "pi-agent",
						fn: "respond",
						args: { prompt: query, system },
					},
				],
				source: "refarm-ask",
				submittedAt: new Date().toISOString(),
			};

			console.log(chalk.bold.cyan(`pi-agent ▸ ${query}\n`));
			const effortId = await resolved.submitEffort(effort);

			await resolved.followStream(effortId, (chunk) => {
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
			});
		});
}

export const askCommand = createAskCommand();
