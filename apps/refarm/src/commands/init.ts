import { SowerCore } from "@refarm.dev/sower";
import { SiloCore } from "@refarm.dev/silo";
import chalk from "chalk";
import { Command } from "commander";
import inquirer from "inquirer";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import * as path from "node:path";


export const initCommand = new Command("init")
  .description("Initialize a new farm")
  .argument("[name]", "Project name", "my-farm")
  .option("--force", "Reinitialize even if already initialized (destructive)")
  .action(async (name, opts: { force?: boolean }) => {
    const projectDir = name === "." ? process.cwd() : path.join(process.cwd(), name);
    const configPath = path.join(projectDir, "refarm.config.json");
    const identityPath = path.join(projectDir, ".refarm", "identity.json");

    if (!opts.force && (existsSync(configPath) || existsSync(identityPath))) {
      console.log(chalk.yellow(`Already initialized at ${projectDir}.`));
      console.log(chalk.dim("Use --force to reinitialize (destructive)."));
      process.exit(0);
    }

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
      
      console.log(chalk.blue("Generating silo master key..."));
      const silo = new SiloCore();
      const identity = await silo.bootstrapIdentity();


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

