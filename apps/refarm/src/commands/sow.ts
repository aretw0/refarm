import { Command } from "commander";
import chalk from "chalk";
import inquirer from "inquirer";
import { ExitPromptError } from "@inquirer/core";
import { SowerCore } from "@refarm.dev/sower";
import { tryOpenUrl } from "../utils/open-url.js";
import {
	githubCredentialProvider,
	cloudflareCredentialProvider,
} from "../credentials/index.js";

const PROVIDERS = [githubCredentialProvider, cloudflareCredentialProvider];

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
			const credentials: Record<string, string> = {};
			for (const provider of PROVIDERS) {
				credentials[provider.id] = await provider.collect(ctx);
			}

			const sower = new SowerCore();
			const results = await sower.sow(
				{
					githubToken: credentials["github"]!,
					cloudflareToken: credentials["cloudflare"]!,
				},
				{ owner },
			);

			console.log(
				chalk.gray(
					`\n  Silo: Credentials stored at ${results.storagePath ?? "~/.refarm/identity.json"}`,
				),
			);
			console.log(
				chalk.gray("\n  Run 'refarm health' to audit connectivity at any time."),
			);
		} catch (error) {
			if (!(error instanceof ExitPromptError)) throw error;
			console.log(chalk.gray("\n  Cancelled."));
			process.exit(0);
		}
	});
