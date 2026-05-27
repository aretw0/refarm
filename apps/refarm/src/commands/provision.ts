import { setGitHubActionsSecret } from "@refarm.dev/cli/github-actions";
import {
	CloudflareProvider,
	CloudflareTurboCacheProvisioner,
	createCloudflareTurboCacheProvisionPlan,
	enrichCloudflareError,
} from "@refarm.dev/infra-cloudflare";
import { turboCacheManifest } from "@refarm.dev/infra-turbo-cache";
import { SiloCore } from "@refarm.dev/silo";
import chalk from "chalk";
import { Command } from "commander";
import { normalizeHandoffValues } from "./command-handoff.js";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	printJson,
} from "./json-output.js";

interface TurboCacheCommandOptions {
	dryRun?: boolean;
	json?: boolean;
	team: string;
	bucket: string;
	githubSecrets?: boolean;
	printSecrets?: boolean;
}

interface CloudflareCommandOptions {
	dryRun?: boolean;
	json?: boolean;
}

interface ProvisionCommandOptions {
	json?: boolean;
}

const PROVISION_SCHEMA_VERSION = 1;
const DEFAULT_TURBO_CACHE_BUCKET = "refarm-turbo-cache";
const DEFAULT_TURBO_CACHE_TEAM = "refarm";
const SOW_CLOUDFLARE_JSON_COMMAND = "refarm sow --cloudflare --json";

function optionIsEnabled(command: Command, name: string): boolean {
	const opts = command.optsWithGlobals<Record<string, unknown>>();
	return opts[name] === true;
}

function provisionNextActions(): string[] {
	return [
		SOW_CLOUDFLARE_JSON_COMMAND,
		"refarm provision cloudflare turbo-cache --dry-run",
		"refarm provision cloudflare turbo-cache --github-secrets",
	];
}

function provisionNextCommands(): string[] {
	return [
		"refarm provision cloudflare turbo-cache --dry-run",
		"refarm provision cloudflare turbo-cache --github-secrets",
	];
}

function cloudflareTurboCachePlan(input: {
	bucket: string;
	team: string;
}): ReturnType<typeof createCloudflareTurboCacheProvisionPlan> {
	return createCloudflareTurboCacheProvisionPlan({
		bucketName: input.bucket,
		team: input.team,
	});
}

function buildProvisionCatalogPayload() {
	return {
		schemaVersion: PROVISION_SCHEMA_VERSION,
		command: "provision",
		operation: "catalog",
		providers: [
			{
				id: "cloudflare",
				services: [
					{
						id: turboCacheManifest.id,
						displayName: turboCacheManifest.displayName,
						description: turboCacheManifest.description,
					},
				],
			},
		],
		nextActions: provisionNextActions(),
		nextCommands: provisionNextCommands(),
	};
}

function buildCloudflareCatalogPayload(options: { dryRun?: boolean } = {}) {
	return {
		schemaVersion: PROVISION_SCHEMA_VERSION,
		command: "provision",
		provider: "cloudflare",
		operation: options.dryRun ? "dry-run" : "catalog",
		services: [
			{
				id: turboCacheManifest.id,
				displayName: turboCacheManifest.displayName,
				description: "Worker + R2 materialization",
			},
		],
		nextActions: provisionNextActions(),
		nextCommands: provisionNextCommands(),
		...(options.dryRun
			? {
					plan: cloudflareTurboCachePlan({
						bucket: DEFAULT_TURBO_CACHE_BUCKET,
						team: DEFAULT_TURBO_CACHE_TEAM,
					}),
				}
			: {}),
	};
}

function buildTurboCacheDryRunPayload(input: TurboCacheCommandOptions) {
	return {
		schemaVersion: PROVISION_SCHEMA_VERSION,
		command: "provision",
		provider: "cloudflare",
		service: turboCacheManifest.id,
		operation: "dry-run",
		dryRun: true,
		input: {
			bucket: input.bucket,
			team: input.team,
			githubSecrets: input.githubSecrets === true,
			printSecrets: input.printSecrets === true,
		},
		plan: cloudflareTurboCachePlan(input),
		nextActions: [
			SOW_CLOUDFLARE_JSON_COMMAND,
			"refarm provision cloudflare turbo-cache --github-secrets",
		],
		nextCommands: [
			"refarm provision cloudflare turbo-cache --github-secrets",
		],
	};
}

function buildTurboCacheMissingCredentialsPayload(input: TurboCacheCommandOptions) {
	return buildJsonErrorEnvelope({
		command: "provision",
		operation: "apply",
		error: "missing-cloudflare-token",
		message: "No Cloudflare token found.",
		nextAction: SOW_CLOUDFLARE_JSON_COMMAND,
		nextActions: [
			SOW_CLOUDFLARE_JSON_COMMAND,
			"refarm provision cloudflare turbo-cache --dry-run",
		],
		nextCommand: SOW_CLOUDFLARE_JSON_COMMAND,
		nextCommands: [
			SOW_CLOUDFLARE_JSON_COMMAND,
			"refarm provision cloudflare turbo-cache --dry-run",
		],
		extra: {
			schemaVersion: PROVISION_SCHEMA_VERSION,
			provider: "cloudflare",
			service: turboCacheManifest.id,
			input: {
				bucket: input.bucket,
				team: input.team,
			},
		},
	});
}

function buildTurboCacheFailurePayload(input: {
	options: TurboCacheCommandOptions;
	error: string;
	message: string;
	nextAction: string;
}) {
	const nextCommand = input.nextAction.startsWith("refarm sow")
		? SOW_CLOUDFLARE_JSON_COMMAND
		: input.nextAction;
	const nextAction = input.nextAction.startsWith("refarm sow")
		? SOW_CLOUDFLARE_JSON_COMMAND
		: input.nextAction;
	const nextCommands = normalizeHandoffValues([
		nextCommand,
		"refarm provision cloudflare turbo-cache --dry-run",
	]);
	return buildJsonErrorEnvelope({
		command: "provision",
		operation: "apply",
		error: input.error,
		message: input.message,
		nextAction,
		nextActions: [
			nextAction,
			"refarm provision cloudflare turbo-cache --dry-run",
		],
		nextCommand,
		nextCommands,
		extra: {
			schemaVersion: PROVISION_SCHEMA_VERSION,
			provider: "cloudflare",
			service: turboCacheManifest.id,
			input: {
				bucket: input.options.bucket,
				team: input.options.team,
				githubSecrets: input.options.githubSecrets === true,
			},
		},
	});
}

function buildTurboCacheApplyPayload(input: {
	options: TurboCacheCommandOptions;
	result: Awaited<ReturnType<CloudflareTurboCacheProvisioner["provision"]>>;
	githubSecretsWritten: boolean;
}) {
	const nextCommands = input.githubSecretsWritten
		? ["gh secret list"]
		: ["refarm provision cloudflare turbo-cache --github-secrets"];
	const nextActions = input.githubSecretsWritten
		? ["gh secret list", "push a commit and watch GitHub Actions"]
		: [
				"refarm provision cloudflare turbo-cache --github-secrets",
				"copy TURBO_CACHE_API_URL and TURBO_CACHE_TOKEN into GitHub Actions secrets",
			];
	return buildJsonSuccessEnvelope({
		command: "provision",
		operation: "apply",
		nextAction: nextActions[0],
		nextActions,
		nextCommand: nextCommands[0],
		nextCommands,
		extra: {
			schemaVersion: PROVISION_SCHEMA_VERSION,
			provider: "cloudflare",
			service: turboCacheManifest.id,
			bucketName: input.result.bucketName,
			workerUrl: input.result.workerUrl,
			authToken: input.options.printSecrets
				? input.result.authToken
				: "<redacted>",
			githubSecretsWritten: input.githubSecretsWritten,
			plan: input.result.plan,
		},
	});
}

function renderProvisionCatalog(): void {
	console.log(chalk.bold("Provisionable services:"));
	console.log(
		`  - cloudflare turbo-cache ${chalk.gray(turboCacheManifest.description)}`,
	);
	console.log("");
	renderProvisionNextSteps();
}

function renderCloudflareCatalog(): void {
	console.log(chalk.bold("Cloudflare services:"));
	console.log(`  - turbo-cache ${chalk.gray("Worker + R2 materialization")}`);
	console.log("");
	console.log(
		chalk.gray(
			"Provider-only mode does not create resources. Run a service subcommand to apply a plan.",
		),
	);
}

function renderProvisionNextSteps(): void {
	console.log(chalk.bold("Next steps:"));
	console.log(
		`  ${chalk.cyan("refarm sow --cloudflare")} ${chalk.gray("# configure Cloudflare token")}`,
	);
	console.log(
		`  ${chalk.cyan("refarm provision cloudflare turbo-cache --dry-run")}`,
	);
	console.log(
		`  ${chalk.cyan("refarm provision cloudflare turbo-cache --github-secrets")}`,
	);
}

function renderCloudflarePlan(input: TurboCacheCommandOptions): void {
	const plan = cloudflareTurboCachePlan(input);

	console.log(chalk.bold("Resources:"));
	for (const resource of plan.resources) {
		const secretHint = resource.secret ? " (secret value hidden)" : "";
		console.log(
			`  - ${resource.kind}:${resource.name} ${chalk.gray(resource.action)}${secretHint}`,
		);
		console.log(chalk.gray(`    ${resource.description}`));
	}
	console.log("");
	console.log(chalk.bold("CI secrets produced:"));
	for (const secret of plan.ciSecrets) {
		console.log(`  - ${secret}`);
	}
}

const cloudflareCommand = new Command("cloudflare")
	.description("List Cloudflare services; provision with a service subcommand")
	.addHelpText(
		"after",
		[
			"",
			"Examples:",
			"  $ refarm sow --cloudflare",
			"  $ refarm provision cloudflare --dry-run",
			"  $ refarm provision cloudflare --dry-run --json",
			"  $ refarm provision cloudflare turbo-cache --dry-run",
			"  $ refarm provision cloudflare turbo-cache --github-secrets",
			"",
			"Notes:",
			"  Provider-only mode lists services and next steps; it does not create resources.",
			"  Run turbo-cache to create or update Worker/R2 resources.",
			"  Use --dry-run on turbo-cache to inspect the exact plan before applying it.",
		].join("\n"),
	)
	.option(
		"--dry-run",
		"Show provider-level provisioning plan without creating resources",
	)
	.option("--json", "Output machine-readable provider catalog or dry-run plan")
	.action((opts: CloudflareCommandOptions, command: Command) => {
		const json = opts.json === true || optionIsEnabled(command, "json");
		const dryRun = opts.dryRun === true || optionIsEnabled(command, "dryRun");
		if (json) {
			printJson(buildCloudflareCatalogPayload({ dryRun }));
			return;
		}

		console.log(chalk.cyan("\nCloudflare provisioner\n"));
		renderCloudflareCatalog();
		console.log("");
		renderProvisionNextSteps();

		if (dryRun) {
			console.log("");
			console.log(chalk.yellow("  (dry-run — no resources will be created)\n"));
			renderCloudflarePlan({
				bucket: DEFAULT_TURBO_CACHE_BUCKET,
				team: DEFAULT_TURBO_CACHE_TEAM,
			});
		}
	})
	.addCommand(
		new Command("turbo-cache")
			.description(turboCacheManifest.description)
			.addHelpText(
				"after",
				[
					"",
					"Examples:",
					"  $ refarm sow --cloudflare",
					"  $ refarm provision cloudflare turbo-cache --dry-run",
					"  $ refarm provision cloudflare turbo-cache --dry-run --json",
					"  $ refarm provision cloudflare turbo-cache --github-secrets",
					"  $ refarm provision cloudflare turbo-cache --bucket refarm-turbo-cache --team refarm",
					"",
					"Notes:",
					"  Requires a Cloudflare token saved by refarm sow --cloudflare before applying.",
					"  --dry-run does not require credentials and prints the Worker/R2/secret plan.",
					"  --github-secrets writes TURBO_CACHE_* via gh; run gh auth status if it fails.",
					"  Rebuilding the devcontainer does not clear saved ~/.refarm credentials by default.",
				].join("\n"),
			)
			.option(
				"--dry-run",
				"Show what would be provisioned without creating resources",
			)
			.option("--json", "Output machine-readable dry-run or apply result")
			.option("--team <slug>", "Team slug for cache key namespacing", DEFAULT_TURBO_CACHE_TEAM)
			.option("--bucket <name>", "R2 bucket name", DEFAULT_TURBO_CACHE_BUCKET)
			.option(
				"--github-secrets",
				"Write produced TURBO_CACHE_* values to GitHub Actions secrets",
			)
			.option(
				"--print-secrets",
				"Print produced secret values to stdout (unsafe for shared logs)",
			)
			.action(async (opts: TurboCacheCommandOptions, command: Command) => {
				const shouldDryRun =
					opts.dryRun === true ||
					optionIsEnabled(command, "dryRun");
				const shouldJson =
					opts.json === true ||
					optionIsEnabled(command, "json");

				if (shouldDryRun && shouldJson) {
					printJson(buildTurboCacheDryRunPayload(opts));
					return;
				}

				if (!shouldJson) {
					console.log(
						chalk.cyan(`\nCloudflare · ${turboCacheManifest.displayName}\n`),
					);
				}

				if (shouldDryRun) {
					console.log(
						chalk.yellow("  (dry-run — no resources will be created)\n"),
					);
					renderCloudflarePlan(opts);
					return;
				}

				const silo = new SiloCore();
				const tokens = (await silo.loadTokens()) as {
					cloudflareToken?: string;
				} | null;

				if (!tokens?.cloudflareToken) {
					if (shouldJson) {
						printJson(buildTurboCacheMissingCredentialsPayload(opts));
						process.exitCode = 1;
						return;
					}
					console.error(
						chalk.red("No Cloudflare token found. Run `refarm sow --cloudflare` first."),
					);
					console.error(
						chalk.dim("Then apply: refarm provision cloudflare turbo-cache --github-secrets"),
					);
					console.error(
						chalk.dim("Use --dry-run only to inspect the plan without credentials."),
					);
					process.exitCode = 1;
					return;
				}

				let provider: CloudflareProvider;
				try {
					provider = await CloudflareProvider.create({
						apiToken: tokens.cloudflareToken,
					});
				} catch (err) {
					if (shouldJson) {
						printJson(
							buildTurboCacheFailurePayload({
								options: opts,
								error: "cloudflare-connect-failed",
								message: String(err),
								nextAction: "refarm sow --cloudflare",
							}),
						);
						process.exitCode = 1;
						return;
					}
					console.error(
						chalk.red(`  Failed to connect to Cloudflare: ${String(err)}`),
					);
					process.exitCode = 1;
					return;
				}

				const provisioner = new CloudflareTurboCacheProvisioner(provider);

				let result: Awaited<
					ReturnType<CloudflareTurboCacheProvisioner["provision"]>
				>;
				try {
					result = await provisioner.provision({
						bucketName: opts.bucket,
						team: opts.team,
					});
				} catch (err) {
					const enriched = enrichCloudflareError(err);
					if (shouldJson) {
						printJson(
							buildTurboCacheFailurePayload({
								options: opts,
								error: "cloudflare-provision-failed",
								message: enriched.message,
								nextAction: "refarm provision cloudflare turbo-cache --dry-run",
							}),
						);
						process.exitCode = 1;
						return;
					}
					console.error(chalk.red(`  Provisioning failed: ${enriched.message}`));
					process.exitCode = 1;
					return;
				}

				if (!shouldJson) {
					console.log(chalk.green(`  ✔ R2 bucket "${result.bucketName}"`));
					console.log(chalk.green("  ✔ AUTH_TOKEN secret set"));
					console.log(chalk.green(`  ✔ Worker deployed → ${result.workerUrl}\n`));
				}

				if (opts.githubSecrets) {
					try {
						setGitHubActionsSecret("TURBO_CACHE_API_URL", result.workerUrl);
						setGitHubActionsSecret("TURBO_CACHE_TOKEN", result.authToken);
					} catch (err) {
						if (shouldJson) {
							printJson(
								buildTurboCacheFailurePayload({
									options: opts,
									error: "github-secrets-write-failed",
									message: String(err),
									nextAction: "gh auth status",
								}),
							);
							process.exitCode = 1;
							return;
						}
						console.error(
							chalk.red(`  Failed to write GitHub secrets: ${String(err)}`),
						);
						process.exitCode = 1;
						return;
					}

					if (!shouldJson) {
						console.log(chalk.green("  ✔ GitHub secret TURBO_CACHE_API_URL set"));
						console.log(chalk.green("  ✔ GitHub secret TURBO_CACHE_TOKEN set"));
					}
					if (shouldJson) {
						printJson(
							buildTurboCacheApplyPayload({
								options: opts,
								result,
								githubSecretsWritten: true,
							}),
						);
					}
					return;
				}

				if (shouldJson) {
					printJson(
						buildTurboCacheApplyPayload({
							options: opts,
							result,
							githubSecretsWritten: false,
						}),
					);
					return;
				}

				console.log(chalk.bold("GitHub Actions secrets produced:\n"));
				console.log(
					`  ${chalk.cyan("TURBO_CACHE_API_URL")} = ${result.workerUrl}`,
				);
				console.log(
					`  ${chalk.cyan("TURBO_CACHE_TOKEN")}   = ${
						opts.printSecrets ? result.authToken : "<redacted>"
					}\n`,
				);
				console.log(
					chalk.gray(
						"  Re-run with --github-secrets to write them via gh without printing the token.",
					),
				);
				console.log(
					chalk.gray(
						"  Re-run with --print-secrets only when stdout is private.",
					),
				);
			}),
	);

export const provisionCommand = new Command("provision")
	.description("Provision cloud infrastructure")
	.addHelpText(
		"after",
		[
			"",
			"Examples:",
			"  $ refarm provision list",
			"  $ refarm provision list --json",
			"  $ refarm sow --cloudflare",
			"  $ refarm provision cloudflare",
			"  $ refarm provision cloudflare turbo-cache --dry-run",
			"  $ refarm provision cloudflare turbo-cache --github-secrets",
			"",
			"Notes:",
			"  Running a provider without a service prints guidance only; it does not create resources.",
			"  Cloudflare turbo-cache provisioning uses the token saved by refarm sow --cloudflare.",
			"  Rebuilding the devcontainer does not clear saved ~/.refarm credentials by default.",
		].join("\n"),
	)
	.addCommand(
		new Command("list")
			.description("List provisionable providers and services")
			.option("--json", "Output machine-readable provision catalog")
			.action((opts: ProvisionCommandOptions, command: Command) => {
				if (opts.json === true || optionIsEnabled(command, "json")) {
					printJson(buildProvisionCatalogPayload());
					return;
				}
				renderProvisionCatalog();
			}),
	)
	.addCommand(cloudflareCommand)
	.option("--json", "Output machine-readable provision catalog")
	.action((opts: ProvisionCommandOptions, command: Command) => {
		if (opts.json === true || optionIsEnabled(command, "json")) {
			printJson(buildProvisionCatalogPayload());
			return;
		}
		renderProvisionCatalog();
	});
