import { Command } from "commander";
import chalk from "chalk";
import { SiloCore } from "@refarm.dev/silo";
import {
	CloudflareProvider,
	CloudflareTurboCacheProvisioner,
	createCloudflareTurboCacheProvisionPlan,
} from "@refarm.dev/infra-cloudflare";
import { turboCacheManifest } from "@refarm.dev/infra-turbo-cache";

interface TurboCacheCommandOptions {
	dryRun?: boolean;
	team: string;
	bucket: string;
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

const cloudflareCommand = new Command("cloudflare")
	.description("Provision Cloudflare services for Refarm")
	.addCommand(
		new Command("turbo-cache")
			.description(turboCacheManifest.description)
			.option("--dry-run", "Show what would be provisioned without creating resources")
			.option("--team <slug>", "Team slug for cache key namespacing", "refarm")
			.option("--bucket <name>", "R2 bucket name", "refarm-turbo-cache")
			.action(async (opts: TurboCacheCommandOptions) => {
				console.log(chalk.cyan(`\nCloudflare · ${turboCacheManifest.displayName}\n`));

				if (opts.dryRun) {
					console.log(chalk.yellow("  (dry-run — no resources will be created)\n"));
					renderCloudflarePlan(opts);
					return;
				}

				const silo = new SiloCore();
				const tokens = (await silo.loadTokens()) as {
					cloudflareToken?: string;
				} | null;

				if (!tokens?.cloudflareToken) {
					console.error(chalk.red("No Cloudflare token found. Run `refarm sow` first."));
					process.exit(1);
				}

				let provider: CloudflareProvider;
				try {
					provider = await CloudflareProvider.create({
						apiToken: tokens.cloudflareToken,
					});
				} catch (err) {
					console.error(chalk.red(`  Failed to connect to Cloudflare: ${String(err)}`));
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
					console.error(chalk.red(`  Provisioning failed: ${String(err)}`));
					process.exit(1);
				}

				console.log(chalk.green(`  ✔ R2 bucket "${result.bucketName}"`));
				console.log(chalk.green("  ✔ AUTH_TOKEN secret set"));
				console.log(chalk.green(`  ✔ Worker deployed → ${result.workerUrl}\n`));

				console.log(chalk.bold("Add these secrets to your GitHub repository:\n"));
				console.log(`  ${chalk.cyan("TURBO_CACHE_API_URL")} = ${result.workerUrl}`);
				console.log(`  ${chalk.cyan("TURBO_CACHE_TOKEN")}   = ${result.authToken}\n`);
				console.log(
					chalk.gray(
						"  gh secret set TURBO_CACHE_API_URL --body " +
							JSON.stringify(result.workerUrl),
					),
				);
				console.log(
					chalk.gray(
						"  gh secret set TURBO_CACHE_TOKEN   --body " +
							JSON.stringify(result.authToken),
					),
				);
			})
	);

export const provisionCommand = new Command("provision")
	.description("Provision infrastructure for your Sovereign Farm")
	.addCommand(cloudflareCommand);
