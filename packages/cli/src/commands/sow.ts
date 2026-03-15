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

    console.log(chalk.green(`\n✅ Silo: Harvested tokens and provisioned to your Sovereign Silo.`));
    console.log(chalk.gray(`   Stored in: ${results.storagePath || "~/.refarm/identity.json"}`));
    
    console.log(chalk.blue("\n📡 Windmill: Verifying infrastructure connectivity..."));

    if (results.github.ok) {
        console.log(chalk.green(`  - GitHub connection: OK`));
        console.log(chalk.gray(`    Verified access to ${results.github.count} repositories.`));
    } else {
        console.log(chalk.red(`  - GitHub connection: FAILED`));
        console.log(chalk.gray(`    Error: ${results.github.error}`));
    }

    if (results.cloudflare.ok) {
        console.log(chalk.green("  - Cloudflare connection: OK"));
        console.log(chalk.gray("    API Token verified and stored."));
    } else {
        console.log(chalk.red("  - Cloudflare connection: FAILED"));
    }

    console.log(chalk.bold.yellow("\n🚀 Your Sovereign Farm is now alive and seeded."));
    console.log(chalk.gray("You can now run 'refarm health' to audit your soil."));
  });


