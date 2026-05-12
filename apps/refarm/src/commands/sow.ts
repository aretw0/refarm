import { Command } from "commander";
import chalk from "chalk";
import inquirer from "inquirer";
import { ExitPromptError } from "@inquirer/core";
import { SiloCore } from "@refarm.dev/silo";
import { SowerCore } from "@refarm.dev/sower";
import { tryOpenUrl } from "../utils/open-url.js";
import {
	githubCredentialProvider,
	cloudflareCredentialProvider,
	llmCredentialProvider,
} from "../credentials/index.js";

export const sowCommand = new Command("sow")
	.description("Collect provider credentials into your local Silo")
	.action(async () => {
		console.log(chalk.yellow("Silo: Preparing to collect."));

		try {
			const { owner } = await inquirer.prompt([
				{
					type: "input",
					name: "owner",
					message: "Your GitHub username or org:",
					default: "refarm-dev",
				},
			]);

			const ctx = { tryOpenUrl };

			// ── Infrastructure credentials ────────────────────────────────────
			const githubToken = await githubCredentialProvider.collect(ctx);
			const cloudflareToken = await cloudflareCredentialProvider.collect(ctx);

			const sower = new SowerCore();
			const results = await sower.sow(
				{ githubToken, cloudflareToken },
				{ owner },
			);

			// ── LLM provider ──────────────────────────────────────────────────
			const llm = await llmCredentialProvider.collectLlm(ctx);

			const silo = new SiloCore();
			await silo.saveTokens({
				llmProvider: llm.provider,
				...(llm.apiKey ? { llmApiKey: llm.apiKey } : {}),
			});

			console.log(
				chalk.gray(
					`\n  Silo: Credentials stored at ${results.storagePath ?? "~/.refarm/identity.json"}`,
				),
			);
			console.log(chalk.gray("  Run 'refarm health' to audit connectivity at any time."));
		} catch (error) {
			if (!(error instanceof ExitPromptError)) throw error;
			console.log(chalk.gray("\n  Cancelled."));
			process.exit(0);
		}
	});
