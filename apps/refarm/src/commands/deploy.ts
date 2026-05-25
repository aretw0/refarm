import { SiloCore } from "@refarm.dev/silo";
import { Windmill } from "@refarm.dev/windmill";
import chalk from "chalk";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { refarmCommand } from "./command-handoff.js";
import {
  buildJsonErrorEnvelope,
  buildJsonSuccessEnvelope,
  printJson,
} from "./json-output.js";

interface DeployResult {
	status: string;
	results?: Array<{ status: string; target: string; url?: string; message?: string }>;
	message?: string;
	url?: string;
}

const DEPLOY_TARGETS = ["all", "cloudflare", "github"] as const;
type DeployTarget = (typeof DEPLOY_TARGETS)[number];

interface DeployCommandOptions {
	target: string;
	dryRun?: boolean;
	json?: boolean;
}

const DEPLOY_SCHEMA_VERSION = 1;
const DEPLOY_DRY_RUN_COMMAND = "refarm deploy --dry-run";
const DEPLOY_HEALTH_COMMAND = "refarm health --next-action --json";

function parseDeployTarget(value: string): DeployTarget {
	if ((DEPLOY_TARGETS as readonly string[]).includes(value)) {
		return value as DeployTarget;
	}
	throw new Error(`Invalid deploy target "${value}". Use: ${DEPLOY_TARGETS.join(", ")}`);
}

function deployCommandForTarget(target: DeployTarget, options: { dryRun?: boolean } = {}): string {
	const args = ["deploy"];
	if (target !== "all") {
		args.push("--target", target);
	}
	if (options.dryRun) {
		args.push("--dry-run");
	}
	return refarmCommand(args);
}

function deployJsonNextCommands(input: {
	target: DeployTarget;
	dryRun: boolean;
	ok: boolean;
}): string[] {
	if (!input.ok) {
		return [deployCommandForTarget(input.target, { dryRun: true })];
	}
	if (input.dryRun) {
		return [deployCommandForTarget(input.target)];
	}
	return [DEPLOY_HEALTH_COMMAND];
}

export const deployCommand = new Command("deploy")
  .description("Deploy artifacts to configured targets")
  .addHelpText(
    "after",
    [
      "",
      "Examples:",
      "  $ refarm deploy --dry-run",
      "  $ refarm deploy --dry-run --json",
      "  $ refarm deploy --target github --dry-run",
      "  $ refarm deploy --target cloudflare",
      "",
      "Notes:",
      "  Run from a workspace containing refarm.config.json.",
      "  Use --dry-run first; live deploy resolves credentials from Silo and passes them to Windmill.",
      "  Use refarm provision cloudflare turbo-cache before deploying Cloudflare-backed cache infrastructure.",
    ].join("\n"),
  )
  .option("--target <target>", "Target platform (cloudflare, github, all)", "all")
  .option("--dry-run", "Simulate the deployment")
  .option("--json", "Output machine-readable deployment result")
  .action(async (options: DeployCommandOptions) => {
    if (!options.json) {
      console.log(chalk.bold.green("\nStarting deployment orchestration..."));
    }

    try {
      const target = parseDeployTarget(options.target);
      const configPath = path.join(process.cwd(), "refarm.config.json");
      if (!fs.existsSync(configPath)) {
          throw new Error("refarm.config.json not found in current directory.");
      }

      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      const silo = new SiloCore(config);
      const tokens = await silo.provision();

      // Ensure tokens are available in environment for Windmill
      Object.assign(process.env, tokens);

      const windmill = new Windmill(config, { dryRun: options.dryRun });

      if (!options.json) {
        console.log(`🚀 Deploying to ${chalk.cyan(target)}...`);
      }

      const result = await windmill.deploy(target) as unknown as DeployResult;

      if (options.json) {
        const ok = result.status === "success" || result.status === "dry-run";
        const nextCommands = deployJsonNextCommands({
          target,
          dryRun: options.dryRun === true,
          ok,
        });
        const jsonEnvelope = ok
          ? buildJsonSuccessEnvelope({
              command: "deploy",
              operation: "deploy",
              nextAction: nextCommands[0] ?? null,
              nextActions: nextCommands,
              nextCommand: nextCommands[0] ?? null,
              nextCommands,
              extra: {
                schemaVersion: DEPLOY_SCHEMA_VERSION,
                target,
                dryRun: options.dryRun === true,
                status: result.status,
                result,
              },
            })
          : buildJsonErrorEnvelope({
              command: "deploy",
              operation: "deploy",
              error: "deploy-failed",
              message: result.message,
              nextAction: nextCommands[0] ?? DEPLOY_DRY_RUN_COMMAND,
              nextActions: nextCommands,
              nextCommand: nextCommands[0] ?? DEPLOY_DRY_RUN_COMMAND,
              nextCommands,
              extra: {
                schemaVersion: DEPLOY_SCHEMA_VERSION,
                target,
                dryRun: options.dryRun === true,
                status: result.status,
                result,
              },
            });
        printJson(jsonEnvelope);
        if (!ok) process.exitCode = 1;
        return;
      }

      if (result.status === "success" || result.status === "dry-run" || result.status === "partial_failure") {
          console.log(chalk.bold.green("\n✨ Deployment orchestration finished!"));

          if (result.results) {
              console.log(chalk.gray("\n--- Target Summary ---"));
              for (const r of result.results) {
                  const statusColor = r.status === "success" || r.status === "dry-run" ? chalk.green : chalk.red;
                  console.log(`${chalk.bold(r.target.toUpperCase())}: ${statusColor(r.status)}`);
                  if (r.url) console.log(`  🔗 ${chalk.underline.blue(r.url)}`);
                  if (r.message) console.log(`  📝 ${r.message}`);
              }
          } else if (result.url) {
              console.log(`🔗 Preview URL: ${chalk.underline.blue(result.url)}`);
          }

          if (result.status === "partial_failure") {
              console.warn(chalk.yellow("\n⚠️ Some deployment targets failed."));
              process.exitCode = 1;
              return;
          }
      } else {
          console.error(chalk.red(`\n❌ Deployment failed: ${result.message}`));
          process.exitCode = 1;
          return;
      }
    } catch (error) {
      if (options.json) {
        const message = error instanceof Error ? error.message : String(error);
        printJson(
          buildJsonErrorEnvelope({
            command: "deploy",
            operation: "deploy",
            error: "deploy-failed",
            message,
            nextAction: DEPLOY_DRY_RUN_COMMAND,
            nextActions: [DEPLOY_DRY_RUN_COMMAND],
            nextCommand: DEPLOY_DRY_RUN_COMMAND,
            nextCommands: [DEPLOY_DRY_RUN_COMMAND],
            extra: {
              schemaVersion: DEPLOY_SCHEMA_VERSION,
              target: options.target,
              dryRun: options.dryRun === true,
              status: "error",
            },
          }),
        );
        process.exitCode = 1;
        return;
      }
      console.error(chalk.red(`\n❌ Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exitCode = 1;
      return;
    }
  });
