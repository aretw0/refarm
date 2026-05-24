import { SiloCore } from "@refarm.dev/silo";
import { SowerCore } from "@refarm.dev/sower";
import chalk from "chalk";
import { Command } from "commander";
import inquirer from "inquirer";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import {
	quoteCommandArg,
	refarmCommand,
	workspaceCommand,
} from "./command-handoff.js";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	printJson,
} from "./json-output.js";

interface InitOptions {
  force?: boolean;
  json?: boolean;
}

const INIT_SCHEMA_VERSION = 1;

function initForceCommand(name: string): string {
  return refarmCommand(["init", quoteCommandArg(name), "--force"]);
}

export const initCommand = new Command("init")
  .description("Initialize a new Refarm workspace")
  .addHelpText(
    "after",
    [
      "",
      "Examples:",
      "  $ refarm init my-workspace",
      "  $ refarm init .",
      "  $ refarm init my-workspace --force",
      "  $ refarm init my-workspace --json",
      "",
      "Notes:",
      "  This creates refarm.config.json and .refarm/identity.json.",
      "  The workspace identity is metadata; operator credentials are saved later",
      "  under ~/.refarm/identity.json by refarm sow.",
      "  --force reinitializes an existing workspace and can overwrite generated metadata.",
      "  After init, run refarm sow to configure model credentials.",
      "  Use refarm model current to inspect the default route, and refarm guide",
      "  to generate a local setup audit with GitHub/Cloudflare next steps.",
    ].join("\n"),
  )
  .argument("[name]", "Project name", "my-workspace")
  .option("--force", "Reinitialize even if already initialized (destructive)")
  .option("--json", "Output machine-readable initialization result")
  .action(async (name, opts: InitOptions) => {
    const projectDir = name === "." ? process.cwd() : path.join(process.cwd(), name);
    const configPath = path.join(projectDir, "refarm.config.json");
    const identityPath = path.join(projectDir, ".refarm", "identity.json");

    if (!opts.force && (existsSync(configPath) || existsSync(identityPath))) {
      if (opts.json) {
        printJson(
          buildJsonErrorEnvelope({
            command: "init",
            operation: "scaffold",
            error: "already-initialized",
            message: `Already initialized at ${projectDir}.`,
            nextAction: initForceCommand(name),
            nextActions: [initForceCommand(name)],
            nextCommand: initForceCommand(name),
            extra: {
              schemaVersion: INIT_SCHEMA_VERSION,
              status: "already-initialized",
              projectDir,
              configPath,
              identityPath,
            },
          }),
        );
        return;
      }
      console.log(chalk.yellow(`Already initialized at ${projectDir}.`));
      console.log(chalk.dim("Use --force to reinitialize (destructive)."));
      return;
    }

    if (!opts.json) {
      console.log(chalk.green(`Initializing Refarm workspace: ${name}...`));
    }

    const answers = await inquirer.prompt([
      {
        type: "list",
        name: "template",
        message: "Choose a template to start with:",
        choices: [
          { name: "Workspace App", value: "workspace" },
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
      // 1. Create directories
      if (!existsSync(refarmDir)) {
        mkdirSync(refarmDir, { recursive: true });
      }
      
      if (!opts.json) {
        console.log(chalk.blue("Generating workspace identity..."));
      }
      const silo = new SiloCore();
      const identity = await silo.bootstrapIdentity();


      // 3. Write identity metadata
      const identityMetadata = {
        publicKey: identity.publicKey,
        bootstrappedAt: identity.timestamp,
        name
      };
      writeFileSync(path.join(refarmDir, "identity.json"), JSON.stringify(identityMetadata, null, 2));
      if (!opts.json) {
        console.log(chalk.gray(`  - .refarm/identity.json (identity metadata)`));
      }

      // 4. Write config
      const config = {
        ...result.config,
        brand: { name, slug: name.toLowerCase().replace(/\s+/g, "-") }
      };
      writeFileSync(path.join(projectDir, "refarm.config.json"), JSON.stringify(config, null, 2));
      if (!opts.json) {
        console.log(chalk.gray(`  - refarm.config.json`));
      }
    }

    if (opts.json) {
      const sowCommand = workspaceCommand(projectDir, "refarm sow");
      const modelCurrentCommand = workspaceCommand(projectDir, "refarm model current --json");
      const guideCommand = workspaceCommand(projectDir, "refarm guide --json");
      printJson(
        buildJsonSuccessEnvelope({
          command: "init",
          operation: "scaffold",
          nextAction: `cd ${name} && refarm sow`,
          nextActions: [
            `cd ${name} && refarm sow`,
            "refarm model current",
            "refarm guide",
          ],
          nextCommand: sowCommand,
          nextCommands: [
            sowCommand,
            modelCurrentCommand,
            guideCommand,
          ],
          extra: {
            schemaVersion: INIT_SCHEMA_VERSION,
            status: "initialized",
            projectDir,
            configPath,
            identityPath,
          },
        }),
      );
      return;
    }

    console.log(chalk.blue("\nProject structure initialized."));
    console.log(`\nNext step: cd into ${chalk.cyan(name)} and run ${chalk.cyan("refarm sow")} to configure model credentials.`);
    console.log(chalk.dim(`Then run ${chalk.cyan("refarm guide")} for GitHub/Cloudflare setup hints.`));
  });
