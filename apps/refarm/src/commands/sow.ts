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
	defaultProviderModelId,
	defaultProviderModelRef,
	parseModelRef,
} from "../model-routing.js";

const OPENAI_DEFAULT_REF = defaultProviderModelRef("openai");
const OPENAI_DEFAULT_MODEL_ID = defaultProviderModelId("openai");
const ANTHROPIC_DEFAULT_REF = defaultProviderModelRef("anthropic");
const OLLAMA_DEFAULT_REF = defaultProviderModelRef("ollama");

interface SowOptions {
	model?: string;
	github?: boolean;
	cloudflare?: boolean;
	all?: boolean;
}

export const sowCommand = new Command("sow")
	.description("Configure refarm credentials (default: model provider only)")
	.option("--model <ref>", "Set the default model as provider/model, or model for the current provider")
	.option("--github", "Configure GitHub credentials")
	.option("--cloudflare", "Configure Cloudflare credentials")
	.option("--all", "Configure or reconfigure all credentials")
	.addHelpText(
		"after",
		`

Examples:
  $ refarm sow
  $ refarm sow --cloudflare
  $ refarm sow --model ${OPENAI_DEFAULT_REF}
  $ refarm sow --model ${ANTHROPIC_DEFAULT_REF}
  $ refarm sow --model ${OLLAMA_DEFAULT_REF}
  $ refarm sow --model ${OPENAI_DEFAULT_MODEL_ID}

Notes:
  --model changes the saved provider/model routing. It does not collect a new
  API key or OAuth login; run plain refarm sow to configure credentials.
  A slash means provider/model, so custom or self-hosted providers can be saved
  directly, e.g. refarm sow --model vllm/Qwen3-Coder-480B-A35B-Instruct.
  Inside the refarm REPL, use /login or /sow to reconfigure without leaving the
  session. The Refarm runtime reloads Silo credentials before each task.
`,
	)
	.action(async (opts: SowOptions) => {
		try {
			const silo = new SiloCore();
			const stored = (await silo.loadTokens()) as Record<string, string | undefined>;
			const ctx = { tryOpenUrl };
			const modelRef = parseModelRef(opts.model, stored.modelProvider);
			if (opts.model !== undefined && !modelRef) {
				console.error(chalk.red("✗  --model cannot be empty."));
				process.exit(1);
			}
			if (modelRef && !modelRef.provider) {
				console.error(chalk.red(`✗  Could not infer provider for model "${modelRef.modelId}".`));
				console.error(chalk.dim(`   Use provider/model, for example: refarm sow --model ${OLLAMA_DEFAULT_REF}`));
				process.exit(1);
			}

			const needsModel = !stored.modelProvider;
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
			} else if (!configureModelRef) {
				console.log(chalk.dim(`  Model: already configured (${stored.modelProvider}) — skipped`));
			}

			if (configureModelRef) {
				await silo.saveTokens({
					modelProvider: modelRef.provider,
					modelId: modelRef.modelId,
				});
				console.log(chalk.green(`  ✓ Default model set: ${modelRef.provider}/${modelRef.modelId}`));
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
