import { SiloCore } from "@refarm.dev/silo";
import { Windmill } from "@refarm.dev/windmill";
import chalk from "chalk";
import { Command } from "commander";
import inquirer from "inquirer";
import * as fs from "node:fs";
import * as path from "node:path";
import { printJson } from "./json-output.js";

interface MigrateConfig {
	brand?: { slug?: string; urls?: { repository?: string } };
	infrastructure?: { gitHost?: string };
}

interface MigrateCommandOptions {
	target?: string;
	dryRun?: boolean;
	json?: boolean;
}

const MIGRATE_SCHEMA_VERSION = 1;

function wantsJsonOutput(
	options: MigrateCommandOptions,
	command: Command,
): boolean {
	return (
		options.json === true ||
		command.optsWithGlobals<Record<string, unknown>>().json === true
	);
}

export const migrateCommand = new Command("migrate")
  .description("Mirror your project to another Git remote")
  .addHelpText(
    "after",
    [
      "",
      "Examples:",
      "  $ refarm migrate --target https://github.com/user/fork.git --dry-run",
      "  $ refarm migrate --target https://github.com/user/fork.git --dry-run --json",
      "  $ refarm migrate --target git@github.com:user/fork.git",
      "",
      "Notes:",
      "  This mirrors the current repository to another Git remote.",
      "  Use --dry-run first; live migration may push the full repository.",
      "  The source remote is read from refarm.config.json or .git/config.",
    ].join("\n"),
  )
  .option("--target <url>", "Target Git URL for mirroring")
  .option("--dry-run", "Simulate the migration without pushing")
  .option("--json", "Output machine-readable migration result")
  .action(async (options: MigrateCommandOptions, command: Command) => {
    const json = wantsJsonOutput(options, command);
    if (!json) {
      console.log(chalk.red.bold("\nRepository mirror"));
      console.log(chalk.yellow("This process will mirror your entire repository to another Git remote.\n"));
    }

    let targetUrl = options.target;

    if (!targetUrl) {
        if (json) {
            printJson({
                schemaVersion: MIGRATE_SCHEMA_VERSION,
                command: "migrate",
                operation: "mirror",
                dryRun: options.dryRun === true,
                ok: false,
                status: "error",
                error: "missing-target-url",
                message: "Missing --target <url>.",
                nextAction: "refarm migrate --target <url> --dry-run",
                nextActions: ["refarm migrate --target <url> --dry-run"],
            });
            process.exitCode = 1;
            return;
        }
        const answers = await inquirer.prompt([
            {
                type: "input",
                name: "targetUrl",
                message: "Enter the target Git URL (e.g., a private GitHub/GitLab repo):",
                validate: (input) => input.startsWith("http") || input.startsWith("git@")
            }
        ]);
        targetUrl = answers.targetUrl;
    }

    const silo = new SiloCore();
    const tokens = await silo.resolve();
    
    // Set environment variables for Windmill providers
    process.env.GITHUB_TOKEN = tokens.get("REFARM_GITHUB_TOKEN") || process.env.GITHUB_TOKEN;
    process.env.CLOUDFLARE_API_TOKEN = tokens.get("REFARM_CLOUDFLARE_API_TOKEN") || process.env.CLOUDFLARE_API_TOKEN;

    // Load config from current directory
    const configPath = path.join(process.cwd(), "refarm.config.json");
    let config: MigrateConfig = {};
    if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as MigrateConfig;
    } else {
        if (!json) {
            console.warn(chalk.gray("No refarm.config.json found in current directory. Using default context."));
        }
        config = {
            brand: { slug: path.basename(process.cwd()), urls: { repository: "" } },
            infrastructure: { gitHost: "github" }
        };
    }

    // Ensure we have a source repository URL for mirroring
    if (!config.brand?.urls?.repository) {
        // Try to detect from .git/config
        try {
            const gitConfig = fs.readFileSync(path.join(process.cwd(), ".git", "config"), "utf-8");
            const remoteMatch = gitConfig.match(/\[remote "origin"\][\s\S]*?url = (.*)/);
            if (remoteMatch && remoteMatch[1]) {
                config.brand = config.brand || {};
                config.brand.urls = config.brand.urls || {};
                config.brand.urls.repository = remoteMatch[1].trim();
            }
        } catch (_e) {
            // Ignore
        }
    }

    if (!config.brand?.urls?.repository) {
        if (json) {
            printJson({
                schemaVersion: MIGRATE_SCHEMA_VERSION,
                command: "migrate",
                operation: "mirror",
                dryRun: options.dryRun === true,
                ok: false,
                status: "error",
                error: "source-repository-not-found",
                message: "Could not detect source repository URL.",
                targetUrl,
                nextAction: "set brand.urls.repository in refarm.config.json",
                nextActions: [
                    "set brand.urls.repository in refarm.config.json",
                    "run refarm migrate --target <url> --dry-run",
                ],
            });
            process.exitCode = 1;
            return;
        }
        console.error(chalk.red("Error: Could not detect source repository URL. Please ensure you are in a Git repo or have it in your config."));
        process.exitCode = 1;
        return;
    }

    if (!json) {
        console.log(chalk.blue(`📡 Initializing mirror flow for ${config.brand?.urls?.repository}...`));
    }

    const windmill = new Windmill(config, { dryRun: options.dryRun });
    const result = await windmill.github.mirrorRepo(config.brand?.slug, targetUrl, {
        dryRun: options.dryRun
    });

    if (json) {
        const ok = result.status === "success" || result.status === "dry-run";
        printJson({
            schemaVersion: MIGRATE_SCHEMA_VERSION,
            command: "migrate",
            operation: "mirror",
            dryRun: options.dryRun === true,
            ok,
            status: result.status,
            sourceUrl: config.brand.urls.repository,
            targetUrl,
            result,
            nextAction: ok ? null : "refarm migrate --target <url> --dry-run",
            nextActions: ok ? [] : ["refarm migrate --target <url> --dry-run"],
        });
        if (!ok) process.exitCode = 1;
        return;
    }

    if (result.status === "success") {
        console.log(chalk.green.bold("\n✨ MIGRATION COMPLETE"));
        console.log(chalk.gray(`Your repository has been mirrored to: ${targetUrl}`));
    } else if (result.status === "dry-run") {
        console.log(chalk.yellow.bold("\n✨ DRY RUN SUCCESSFUL"));
        console.log(chalk.gray(`Would have mirrored to: ${targetUrl}`));
    } else {
        console.log(chalk.red.bold("\n❌ MIGRATION FAILED"));
        console.log(chalk.red(`Error: ${result.message}`));
    }
  });
