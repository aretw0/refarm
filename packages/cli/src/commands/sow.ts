import { Command } from "commander";
import chalk from "chalk";
import inquirer from "inquirer";
import { SowerCore } from "@refarm.dev/sower";
import { SiloCore } from "@refarm.dev/silo";
import { Windmill } from "@refarm.dev/windmill";


export const sowCommand = new Command("sow")
  .description("Provision your farm with initial tokens and context")
  .action(async () => {
    console.log(chalk.yellow("🌾 Silo: Preparing to collect nutrients (tokens)..."));

    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "owner",
        message: "Your GitHub username/org:",
        default: "refarm-dev"
      },
      {
        type: "password",
        name: "githubToken",
        message: "Your GitHub Personal Access Token (PAT):",
        mask: "*"
      },
      {
        type: "password",
        name: "cloudflareToken",
        message: "Your Cloudflare API Token:",
        mask: "*"
      }
    ]);

    const sower = new SowerCore();
    const results = await sower.sow({
      githubToken: answers.githubToken,
      cloudflareToken: answers.cloudflareToken
    }, { owner: answers.owner });

    console.log(chalk.green(`\n✅ Silo: Harvested tokens and saved to identity.json`));
    console.log(chalk.blue("📡 Windmill: Verifying infrastructure connectivity..."));

    if (results.github.ok) {
        console.log(chalk.gray(`  - GitHub connection: OK (${results.github.count} repos found)`));
    } else {
        console.log(chalk.red(`  - GitHub connection: FAILED (${results.github.error})`));
    }

    if (results.cloudflare.ok) {
        console.log(chalk.gray("  - Cloudflare connection: OK (Token stored)"));
    } else {
        console.log(chalk.red("  - Cloudflare connection: FAILED"));
    }

    console.log(chalk.bold("\n🚀 Your Sovereign Farm is now alive and seeded."));
  });


