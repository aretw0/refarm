import { Command } from "commander";
import chalk from "chalk";
import inquirer from "inquirer";
import { ExitPromptError } from "@inquirer/core";
import { SiloCore } from "@refarm.dev/silo";
import { tryOpenUrl } from "../utils/open-url.js";
import {
	githubCredentialProvider,
	cloudflareCredentialProvider,
	modelCredentialProvider,
} from "../credentials/index.js";
import { OAUTH_PROVIDER_TO_MODEL_PROVIDER } from "../credentials/model.js";

interface SowOptions {
	model?: boolean;
	github?: boolean;
	cloudflare?: boolean;
	all?: boolean;
}

export const sowCommand = new Command("sow")
	.description("Configure refarm credentials (default: model provider only)")
	.option("--model", "Reconfigure the model provider")
	.option("--github", "Configure GitHub credentials")
	.option("--cloudflare", "Configure Cloudflare credentials")
	.option("--all", "Configure or reconfigure all credentials")
	.action(async (opts: SowOptions) => {
		try {
			const silo = new SiloCore();
			const stored = (await silo.loadTokens()) as Record<string, string | undefined>;
			const ctx = { tryOpenUrl };

			const needsModel = !stored.modelProvider;
			const configureModel = needsModel || Boolean(opts.model) || Boolean(opts.all);
			const configureGithub = Boolean(opts.github) || Boolean(opts.all);
			const configureCloudflare = Boolean(opts.cloudflare) || Boolean(opts.all);

			if (!configureModel && !configureGithub && !configureCloudflare) {
				console.log(chalk.green("✓  All credentials already configured.\n"));
				console.log(
					chalk.dim("   Use --model, --github, --cloudflare, or --all to reconfigure."),
				);
				return;
			}

			if (configureModel) {
				if (!needsModel) {
					console.log(chalk.dim(`  Model: reconfiguring (was: ${stored.modelProvider})`));
				}
				const credential = await modelCredentialProvider.collectModel(ctx);

				if (credential.oauthCredentials) {
					const modelProvider = OAUTH_PROVIDER_TO_MODEL_PROVIDER[credential.provider] ?? credential.provider;
					const existingTokens = (await silo.loadTokens()) as Record<string, unknown>;
					await silo.saveTokens({
						modelProvider,
						oauthProvider: credential.provider,
						oauthCredentials: {
							...(existingTokens.oauthCredentials ?? {}),
							[credential.provider]: credential.oauthCredentials,
						},
					});
				} else {
					await silo.saveTokens({
						modelProvider: credential.provider,
						...(credential.apiKey ? { modelApiKey: credential.apiKey } : {}),
						oauthProvider: undefined,
					});
				}
			} else {
				console.log(chalk.dim(`  Model: already configured (${stored.modelProvider}) — skipped`));
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
