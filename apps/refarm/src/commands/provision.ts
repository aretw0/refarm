import { Command } from "commander";
import chalk from "chalk";
import { SiloCore } from "@refarm.dev/silo";
import { CloudflareProvider } from "@refarm.dev/infra-cloudflare";
import { TurboCacheProvisioner, turboCacheManifest } from "@refarm.dev/infra-turbo-cache";

const cloudflareCommand = new Command("cloudflare")
  .description("Provision Cloudflare services for Refarm")
  .addCommand(
    new Command("turbo-cache")
      .description(turboCacheManifest.description)
      .option("--dry-run", "Show what would be provisioned without creating resources")
      .option("--team <slug>", "Team slug for cache key namespacing", "refarm")
      .option("--bucket <name>", "R2 bucket name", "refarm-turbo-cache")
      .action(async (opts: { dryRun?: boolean; team: string; bucket: string }) => {
        const silo = new SiloCore();
        const tokens = (await silo.loadTokens()) as { cloudflareToken?: string } | null;

        if (!tokens?.cloudflareToken) {
          console.error(chalk.red("No Cloudflare token found. Run `refarm sow` first."));
          process.exit(1);
        }

        console.log(chalk.cyan(`\nCloudflare · ${turboCacheManifest.displayName}\n`));

        if (opts.dryRun) {
          console.log(chalk.yellow("  (dry-run — no resources will be created)\n"));
        }

        let provider: CloudflareProvider;
        try {
          provider = await CloudflareProvider.create({ apiToken: tokens.cloudflareToken });
        } catch (err) {
          console.error(chalk.red(`  Failed to connect to Cloudflare: ${String(err)}`));
          process.exit(1);
        }

        const provisioner = new TurboCacheProvisioner(provider);

        let result: Awaited<ReturnType<TurboCacheProvisioner["provision"]>>;
        try {
          result = await provisioner.provision({
            bucketName: opts.bucket,
            team: opts.team,
            dryRun: opts.dryRun,
          });
        } catch (err) {
          console.error(chalk.red(`  Provisioning failed: ${String(err)}`));
          process.exit(1);
        }

        console.log(chalk.green(`  ✔ R2 bucket "${result.bucketName}"`));
        console.log(chalk.green(`  ✔ AUTH_TOKEN secret set`));
        console.log(chalk.green(`  ✔ Worker deployed → ${result.workerUrl}\n`));

        if (!opts.dryRun) {
          console.log(chalk.bold("Add these secrets to your GitHub repository:\n"));
          console.log(`  ${chalk.cyan("TURBO_CACHE_API_URL")} = ${result.workerUrl}`);
          console.log(`  ${chalk.cyan("TURBO_CACHE_TOKEN")}   = ${result.authToken}\n`);
          console.log(chalk.gray("  gh secret set TURBO_CACHE_API_URL --body " + JSON.stringify(result.workerUrl)));
          console.log(chalk.gray("  gh secret set TURBO_CACHE_TOKEN   --body " + JSON.stringify(result.authToken)));
        }
      })
  );

export const provisionCommand = new Command("provision")
  .description("Provision infrastructure for your Sovereign Farm")
  .addCommand(cloudflareCommand);
