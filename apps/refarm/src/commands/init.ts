import { SowerCore } from "@refarm.dev/sower";
import { SiloCore } from "@refarm.dev/silo";
import chalk from "chalk";
import { Command } from "commander";
import inquirer from "inquirer";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import * as path from "node:path";


export const initCommand = new Command("init")
  .description("Scaffold a new Sovereign Farm")
  .argument("[name]", "Project name", "my-sovereign-farm")
  .action(async (name) => {
    console.log(chalk.green(`🌱 Seeding your farm: ${name}...`));

    const answers = await inquirer.prompt([
      {
        type: "list",
        name: "template",
        message: "Choose a template to start with:",
        choices: [
          { name: "Courier (Default App)", value: "courier" },
          { name: "Rust Plugin (Heartwood)", value: "rust-plugin" }
        ]
      }
    ]);
    
    const core = new SowerCore();
    const projectDir = name === "." ? process.cwd() : path.join(process.cwd(), name);
    
    if (!existsSync(projectDir)) {
        mkdirSync(projectDir, { recursive: true });
    }

    const result = await core.scaffold(answers.template, { name, targetDir: projectDir });

    if (result) {
      const refarmDir = path.join(projectDir, ".refarm");
      // 1. Create Directories
      if (!existsSync(refarmDir)) {
        mkdirSync(refarmDir, { recursive: true });
      }
      
      // 2. Bootstrap Real Identity via Silo (SOVEREIGN IMPROVEMENT)
      console.log(chalk.blue("🔑 Silo: Generating your Sovereign Master Key..."));
      const silo = new SiloCore();
      const identity = await silo.bootstrapIdentity() as any;


      // 3. Write Identity Metadata (Security Transparency - Public)
      const identityMetadata = {
        publicKey: identity.publicKey,
        bootstrappedAt: identity.timestamp,
        name
      };
      writeFileSync(path.join(refarmDir, "identity.json"), JSON.stringify(identityMetadata, null, 2));
      console.log(chalk.gray(`  - .refarm/identity.json (Public Identity Created)`));

      // 4. Write Config
      const config = {
        ...result.config,
        brand: { name, slug: name.toLowerCase().replace(/\s+/g, "-") }
      };
      writeFileSync(path.join(projectDir, "refarm.config.json"), JSON.stringify(config, null, 2));
      console.log(chalk.gray(`  - refarm.config.json`));
    }

    console.log(chalk.blue("\n✨ Project structure seeded."));
    console.log(`\nNext step: cd into ${chalk.cyan(name)} and run ${chalk.cyan("refarm sow")} to provide your nutrients.`);
  });

