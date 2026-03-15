import { SowerCore } from "@refarm.dev/sower";
import chalk from "chalk";
import { Command } from "commander";
import { mkdirSync, writeFileSync } from "node:fs";

export const initCommand = new Command("init")
  .description("Scaffold a new Sovereign Farm")
  .argument("[name]", "Project name", "my-sovereign-farm")
  .action(async (name) => {
    console.log(chalk.green(`🌱 Seeding your farm: ${name}...`));
    
    const core = new SowerCore();
    const result = await core.scaffold("switch-to-citizen", { name });

    if (result) {
      // 1. Create Directories
      mkdirSync(".refarm", { recursive: true });
      
      // 2. Write Identity Metadata (Security Transparency - Public)
      if (result.identity) {
        writeFileSync(".refarm/identity.json", JSON.stringify(result.identity, null, 2));
        console.log(chalk.gray(`  - .refarm/identity.json (Public Identity Created)`));
      }

      // 3. Write Secret Key (Private - SOBER PROTECTION)
      if (result.secrets?.masterPrivateKey) {
        writeFileSync(".refarm/identity.key", result.secrets.masterPrivateKey);
        console.log(chalk.yellow(`  - .refarm/identity.key (PRIVATE - DO NOT COMMIT)`));
      }

      // 4. Write Config
      writeFileSync("refarm.config.json", JSON.stringify(result.config, null, 2));
      console.log(chalk.gray(`  - refarm.config.json`));
    }

    console.log(chalk.blue("\n✨ Project structure seeded."));
    console.log(`\nNext step: run ${chalk.cyan("refarm guide")} to audit your nutrients.`);
  });
