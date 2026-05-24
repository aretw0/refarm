import { ExitPromptError } from "@inquirer/core";
import { hasUsableModelCredential } from "@refarm.dev/config";
import { SiloCore } from "@refarm.dev/silo";
import chalk from "chalk";
import { Command } from "commander";
import inquirer from "inquirer";
import {
	cloudflareCredentialProvider,
	githubCredentialProvider,
	modelCredentialProvider,
} from "../credentials/index.js";
import { OAUTH_PROVIDER_TO_MODEL_PROVIDER } from "../credentials/model.js";
import {
	defaultProviderModelRef,
	modelRouteTokenUpdate,
	parseModelRef,
} from "../model-routing.js";
import { tryOpenUrl } from "../utils/open-url.js";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	printJson,
} from "./json-output.js";
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
	json?: boolean;
}

function credentialSummary(tokens: Record<string, unknown>) {
	return {
		model: hasModelCredential(tokens),
		github: Boolean(stringValue(tokens.githubToken)),
		cloudflare: Boolean(stringValue(tokens.cloudflareToken)),
	};
}

export const sowCommand = new Command("sow")
	.description(SOW_COMMAND_DESCRIPTION)
	.option("--model <ref>", SOW_MODEL_OPTION_DESCRIPTION)
	.option("--github", "Configure GitHub credentials")
	.option("--cloudflare", "Configure Cloudflare credentials")
	.option("--all", "Configure or reconfigure all credentials")
	.option("--json", "Output machine-readable sow result")
	.addHelpText("after", SOW_HELP_TEXT)
	.action(async (opts: SowOptions) => {
		try {
			const silo = new SiloCore();
			const stored = (await silo.loadTokens()) as Record<string, unknown>;
			let currentTokens = { ...stored };
			const ctx = { tryOpenUrl };
			const initialModelRef = parseModelRef(opts.model, stringValue(stored.modelProvider));
			let modelRef = initialModelRef;
			if (opts.model !== undefined && !initialModelRef) {
				if (opts.json) {
					printJson(
						buildJsonErrorEnvelope({
							error: "empty-model",
							message: "--model cannot be empty.",
							nextAction: `refarm sow --model ${OLLAMA_DEFAULT_REF}`,
							extra: { action: "sow" },
						}),
					);
					process.exitCode = 1;
					return;
				}
				console.error(chalk.red("✗  --model cannot be empty."));
				process.exitCode = 1;
				return;
			}
			if (initialModelRef && !initialModelRef.provider && !opts.all) {
				if (opts.json) {
					printJson(
						buildJsonErrorEnvelope({
							error: "model-provider-required",
							message: `Could not infer provider for model "${initialModelRef.modelId}".`,
							nextAction: `refarm sow --model ${OLLAMA_DEFAULT_REF}`,
							extra: {
								action: "sow",
								modelId: initialModelRef.modelId,
							},
						}),
					);
					process.exitCode = 1;
					return;
				}
				console.error(chalk.red(`✗  Could not infer provider for model "${initialModelRef.modelId}".`));
				console.error(chalk.dim(`   Use provider/model, for example: refarm sow --model ${OLLAMA_DEFAULT_REF}`));
				process.exitCode = 1;
				return;
			}

			const needsModel = !hasModelCredential(stored);
			const configureModelRef = modelRef !== null;
			const configureModel = (needsModel && !configureModelRef) || Boolean(opts.all);
			const configureGithub = Boolean(opts.github) || Boolean(opts.all);
			const configureCloudflare = Boolean(opts.cloudflare) || Boolean(opts.all);

			if (!configureModel && !configureModelRef && !configureGithub && !configureCloudflare) {
				if (opts.json) {
					printJson(
						buildJsonSuccessEnvelope({
							command: "sow",
							operation: "credentials",
							extra: {
								action: "sow",
								status: "configured",
								credentials: credentialSummary(currentTokens),
							},
						}),
					);
					return;
				}
				console.log(chalk.green("✓  All credentials already configured.\n"));
				console.log(
					chalk.dim("   Use --model, --github, --cloudflare, or --all to reconfigure."),
				);
				return;
			}

			const interactivePrompts = [
				...(configureModel ? ["model"] : []),
				...(configureGithub ? ["github"] : []),
				...(configureCloudflare ? ["cloudflare"] : []),
			];
			if (opts.json && interactivePrompts.length > 0) {
				const nextAction = configureModel
					? "refarm sow"
					: `refarm sow --${interactivePrompts[0]}`;
				printJson(
					buildJsonErrorEnvelope({
						error: "interactive-required",
						message: "Credential collection requires an interactive terminal or browser handoff.",
						nextAction,
						nextActions: [
							nextAction,
							"refarm model current --json",
							"refarm config get operator.openExternalLinks --json",
						],
						extra: {
							action: "sow",
							status: "interactive-required",
							prompts: interactivePrompts,
						},
					}),
				);
				process.exitCode = 1;
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
				modelRef = parseModelRef(opts.model, stringValue(currentTokens.modelProvider));
				if (!modelRef) throw new Error("model ref was not resolved");
				if (!modelRef.provider) throw new Error("model provider was not resolved");
				const tokenUpdate = modelRouteTokenUpdate(
					"default",
					{ provider: modelRef.provider, modelId: modelRef.modelId },
					currentTokens,
				);
				await silo.saveTokens(tokenUpdate);
				currentTokens = { ...currentTokens, ...tokenUpdate };
				if (!opts.json) {
					console.log(chalk.green(`  ✓ Default model set: ${modelRef.provider}/${modelRef.modelId}`));
				}
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
				currentTokens = { ...currentTokens, githubToken, githubOwner: owner };
			}

			if (configureCloudflare) {
				const cloudflareToken = await cloudflareCredentialProvider.collect(ctx);
				await silo.saveTokens({ cloudflareToken });
				currentTokens = { ...currentTokens, cloudflareToken };
			}

			if (opts.json) {
				printJson(
					buildJsonSuccessEnvelope({
						command: "sow",
						operation: "credentials",
						nextAction: "refarm model current --json",
						nextActions: [
							"refarm model current --json",
							"refarm check --next-action --json",
						],
						extra: {
							action: "sow",
							status: configureModelRef ? "updated" : "configured",
							credentials: credentialSummary(currentTokens),
							modelRoute: modelRef?.provider
								? {
										scope: "default",
										provider: modelRef.provider,
										modelId: modelRef.modelId,
									}
								: undefined,
						},
					}),
				);
				return;
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
		}
	});
