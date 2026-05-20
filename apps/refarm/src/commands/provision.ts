import { Command } from "commander";
import chalk from "chalk";
import { spawnSync } from "node:child_process";
import { SiloCore } from "@refarm.dev/silo";
import {
	CloudflareProvider,
	CloudflareTurboCacheProvisioner,
	createCloudflareTurboCacheProvisionPlan,
	enrichCloudflareError,
} from "@refarm.dev/infra-cloudflare";
import { turboCacheManifest } from "@refarm.dev/infra-turbo-cache";

interface TurboCacheCommandOptions {
	dryRun?: boolean;
	team: string;
	bucket: string;
	githubSecrets?: boolean;
	printSecrets?: boolean;
}

interface CloudflareCommandOptions {
	dryRun?: boolean;
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
}

function renderProvisionNextSteps(): void {
	console.log(chalk.bold("Next steps:"));
	console.log(
		`  ${chalk.cyan("refarm provision cloudflare turbo-cache --dry-run")}`,
	);
	console.log(
		`  ${chalk.cyan("refarm provision cloudflare turbo-cache --github-secrets")}`,
	);
}

function renderCloudflarePlan(input: TurboCacheCommandOptions): void {
	const plan = createCloudflareTurboCacheProvisionPlan({
		bucketName: input.bucket,
		team: input.team,
	});

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

function setGitHubActionsSecret(name: string, value: string): void {
	const result = spawnSync("gh", ["secret", "set", name], {
		input: value,
		encoding: "utf-8",
		stdio: ["pipe", "pipe", "pipe"],
	});

	if (result.status !== 0) {
		const message =
			result.stderr?.trim() ||
			result.stdout?.trim() ||
			result.error?.message ||
			`gh secret set ${name} failed`;
		throw new Error(message);
	}
}

const cloudflareCommand = new Command("cloudflare")
	.description("Show Cloudflare provisionable services")
	.addHelpText(
		"after",
		[
			"",
			"Examples:",
			"  $ refarm provision cloudflare --dry-run",
			"  $ refarm provision cloudflare turbo-cache --dry-run",
			"  $ refarm provision cloudflare turbo-cache --github-secrets",
		].join("\n"),
	)
	.option(
		"--dry-run",
		"Show provider-level provisioning plan without creating resources",
	)
	.action((opts: CloudflareCommandOptions) => {
		console.log(chalk.cyan("\nCloudflare provisioner\n"));
		renderCloudflareCatalog();
		console.log("");
		renderProvisionNextSteps();

		if (opts.dryRun) {
			console.log("");
			console.log(chalk.yellow("  (dry-run — no resources will be created)\n"));
			renderCloudflarePlan({ bucket: "refarm-turbo-cache", team: "refarm" });
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
					"  $ refarm provision cloudflare turbo-cache --dry-run",
					"  $ refarm provision cloudflare turbo-cache --github-secrets",
					"  $ refarm provision cloudflare turbo-cache --bucket refarm-turbo-cache --team refarm",
				].join("\n"),
			)
			.option(
				"--dry-run",
				"Show what would be provisioned without creating resources",
			)
			.option("--team <slug>", "Team slug for cache key namespacing", "refarm")
			.option("--bucket <name>", "R2 bucket name", "refarm-turbo-cache")
			.option(
				"--github-secrets",
				"Write produced TURBO_CACHE_* values to GitHub Actions secrets",
			)
			.option(
				"--print-secrets",
				"Print produced secret values to stdout (unsafe for shared logs)",
			)
			.action(async (opts: TurboCacheCommandOptions) => {
				const shouldDryRun =
					opts.dryRun === true ||
					cloudflareCommand.opts<CloudflareCommandOptions>().dryRun === true;

				console.log(
					chalk.cyan(`\nCloudflare · ${turboCacheManifest.displayName}\n`),
				);

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
					console.error(
						chalk.red("No Cloudflare token found. Run `refarm sow` first."),
					);
					process.exit(1);
				}

				let provider: CloudflareProvider;
				try {
					provider = await CloudflareProvider.create({
						apiToken: tokens.cloudflareToken,
					});
				} catch (err) {
					console.error(
						chalk.red(`  Failed to connect to Cloudflare: ${String(err)}`),
					);
					process.exit(1);
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
					console.error(chalk.red(`  Provisioning failed: ${enriched.message}`));
					process.exit(1);
				}

				console.log(chalk.green(`  ✔ R2 bucket "${result.bucketName}"`));
				console.log(chalk.green("  ✔ AUTH_TOKEN secret set"));
				console.log(chalk.green(`  ✔ Worker deployed → ${result.workerUrl}\n`));

				if (opts.githubSecrets) {
					try {
						setGitHubActionsSecret("TURBO_CACHE_API_URL", result.workerUrl);
						setGitHubActionsSecret("TURBO_CACHE_TOKEN", result.authToken);
					} catch (err) {
						console.error(
							chalk.red(`  Failed to write GitHub secrets: ${String(err)}`),
						);
						process.exit(1);
					}

					console.log(chalk.green("  ✔ GitHub secret TURBO_CACHE_API_URL set"));
					console.log(chalk.green("  ✔ GitHub secret TURBO_CACHE_TOKEN set"));
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
	.addCommand(
		new Command("list")
			.description("List provisionable providers and services")
			.action(renderProvisionCatalog),
	)
	.addCommand(cloudflareCommand);
