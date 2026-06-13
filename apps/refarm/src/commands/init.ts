import { defaultRefarmConfigPath } from "@refarm.dev/config";
import { createStdioOperatorChannel } from "@refarm.dev/prompt-contract-v1";
import { SiloCore } from "@refarm.dev/silo";
import { SowerCore } from "@refarm.dev/sower";
import chalk from "chalk";
import { Command } from "commander";
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
  template?: string;
}

const INIT_SCHEMA_VERSION = 1;

interface InitCommandDeps {
  cwd?: () => string;
  createOperator?: () => {
    ask: (prompt: {
      type: "select";
      question: string;
      default: string;
      options: Array<{ label: string; value: string }>;
    }) => Promise<string>;
  };
  createSilo?: () => {
    bootstrapIdentity: () => Promise<{ publicKey: string; timestamp: string }>;
  };
  createSower?: () => {
    scaffold: (
      template: string,
      options: { name: string; targetDir: string },
    ) => Promise<{ config: Record<string, unknown> } | null | undefined>;
  };
  existsSync?: typeof existsSync;
  mkdirSync?: typeof mkdirSync;
  writeFileSync?: typeof writeFileSync;
}

function initForceCommand(name: string): string {
  return refarmCommand(["init", quoteCommandArg(name), "--force"]);
}

export function createInitCommand(deps: InitCommandDeps = {}): Command {
  const cwd = deps.cwd ?? (() => process.cwd());
  const createOperator = deps.createOperator ?? createStdioOperatorChannel;
  const createSower = deps.createSower ?? (() => new SowerCore());
  const createSilo = deps.createSilo ?? (() => new SiloCore());
  const fileExists = deps.existsSync ?? existsSync;
  const makeDir = deps.mkdirSync ?? mkdirSync;
  const writeFile = deps.writeFileSync ?? writeFileSync;

  return new Command("init")
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
      "  $ refarm init my-workspace --template workspace --json",
      "",
      "Notes:",
      "  This creates .refarm/config.json and .refarm/identity.json.",
      "  The workspace identity is metadata; operator credentials are saved later",
      "  under ~/.refarm/identity.json by refarm sow.",
      "  --force reinitializes an existing workspace and can overwrite generated metadata.",
      "  --template skips the interactive template prompt; supported values include workspace and rust-plugin.",
      "  After init, run refarm sow to configure model credentials.",
      "  Use refarm model current to inspect the default route, and refarm guide",
      "  to generate a local setup audit with GitHub/Cloudflare next steps.",
    ].join("\n"),
  )
  .argument("[name]", "Project name", "my-workspace")
  .option("--force", "Reinitialize even if already initialized (destructive)")
  .option("--json", "Output machine-readable initialization result")
  .option("--template <id>", "Template to scaffold without prompting")
  .action(async (name, opts: InitOptions) => {
    const projectDir = name === "." ? cwd() : path.join(cwd(), name);
    const configPath = defaultRefarmConfigPath(projectDir);
    const identityPath = path.join(projectDir, ".refarm", "identity.json");

    if (!opts.force && (fileExists(configPath) || fileExists(identityPath))) {
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

    const template = opts.template ?? await createOperator().ask({
      type: "select",
      question: "Choose a template to start with",
      default: "workspace",
      options: [
        { label: "Workspace App", value: "workspace" },
        { label: "Rust Plugin (Heartwood)", value: "rust-plugin" },
      ],
    });

    const core = createSower();
    
    if (!fileExists(projectDir)) {
        makeDir(projectDir, { recursive: true });
    }

    const result = await core.scaffold(template, { name, targetDir: projectDir });

    if (result) {
      const refarmDir = path.join(projectDir, ".refarm");
      // 1. Create directories
      if (!fileExists(refarmDir)) {
        makeDir(refarmDir, { recursive: true });
      }
      
      if (!opts.json) {
        console.log(chalk.blue("Generating workspace identity..."));
      }
      const silo = createSilo();
      const identity = await silo.bootstrapIdentity();


      // 3. Write identity metadata
      const identityMetadata = {
        publicKey: identity.publicKey,
        bootstrappedAt: identity.timestamp,
        name
      };
      writeFile(path.join(refarmDir, "identity.json"), JSON.stringify(identityMetadata, null, 2));
      if (!opts.json) {
        console.log(chalk.gray(`  - .refarm/identity.json (identity metadata)`));
      }

      // 4. Write config
      const config = {
        ...result.config,
        brand: { name, slug: name.toLowerCase().replace(/\s+/g, "-") }
      };
      writeFile(configPath, JSON.stringify(config, null, 2));
      if (!opts.json) {
        console.log(chalk.gray(`  - .refarm/config.json`));
      }
    }

    if (opts.json) {
      const sowCommand = workspaceCommand(projectDir, "refarm sow --json");
      const modelCurrentCommand = workspaceCommand(projectDir, "refarm model current --json");
      const guideCommand = workspaceCommand(projectDir, "refarm guide --json");
      printJson(
        buildJsonSuccessEnvelope({
          command: "init",
          operation: "scaffold",
          nextAction: sowCommand,
          nextActions: [
            sowCommand,
            modelCurrentCommand,
            guideCommand,
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
}

export const initCommand = createInitCommand();
