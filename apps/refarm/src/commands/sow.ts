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
import {
	defaultProviderModelRef,
	modelRouteTokenUpdate,
	parseModelRef,
} from "../model-routing.js";
import { hasUsableModelCredential } from "@refarm.dev/config";
import {
	SOW_COMMAND_DESCRIPTION,
	SOW_HELP_TEXT,
	SOW_MODEL_OPTION_DESCRIPTION,
} from "./sow-metadata.js";

const OLLAMA_DEFAULT_REF = defaultProviderModelRef("ollama");

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function hasModelCredential(tokens: Record<string, unknown>): boolean {
	const provider = stringValue(tokens.modelProvider);
	if (!provider) return false;
	return hasUsableModelCredential(provider, tokens, process.env);
}

interface SowOptions {
	model?: string;
	github?: boolean;
	cloudflare?: boolean;
	all?: boolean;
}

export const sowCommand = new Command("sow")
	.description(SOW_COMMAND_DESCRIPTION)
	.option("--model <ref>", SOW_MODEL_OPTION_DESCRIPTION)
	.option("--github", "Configure GitHub credentials")
	.option("--cloudflare", "Configure Cloudflare credentials")
	.option("--all", "Configure or reconfigure all credentials")
	.addHelpText("after", SOW_HELP_TEXT)
	.action(async (opts: SowOptions) => {
		try {
			const silo = new SiloCore();
			const stored = (await silo.loadTokens()) as Record<string, unknown>;
			let currentTokens = { ...stored };
			const ctx = { tryOpenUrl };
			const modelRef = parseModelRef(opts.model, stringValue(stored.modelProvider));
			if (opts.model !== undefined && !modelRef) {
				console.error(chalk.red("✗  --model cannot be empty."));
				process.exit(1);
			}
			if (modelRef && !modelRef.provider) {
				console.error(chalk.red(`✗  Could not infer provider for model "${modelRef.modelId}".`));
				console.error(chalk.dim(`   Use provider/model, for example: refarm sow --model ${OLLAMA_DEFAULT_REF}`));
				process.exit(1);
			}

			const needsModel = !hasModelCredential(stored);
			const configureModelRef = modelRef !== null;
			const configureModel = (needsModel && !configureModelRef) || Boolean(opts.all);
			const configureGithub = Boolean(opts.github) || Boolean(opts.all);
			const configureCloudflare = Boolean(opts.cloudflare) || Boolean(opts.all);

			if (!configureModel && !configureModelRef && !configureGithub && !configureCloudflare) {
				console.log(chalk.green("✓  All credentials already configured.\n"));
				console.log(
					chalk.dim("   Use --model, --github, --cloudflare, or --all to reconfigure."),
				);
				return;
			}

			if (configureModel) {
				if (!needsModel) {
					console.log(chalk.dim(`  Model: reconfiguring (was: ${stringValue(stored.modelProvider)})`));
				}
				const credential = await modelCredentialProvider.collectModel(ctx);

				if (credential.oauthCredentials) {
					const modelProvider = OAUTH_PROVIDER_TO_MODEL_PROVIDER[credential.provider] ?? credential.provider;
					const existingTokens = (await silo.loadTokens()) as Record<string, unknown>;
					const tokenUpdate = {
						modelProvider,
						oauthProvider: credential.provider,
						oauthCredentials: {
							...(existingTokens.oauthCredentials ?? {}),
							[credential.provider]: credential.oauthCredentials,
						},
					};
					await silo.saveTokens(tokenUpdate);
					currentTokens = { ...currentTokens, ...tokenUpdate };
				} else {
					const tokenUpdate = {
						modelProvider: credential.provider,
						...(credential.apiKey ? { modelApiKey: credential.apiKey } : {}),
						oauthProvider: undefined,
					};
					await silo.saveTokens(tokenUpdate);
					currentTokens = { ...currentTokens, ...tokenUpdate };
				}
			} else if (!configureModelRef) {
				console.log(chalk.dim(`  Model: already configured (${stringValue(stored.modelProvider)}) — skipped`));
			}

			if (configureModelRef) {
				if (!modelRef.provider) throw new Error("model provider was not resolved");
				await silo.saveTokens(
					modelRouteTokenUpdate(
						"default",
						{ provider: modelRef.provider, modelId: modelRef.modelId },
						currentTokens,
					),
				);
				console.log(chalk.green(`  ✓ Default model set: ${modelRef.provider}/${modelRef.modelId}`));
			}

			if (configureGithub) {
				const { owner } = await inquirer.prompt([
					{
						type: "input",
						name: "owner",
						message: "Your GitHub username or org:",
						default: stringValue(stored.githubOwner) ?? "refarm-dev",
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
			console.log(
				chalk.dim(
					"  Refarm runtime reloads saved Silo credentials before each task.",
				),
			);

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
