import { Command } from "commander";
import chalk from "chalk";
import inquirer from "inquirer";
import { ExitPromptError } from "@inquirer/core";
import { SiloCore } from "@refarm.dev/silo";
import { tryOpenUrl } from "../utils/open-url.js";
import {
	githubCredentialProvider,
	cloudflareCredentialProvider,
	llmCredentialProvider,
} from "../credentials/index.js";

interface SowOptions {
	llm?: boolean;
	github?: boolean;
	cloudflare?: boolean;
	all?: boolean;
}

export const sowCommand = new Command("sow")
	.description("Configure refarm credentials (default: LLM provider only)")
	.option("--llm", "Reconfigure the LLM provider")
	.option("--github", "Configure GitHub credentials")
	.option("--cloudflare", "Configure Cloudflare credentials")
	.option("--all", "Configure or reconfigure all credentials")
	.action(async (opts: SowOptions) => {
		try {
			const silo = new SiloCore();
			const stored = (await silo.loadTokens()) as Record<string, string | undefined>;
			const ctx = { tryOpenUrl };

			const needsLlm = !stored.llmProvider;
			const configureLlm = needsLlm || Boolean(opts.llm) || Boolean(opts.all);
			const configureGithub = Boolean(opts.github) || Boolean(opts.all);
			const configureCloudflare = Boolean(opts.cloudflare) || Boolean(opts.all);

			if (!configureLlm && !configureGithub && !configureCloudflare) {
				console.log(chalk.green("✓  All credentials already configured.\n"));
				console.log(
					chalk.dim("   Use --llm, --github, --cloudflare, or --all to reconfigure."),
				);
				return;
			}

			if (configureLlm) {
				if (!needsLlm) {
					console.log(chalk.dim(`  LLM: reconfiguring (was: ${stored.llmProvider})`));
				}
				const llm = await llmCredentialProvider.collectLlm(ctx);
				await silo.saveTokens({
					llmProvider: llm.provider,
					...(llm.apiKey ? { llmApiKey: llm.apiKey } : {}),
				});
			} else {
				console.log(chalk.dim(`  LLM: already configured (${stored.llmProvider}) — skipped`));
			}

			if (configureGithub) {
				const { owner } = await inquirer.prompt([
					{
						type: "input",
						name: "owner",
						message: "Your GitHub username or org:",
						default: stored.githubOwner ?? "refarm-dev",
					},
				]);
				const githubToken = await githubCredentialProvider.collect(ctx);
				await silo.saveTokens({ githubToken, githubOwner: owner });
			}

			if (configureCloudflare) {
				const cloudflareToken = await cloudflareCredentialProvider.collect(ctx);
				await silo.saveTokens({ cloudflareToken });
			}

			console.log(chalk.gray("\n  Credentials stored at ~/.refarm/identity.json"));

			const infraTip: string[] = [];
			if (!configureGithub && !stored.githubToken) infraTip.push("--github");
			if (!configureCloudflare && !stored.cloudflareToken) infraTip.push("--cloudflare");
			if (infraTip.length > 0) {
				console.log(
					chalk.dim(
						`  Infrastructure credentials available: refarm sow ${infraTip.join(" ")}`,
					),
				);
			}
		} catch (error) {
			if (!(error instanceof ExitPromptError)) throw error;
			console.log(chalk.gray("\n  Cancelled."));
			process.exit(0);
		}
	});
