import { findRefarmConfigPath } from "@refarm.dev/config";
import { createStdioOperatorChannel } from "@refarm.dev/prompt-contract-v1";
import { SiloCore } from "@refarm.dev/silo";
import { Windmill } from "@refarm.dev/windmill";
import chalk from "chalk";
import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import { joinCommand, quoteCommandArg, refarmCommand } from "./command-handoff.js";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	printJson,
} from "./json-output.js";

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

function migrateDryRunCommand(targetUrl: string): string {
	return refarmCommand(["migrate", "--target", quoteCommandArg(targetUrl), "--dry-run"]);
}

function migrateApplyCommand(targetUrl: string): string {
	return refarmCommand(["migrate", "--target", quoteCommandArg(targetUrl)]);
}

function migrateVerifyCommand(targetUrl: string): string {
	return joinCommand(["git", "ls-remote", quoteCommandArg(targetUrl), "HEAD"]);
}

function isSupportedTargetUrl(value: string): boolean {
	return value.startsWith("http") || value.startsWith("git@");
}

function migrateJsonNextCommands(input: {
	targetUrl: string;
	dryRun: boolean;
	ok: boolean;
}): string[] {
	if (!input.ok) {
		return [migrateDryRunCommand(input.targetUrl)];
	}
	if (input.dryRun) {
		return [migrateApplyCommand(input.targetUrl)];
	}
	return [migrateVerifyCommand(input.targetUrl)];
}

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
      "  The source remote is read from .refarm/config.json or .git/config.",
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
            printJson(
                buildJsonErrorEnvelope({
                    command: "migrate",
                    operation: "mirror",
                    error: "missing-target-url",
                    message: "Missing --target <url>.",
                    nextAction: "Provide a concrete target Git URL and run a dry-run migration.",
                    nextActions: ["Provide a concrete target Git URL and run a dry-run migration."],
                    extra: {
                        schemaVersion: MIGRATE_SCHEMA_VERSION,
                        dryRun: options.dryRun === true,
                        status: "error",
                    },
                }),
            );
            process.exitCode = 1;
            return;
        }
        const operator = createStdioOperatorChannel();
        const promptedTargetUrl = await operator.ask({
            type: "text",
            question: "Enter the target Git URL",
            placeholder: "https://github.com/user/fork.git or git@github.com:user/fork.git",
        });
        if (!isSupportedTargetUrl(promptedTargetUrl)) {
            console.error(chalk.red("Error: Target Git URL must start with http or git@."));
            process.exitCode = 1;
            return;
        }
        targetUrl = promptedTargetUrl;
    }

    if (!targetUrl) {
        console.error(chalk.red("Error: Missing target Git URL."));
        process.exitCode = 1;
        return;
    }
    const resolvedTargetUrl = targetUrl;

    const silo = new SiloCore();
    const tokens = await silo.resolve();
    
    // Set environment variables for Windmill providers
    process.env.GITHUB_TOKEN = tokens.get("REFARM_GITHUB_TOKEN") || process.env.GITHUB_TOKEN;
    process.env.CLOUDFLARE_API_TOKEN = tokens.get("REFARM_CLOUDFLARE_API_TOKEN") || process.env.CLOUDFLARE_API_TOKEN;

    // Load config from current directory
    const configPath = findRefarmConfigPath(process.cwd());
    let config: MigrateConfig = {};
    if (configPath) {
        config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as MigrateConfig;
    } else {
        if (!json) {
            console.warn(chalk.gray("No .refarm/config.json found in current directory. Using default context."));
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
            printJson(
                buildJsonErrorEnvelope({
                    command: "migrate",
                    operation: "mirror",
                    error: "source-repository-not-found",
                    message: "Could not detect source repository URL.",
                    nextAction: "set brand.urls.repository in .refarm/config.json",
                    nextActions: [
                        "set brand.urls.repository in .refarm/config.json",
                        "run a dry-run migration with a concrete target Git URL",
                    ],
                    extra: {
                        schemaVersion: MIGRATE_SCHEMA_VERSION,
                        dryRun: options.dryRun === true,
                        status: "error",
                        targetUrl: resolvedTargetUrl,
                    },
                }),
            );
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
    const result = await windmill.github.mirrorRepo(config.brand?.slug, resolvedTargetUrl, {
        dryRun: options.dryRun
    });

    if (json) {
        const ok = result.status === "success" || result.status === "dry-run";
        const nextCommands = migrateJsonNextCommands({
            targetUrl: resolvedTargetUrl,
            dryRun: options.dryRun === true,
            ok,
        });
        const jsonEnvelope = ok
            ? buildJsonSuccessEnvelope({
                command: "migrate",
                operation: "mirror",
                nextAction: nextCommands[0] ?? null,
                nextActions: nextCommands,
                nextCommand: nextCommands[0] ?? null,
                nextCommands,
                extra: {
                    schemaVersion: MIGRATE_SCHEMA_VERSION,
                    dryRun: options.dryRun === true,
                    status: result.status,
                    sourceUrl: config.brand.urls.repository,
                    targetUrl: resolvedTargetUrl,
                    result,
                },
            })
            : buildJsonErrorEnvelope({
                command: "migrate",
                operation: "mirror",
                error: "migrate-failed",
                message: result.message,
                nextAction: nextCommands[0] ?? migrateDryRunCommand(resolvedTargetUrl),
                nextActions: nextCommands,
                nextCommand: nextCommands[0] ?? migrateDryRunCommand(resolvedTargetUrl),
                nextCommands,
                extra: {
                    schemaVersion: MIGRATE_SCHEMA_VERSION,
                    dryRun: options.dryRun === true,
                    status: result.status,
                    sourceUrl: config.brand.urls.repository,
                    targetUrl: resolvedTargetUrl,
                    result,
                },
            });
        printJson(jsonEnvelope);
        if (!ok) process.exitCode = 1;
        return;
    }

    if (result.status === "success") {
        console.log(chalk.green.bold("\n✨ MIGRATION COMPLETE"));
        console.log(chalk.gray(`Your repository has been mirrored to: ${resolvedTargetUrl}`));
    } else if (result.status === "dry-run") {
        console.log(chalk.yellow.bold("\n✨ DRY RUN SUCCESSFUL"));
        console.log(chalk.gray(`Would have mirrored to: ${resolvedTargetUrl}`));
    } else {
        console.log(chalk.red.bold("\n❌ MIGRATION FAILED"));
        console.log(chalk.red(`Error: ${result.message}`));
    }
  });
