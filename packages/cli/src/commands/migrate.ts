import { Command } from "commander";
import chalk from "chalk";
import inquirer from "inquirer";
import { Windmill } from "@refarm.dev/windmill";
import { SiloCore } from "@refarm.dev/silo";
import * as fs from "node:fs";
import * as path from "node:path";

export const migrateCommand = new Command("migrate")
  .description("Activate the Escape Hatch: Mirror your project to a sovereign target")
  .option("--target <url>", "Target Git URL for mirroring")
  .option("--dry-run", "Simulate the migration without pushing")
  .action(async (options) => {
    console.log(chalk.red.bold("\n🚨 ESCAPE HATCH ACTIVATED"));
    console.log(chalk.yellow("This process will mirror your entire repository to a new sovereign home.\n"));

    let targetUrl = options.target;

    if (!targetUrl) {
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
    let config: any = {};
    if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } else {
        console.warn(chalk.gray("No refarm.config.json found in current directory. Using default context."));
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
        } catch (e) {
            // Ignore
        }
    }

    if (!config.brand?.urls?.repository) {
        console.error(chalk.red("Error: Could not detect source repository URL. Please ensure you are in a Git repo or have it in your config."));
        process.exit(1);
    }

    console.log(chalk.blue(`📡 Initializing mirror flow for ${config.brand?.urls?.repository}...`));

    const windmill = new Windmill(config, { dryRun: options.dryRun });
    const result = await windmill.github.mirrorRepo(config.brand?.slug, targetUrl, {
        dryRun: options.dryRun
    });

    if (result.status === "success") {
        console.log(chalk.green.bold("\n✨ MIGRATION COMPLETE"));
        console.log(chalk.gray(`Your sovereign farm has been mirrored to: ${targetUrl}`));
    } else if (result.status === "dry-run") {
        console.log(chalk.yellow.bold("\n✨ DRY RUN SUCCESSFUL"));
        console.log(chalk.gray(`Would have mirrored to: ${targetUrl}`));
    } else {
        console.log(chalk.red.bold("\n❌ MIGRATION FAILED"));
        console.log(chalk.red(`Error: ${result.message}`));
    }
  });
