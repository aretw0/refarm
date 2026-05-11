import { Command } from "commander";
import chalk from "chalk";
import inquirer from "inquirer";
import { ExitPromptError } from "@inquirer/core";
import { execFile } from "node:child_process";
import { SowerCore } from "@refarm.dev/sower";
import { secretInput } from "../prompts/secret-input.js";

function tryOpenUrl(url: string): void {
	const [bin, ...args] =
		process.platform === "darwin"
			? ["open", url]
			: process.platform === "win32"
				? ["cmd", "/c", "start", "", url]
				: ["xdg-open", url];
	if (!bin) return;
	execFile(bin, args, () => {
		// best-effort — ignore errors, caller already printed the URL
	});
}

function providerHeader(name: string, description: string, url: string): void {
	console.log(chalk.bold(`\n  ${name}`));
	console.log(chalk.gray(`  ${description}`));
	console.log(chalk.cyan(`  → ${url}\n`));
	tryOpenUrl(url);
}

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

			providerHeader(
				"GitHub",
				"Create a Personal Access Token with repo and read:org scopes.",
				"https://github.com/settings/tokens/new?scopes=repo%2Cread%3Aorg&description=refarm",
			);
			const githubToken = await secretInput({ message: "Paste the value:" });

			providerHeader(
				"Cloudflare",
				"Create an API Token with Workers Scripts:Edit and R2:Edit permissions.",
				"https://dash.cloudflare.com/profile/api-tokens",
			);
			const cloudflareToken = await secretInput({ message: "Paste the value:" });

			const sower = new SowerCore();
			const results = await sower.sow(
				{ githubToken, cloudflareToken },
				{ owner },
			);

			console.log(
				chalk.green(
					`\n  Silo: Credentials stored at ${results.storagePath ?? "~/.refarm/identity.json"}`,
				),
			);

			console.log();
			const githubResult = results["github"];
			if (githubResult?.ok) {
				console.log(
					chalk.green(
						`  ✓ GitHub  — ${githubResult.count} repositories visible`,
					),
				);
			} else {
				console.log(
					chalk.red(
						`  ✗ GitHub  — ${githubResult?.error ?? "connection failed"}`,
					),
				);
			}

			const cfResult = results["cloudflare"];
			if (cfResult?.ok) {
				console.log(chalk.green("  ✓ Cloudflare — API token verified"));
			} else {
				console.log(
					chalk.red("  ✗ Cloudflare — API token could not be verified"),
				);
			}

			console.log(
				chalk.gray("\n  Run 'refarm health' to audit connectivity at any time."),
			);
		} catch (error) {
			if (!(error instanceof ExitPromptError)) throw error;
			console.log(chalk.gray("\n  Cancelled."));
			process.exit(0);
		}
	});
