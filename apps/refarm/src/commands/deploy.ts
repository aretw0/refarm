import { SiloCore } from "@refarm.dev/silo";
import { Windmill } from "@refarm.dev/windmill";
import chalk from "chalk";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";

export const deployCommand = new Command("deploy")
  .description("Automated Soil: Deploy artifacts to sovereign targets")
  .option("--target <target>", "Target platform (cloudflare, github, all)", "all")
  .option("--dry-run", "Simulate the deployment")
  .action(async (options) => {
    console.log(chalk.bold.green("\n🌱 Starting Automated Soil Deployment..."));

    try {
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

      console.log(`🚀 Deploying to ${chalk.cyan(options.target)}...`);

      const result = await windmill.deploy(options.target) as any;

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
              process.exit(1);
          }
      } else {
          console.error(chalk.red(`\n❌ Deployment failed: ${result.message}`));
          process.exit(1);
      }
    } catch (error: any) {
      console.error(chalk.red(`\n❌ Error: ${error.message}`));
      process.exit(1);
    }
  });
