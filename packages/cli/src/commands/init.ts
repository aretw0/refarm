import { SowerCore } from "@refarm.dev/sower";
import { SiloCore } from "@refarm.dev/silo";
import chalk from "chalk";
import { Command } from "commander";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";


export const initCommand = new Command("init")
  .description("Scaffold a new Sovereign Farm")
  .argument("[name]", "Project name", "my-sovereign-farm")
  .action(async (name) => {
    console.log(chalk.green(`🌱 Seeding your farm: ${name}...`));
    
    const core = new SowerCore();
    const result = await core.scaffold("switch-to-citizen", { name });

    if (result) {
      // 1. Create Directories
      if (!existsSync(".refarm")) {
        mkdirSync(".refarm", { recursive: true });
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
      writeFileSync(".refarm/identity.json", JSON.stringify(identityMetadata, null, 2));
      console.log(chalk.gray(`  - .refarm/identity.json (Public Identity Created)`));

      // 4. Write Config
      const config = {
        ...result.config,
        brand: { name, slug: name.toLowerCase().replace(/\s+/g, "-") }
      };
      writeFileSync("refarm.config.json", JSON.stringify(config, null, 2));
      console.log(chalk.gray(`  - refarm.config.json`));
    }

    console.log(chalk.blue("\n✨ Project structure seeded."));
    console.log(`\nNext step: run ${chalk.cyan("refarm sow")} to provide your nutrients.`);
  });

