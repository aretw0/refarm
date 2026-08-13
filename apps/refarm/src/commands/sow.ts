import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	printJson,
} from "@refarm.dev/capabilities/envelope";
import { hasUsableModelCredential } from "@refarm.dev/config";
import {
	OperatorPromptCancelledError,
	createStdioOperatorChannel,
} from "@refarm.dev/prompt-contract-v1";
import { SiloCore } from "@refarm.dev/silo";
import chalk from "chalk";
import { Command } from "commander";
import { refarmCommand } from "../brand.js";
import {
	REPLACE_ACCOUNT_FLAG,
	compareStoredAccount,
	describeAccountVerdict,
} from "../credentials/credential-account.js";
import {
	cloudflareCredentialProvider,
	githubCredentialProvider,
	modelCredentialProvider,
} from "../credentials/index.js";
import {
	formatSelectionRefusal,
	resolveModelProviderSelection,
} from "../credentials/model-provider-selection.js";
import { OAUTH_PROVIDER_TO_MODEL_PROVIDER, modelProviderInventories } from "../credentials/model.js";
import { modelRouteTokenUpdate, parseModelRef } from "../model-routing.js";
import { tryOpenUrl } from "../utils/open-url.js";
import { emitCommandRefusal } from "./command-refusal.js";
import {
	LOCAL_MODEL_JSON_COMMAND,
	MODEL_CURRENT_JSON_COMMAND,
	MODEL_PROVIDERS_JSON_COMMAND,
	OPERATOR_LINKS_CONFIG_COMMAND,
	SOW_INTERACTIVE_COMMAND,
} from "./credential-handoffs.js";
import { credentialLifetime, type ModelTokens } from "./model.js";
import {
	SOW_COMMAND_DESCRIPTION,
	SOW_HELP_TEXT,
	SOW_MODEL_OPTION_DESCRIPTION,
} from "./sow-metadata.js";

const CHECK_NEXT_ACTION_JSON_COMMAND = refarmCommand(["check", "--next-action", "--json"]);

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Does the operator have a model credential the wizard should leave alone?
 *
 * PRESENCE IS NOT VALIDITY, and reading the first as the second is what made the wizard useless
 * on the day it was most needed. Measured on this node 2026-08-12: the `openai-codex` OAuth token
 * had expired FIVE DAYS earlier, `hasUsableModelCredential` returned true because a credential was
 * *there*, and `refarm sow` answered "Model: already configured — skipped". The one command an
 * operator reaches for to fix their login declined to do anything, and said so in a reassuring
 * tone.
 *
 * `credentialLifetime` is the doctor's own function, imported rather than re-derived, so the
 * wizard and `model doctor` cannot disagree about whether a credential is alive.
 *
 * The three states are kept apart on purpose:
 *  - `valid`   → configured; do not re-prompt.
 *  - `expired` → NOT configured; this is the case that used to be silently skipped.
 *  - `unknown` → an API-key provider carries no expiry at all, and treating "no expiry recorded"
 *                as expired would re-prompt every single run for every keyed provider. Absence of
 *                a measurement is not a measurement of failure.
 */
function hasModelCredential(
	tokens: Record<string, unknown>,
	env: NodeJS.ProcessEnv,
	now: number = Date.now(),
): boolean {
	const provider = stringValue(tokens.modelProvider);
	if (!provider) return false;
	if (!hasUsableModelCredential(provider, tokens, env)) return false;
	return credentialLifetime(provider, tokens as ModelTokens, now).state !== "expired";
}

function isPromptCancelledError(error: unknown): boolean {
	return (
		error instanceof OperatorPromptCancelledError ||
		(error instanceof Error && error.name === "ExitPromptError")
	);
}

interface SowOptions {
	model?: string;
	/**
	 * A MODEL provider id, not a credential provider id.
	 *
	 * Named `modelProvider` rather than `provider` because `sow` already selects among CREDENTIAL
	 * providers (`--github`, `--cloudflare`, model by default) and a future one — Telegram, an ERP,
	 * a corporate SSO — will want the bare word. See `model-provider-selection.ts`.
	 */
	modelProvider?: string;
	github?: boolean;
	cloudflare?: boolean;
	all?: boolean;
	reconfigure?: boolean;
	/**
	 * Deliberately replace a stored credential belonging to a DIFFERENT account.
	 *
	 * There is one slot per provider (ISS-122), so this is destructive by construction and stays a
	 * flag rather than a prompt: the operator with a personal and a corporate Copilot account needs
	 * the replacement to be something he typed, not something he agreed to at the end of a login.
	 */
	replaceAccount?: boolean;
	json?: boolean;
}

interface SowSilo {
	storagePath?: string;
	loadTokens(): Promise<unknown>;
	saveTokens(tokens: Record<string, unknown>): Promise<unknown>;
}

export interface SowDeps {
	createSilo(): SowSilo;
	createOperator(): ReturnType<typeof createStdioOperatorChannel>;
	env(): NodeJS.ProcessEnv;
	tryOpenUrl: typeof tryOpenUrl;
	providers: {
		model: typeof modelCredentialProvider;
		github: typeof githubCredentialProvider;
		cloudflare: typeof cloudflareCredentialProvider;
	};
}

function defaultSowDeps(): SowDeps {
	return {
		createSilo: () => new SiloCore(),
		createOperator: createStdioOperatorChannel,
		env: () => process.env,
		tryOpenUrl,
		providers: {
			model: modelCredentialProvider,
			github: githubCredentialProvider,
			cloudflare: cloudflareCredentialProvider,
		},
	};
}

function credentialSummary(tokens: Record<string, unknown>, env: NodeJS.ProcessEnv) {
	return {
		model: hasModelCredential(tokens, env),
		github: Boolean(stringValue(tokens.githubToken)),
		cloudflare: Boolean(stringValue(tokens.cloudflareToken)),
	};
}

export function createSowCommand(deps: SowDeps = defaultSowDeps()): Command {
	return new Command("sow")
		.description(SOW_COMMAND_DESCRIPTION)
		.option("--model <ref>", SOW_MODEL_OPTION_DESCRIPTION)
		.option("--github", "Configure GitHub credentials")
		.option("--cloudflare", "Configure Cloudflare credentials")
		.option("--all", "Configure or reconfigure all credentials")
		.option(
			"--model-provider <id>",
			"Configure this model provider directly, skipping the picker (e.g. openai-codex)",
		)
		.option("--reconfigure", "Reconfigure model credentials even if already configured")
		.option(
			"--replace-account",
			"Replace a stored credential that belongs to a DIFFERENT account — destructive, one slot per provider",
		)
		.option("--json", "Output machine-readable sow result")
		.addHelpText("after", SOW_HELP_TEXT)
		.action(async (opts: SowOptions) => {
			try {
				const silo = deps.createSilo();
				const stored = (await silo.loadTokens()) as Record<string, unknown>;
				let currentTokens = { ...stored };
				const env = deps.env();
				const ctx = {
					tryOpenUrl: deps.tryOpenUrl,
					operator: deps.createOperator(),
				};
				// VALIDATED BEFORE ANYTHING IS TOUCHED, and rendered through the same envelope as the
				// other option errors. `collectModel` also refuses a bad value, but by then the wizard
				// has printed a banner and the refusal would arrive as an unhandled stack trace — an
				// operator who mistyped a provider deserves the list of valid ones, not a backtrace.
				if (opts.modelProvider !== undefined) {
					const refusal = formatSelectionRefusal(
						resolveModelProviderSelection(opts.modelProvider, modelProviderInventories()),
					);
					if (refusal) {
						if (opts.json) {
							printJson(
								buildJsonErrorEnvelope({
									command: "sow",
									operation: "credentials",
									error: "unusable-model-provider",
									message: refusal,
									nextAction: MODEL_PROVIDERS_JSON_COMMAND,
									nextCommand: MODEL_PROVIDERS_JSON_COMMAND,
									extra: { action: "sow" },
								}),
							);
							process.exitCode = 1;
							return;
						}
						console.error(chalk.red(`✗  ${refusal}`));
						process.exitCode = 1;
						return;
					}
				}
				const initialModelRef = parseModelRef(opts.model, stringValue(stored.modelProvider));
				let modelRef = initialModelRef;
				if (opts.model !== undefined && !initialModelRef) {
					if (opts.json) {
						printJson(
							buildJsonErrorEnvelope({
								command: "sow",
								operation: "credentials",
								error: "empty-model",
								message: "--model cannot be empty.",
								nextAction: SOW_INTERACTIVE_COMMAND,
								nextCommand: SOW_INTERACTIVE_COMMAND,
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
								command: "sow",
								operation: "credentials",
								error: "model-provider-required",
								message: `Could not infer provider for model "${initialModelRef.modelId}".`,
								nextAction: SOW_INTERACTIVE_COMMAND,
								nextCommand: SOW_INTERACTIVE_COMMAND,
								extra: {
									action: "sow",
									modelId: initialModelRef.modelId,
								},
							}),
						);
						process.exitCode = 1;
						return;
					}
					console.error(
						chalk.red(`✗  Could not infer provider for model "${initialModelRef.modelId}".`),
					);
					console.error(
						chalk.dim("   Run refarm sow to choose a provider, or pass provider/model explicitly."),
					);
					process.exitCode = 1;
					return;
				}

				const needsModel = !hasModelCredential(stored, env);
				// Named separately from `needsModel` because the two arrive at the same decision from
				// opposite facts, and the operator deserves to know which one they are looking at: a
				// node that never had a credential, or one whose credential quietly died.
				const modelCredentialExpired =
					credentialLifetime(stringValue(stored.modelProvider), stored as ModelTokens, Date.now())
						.state === "expired";
				const configureModelRef = modelRef !== null;
				// NAMING A PROVIDER IS ASKING FOR IT. Without this, `sow --model-provider openai-codex`
				// on a node that already has a credential would print "already configured — skipped"
				// and ignore the operator's explicit instruction, which is the same defect as the
				// expired-credential skip one commit earlier: an instruction read as a question.
				const configureModel =
					Boolean(opts.reconfigure) ||
					Boolean(opts.modelProvider) ||
					(needsModel && !configureModelRef) ||
					Boolean(opts.all);
				const configureGithub = Boolean(opts.github) || Boolean(opts.all);
				const configureCloudflare = Boolean(opts.cloudflare) || Boolean(opts.all);

				if (!configureModel && !configureModelRef && !configureGithub && !configureCloudflare) {
					if (opts.json) {
						printJson(
							buildJsonSuccessEnvelope({
								command: "sow",
								operation: "credentials",
								nextAction: CHECK_NEXT_ACTION_JSON_COMMAND,
								nextCommand: CHECK_NEXT_ACTION_JSON_COMMAND,
								nextCommands: [CHECK_NEXT_ACTION_JSON_COMMAND, MODEL_CURRENT_JSON_COMMAND],
								extra: {
									action: "sow",
									status: "configured",
									credentials: credentialSummary(currentTokens, env),
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
						? refarmCommand(["sow"])
						: refarmCommand(["sow", `--${interactivePrompts[0]}`]);
					const nextCommands = configureModel
						? [
								SOW_INTERACTIVE_COMMAND,
								LOCAL_MODEL_JSON_COMMAND,
								MODEL_PROVIDERS_JSON_COMMAND,
								MODEL_CURRENT_JSON_COMMAND,
								OPERATOR_LINKS_CONFIG_COMMAND,
							]
						: [OPERATOR_LINKS_CONFIG_COMMAND, MODEL_CURRENT_JSON_COMMAND];
					printJson(
						buildJsonErrorEnvelope({
							command: "sow",
							operation: "credentials",
							error: "interactive-required",
							message: "Credential collection requires an interactive terminal or browser handoff.",
							nextAction,
							nextActions: [nextAction, MODEL_CURRENT_JSON_COMMAND, OPERATOR_LINKS_CONFIG_COMMAND],
							nextCommand: nextCommands[0],
							nextCommands,
							extra: {
								action: "sow",
								status: "interactive-required",
								prompts: interactivePrompts,
								handoffs: {
									interactive: nextAction,
									inspectCurrent: MODEL_CURRENT_JSON_COMMAND,
									inspectProviders: MODEL_PROVIDERS_JSON_COMMAND,
									openExternalLinks: OPERATOR_LINKS_CONFIG_COMMAND,
									...(configureModel ? { localNoKeyModel: LOCAL_MODEL_JSON_COMMAND } : {}),
								},
							},
						}),
					);
					process.exitCode = 1;
					return;
				}

				if (configureModel) {
					// NOT SILENT, because the write is irreversible. `tokens.oauthCredentials` holds ONE
					// slot per provider, so authenticating replaces whatever is there with no copy kept
					// (ISS-122, measured). For an EXPIRED credential that costs nothing — it authenticates
					// nothing already. For a LIVE one it destroys a working credential, and the operator
					// with two accounts on one provider (Copilot personal and corporate) has no way to
					// learn that from the wizard's own output.
					if (
						!modelCredentialExpired &&
						credentialLifetime(stringValue(stored.modelProvider), stored as ModelTokens, Date.now())
							.state === "valid"
					) {
						console.log(
							chalk.yellow(
								`  Model: this replaces the LIVE ${stringValue(stored.modelProvider)} credential — one slot per provider, and the current one cannot be recovered afterwards`,
							),
						);
					}
					if (modelCredentialExpired) {
						console.log(
							chalk.yellow(
								`  Model: the stored ${stringValue(stored.modelProvider)} credential has EXPIRED — logging in again`,
							),
						);
					} else if (!needsModel) {
						console.log(
							chalk.dim(`  Model: reconfiguring (was: ${stringValue(stored.modelProvider)})`),
						);
					}
					const credential = await deps.providers.model.collectModel(ctx, {
						...(opts.modelProvider ? { modelProvider: opts.modelProvider } : {}),
					});

					if (credential.oauthCredentials) {
						const modelProvider =
							OAUTH_PROVIDER_TO_MODEL_PROVIDER[credential.provider] ?? credential.provider;
						const existingTokens = (await silo.loadTokens()) as Record<string, unknown>;
						// ISS-122's IRREVERSIBLE HALF, closed here without deciding the shape. One slot
						// per provider means writing a SECOND account's credential destroys the first,
						// and the operator has three quotas across two providers — two of them the same
						// provider. The comparison happens after the login (the account is only known
						// from the token) but BEFORE the write, so a refusal costs a browser round trip
						// and keeps a working credential.
						const slot = (existingTokens.oauthCredentials as Record<string, unknown> | undefined)?.[
							credential.provider
						];
						const verdict = compareStoredAccount(slot, credential.oauthCredentials);
						const notice = describeAccountVerdict(verdict, credential.provider);
						if (verdict.kind === "different-account" && !opts.replaceAccount) {
							emitCommandRefusal({
								command: "sow",
								operation: "credentials",
								options: opts,
								error: "sow-would-replace-a-different-account",
								message: notice ?? "this login would replace a different account",
								nextAction: `Re-run with ${REPLACE_ACCOUNT_FLAG} to replace it deliberately.`,
								nextCommands: [
									`refarm sow --model-provider ${opts.modelProvider ?? modelProvider} ${REPLACE_ACCOUNT_FLAG}`,
								],
							});
							return;
						}
						// `unknown` warns and proceeds: nothing PROVED a loss, and refusing would block
						// re-authenticating any credential stored before accounts were recorded.
						if (notice) console.log(chalk.yellow(`  ${notice}`));
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
				} else if (!configureModelRef && !configureGithub && !configureCloudflare) {
					console.log(
						chalk.dim(
							`  Model: already configured (${stringValue(stored.modelProvider)}) — skipped`,
						),
					);
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
						console.log(
							chalk.green(`  ✓ Default model set: ${modelRef.provider}/${modelRef.modelId}`),
						);
					}
				}

				if (configureGithub) {
					const owner = await ctx.operator.ask({
						type: "text",
						question: "Your GitHub username or org",
						default: stringValue(stored.githubOwner) ?? "refarm-dev",
					});
					const githubToken = await deps.providers.github.collect(ctx);
					await silo.saveTokens({ githubToken, githubOwner: owner });
					currentTokens = { ...currentTokens, githubToken, githubOwner: owner };
				}

				if (configureCloudflare) {
					const cloudflareToken = await deps.providers.cloudflare.collect(ctx);
					await silo.saveTokens({ cloudflareToken });
					currentTokens = { ...currentTokens, cloudflareToken };
				}

				if (opts.json) {
					printJson(
						buildJsonSuccessEnvelope({
							command: "sow",
							operation: "credentials",
							nextAction: MODEL_CURRENT_JSON_COMMAND,
							nextActions: [MODEL_CURRENT_JSON_COMMAND, CHECK_NEXT_ACTION_JSON_COMMAND],
							nextCommand: CHECK_NEXT_ACTION_JSON_COMMAND,
							nextCommands: [
								CHECK_NEXT_ACTION_JSON_COMMAND,
								MODEL_CURRENT_JSON_COMMAND,
								MODEL_PROVIDERS_JSON_COMMAND,
							],
							extra: {
								action: "sow",
								status: configureModelRef ? "updated" : "configured",
								credentials: credentialSummary(currentTokens, env),
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

				const storagePath = stringValue(silo.storagePath) ?? "Refarm Silo identity storage";
				console.log(chalk.gray(`\n  Credentials stored at ${storagePath}`));
				console.log(chalk.dim("  Refarm runtime reloads saved Silo credentials before each task."));

				const infraTip: string[] = [];
				if (!configureGithub && !stored.githubToken) infraTip.push("--github");
				if (!configureCloudflare && !stored.cloudflareToken) infraTip.push("--cloudflare");
				if (infraTip.length > 0) {
					console.log(
						chalk.dim(`  Infrastructure credentials available: refarm sow ${infraTip.join(" ")}`),
					);
				}
			} catch (error) {
				if (!isPromptCancelledError(error)) throw error;
				console.log(chalk.gray("\n  Cancelled."));
				process.exitCode = 130;
			}
		});
}

export const sowCommand = createSowCommand();
