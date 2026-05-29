import {
	DEFAULT_MODEL_PROVIDER,
	defaultProviderModelRef,
	effectiveModelRouteForScope,
	loadConfig,
	modelCredentialStatus,
} from "@refarm.dev/config";
import { SiloCore } from "@refarm.dev/silo";
import chalk from "chalk";
import { Command } from "commander";
import { writeFileSync } from "node:fs";
import { refarmCommand } from "./command-handoff.js";
import { printJson } from "./json-output.js";

interface GuideOptions {
  json?: boolean;
}

interface GuideConfig {
  brand?: unknown;
}

interface GuideSilo {
  provision(scope: "object"): Promise<unknown>;
  loadTokens(): Promise<unknown>;
}

export interface GuideDeps {
  env(): NodeJS.ProcessEnv;
  loadConfig(): GuideConfig;
  createSilo(config: GuideConfig): GuideSilo;
  writeFile(path: string, content: string): void;
}

interface GuideCheck {
  id: string;
  name: string;
  ok: boolean;
  status: "ready" | "missing";
  action: string;
  actionCommand?: string;
}

interface GuideReport {
  schemaVersion: 1;
  command: "guide";
  operation: "audit";
  outputPath: string;
  ok: boolean;
  checks: GuideCheck[];
  nextAction: string | null;
  nextActions: string[];
  nextCommand: string | null;
  nextCommands: string[];
}

function renderGuideMarkdown(report: GuideReport): string {
  let guideContent = `# Setup Audit — refarm\n\nDynamically generated based on your current state.\n\n## Status Summary\n\n`;

  guideContent += `| Item | Status | Required Action |\n|------|--------|-----------------|\n`;
  for (const check of report.checks) {
    guideContent += `| ${check.name} | ${check.ok ? "✅" : "❌"} | ${check.action} |\n`;
  }

  guideContent += `\n\n## Next Steps\n\n`;
  if (report.nextActions.length > 0) {
    guideContent += `Follow the actions in the table above to complete setup.\n`;
  } else {
    guideContent += `Your workspace is ready. Run the health checks to verify your infrastructure.\n`;
  }

  return guideContent;
}

function defaultGuideDeps(): GuideDeps {
  return {
    env: () => process.env,
    loadConfig,
    createSilo: (config) => new SiloCore(config),
    writeFile: writeFileSync,
  };
}

export function createGuideCommand(deps: GuideDeps = defaultGuideDeps()): Command {
  return new Command("guide")
  .description("Generate a local refarm-audit.md setup report")
  .addHelpText(
    "after",
    [
      "",
      "Examples:",
      "  $ refarm guide",
      "  $ refarm guide --json",
      "  $ refarm sow",
      "  $ refarm sow --cloudflare",
      "  $ refarm model current",
      "  $ refarm health",
      "",
      "Notes:",
      "  This writes refarm-audit.md in the current directory.",
      "  The report is a local setup audit; it is not a runtime readiness check.",
      "  It checks model, GitHub, Cloudflare, and brand setup and prints the",
      "  next operator action and executable follow-up command for missing items.",
      "  Use refarm health for deterministic project diagnostics.",
    ].join("\n"),
  )
  .option("--json", "Output machine-readable setup audit")
  .action(async (options: GuideOptions) => {
    if (!options.json) {
      console.log(chalk.blue("Generating setup audit..."));
    }

    const config = deps.loadConfig();
    const silo = deps.createSilo(config);
    const infraTokens = await silo.provision("object") as unknown as Record<
      string,
      unknown
    >;
    const modelTokens = await silo.loadTokens() as Record<string, unknown>;
    const effectiveModel = effectiveModelRouteForScope(modelTokens, "default", {
      env: deps.env(),
    });
    const modelProvider = effectiveModel.provider ?? DEFAULT_MODEL_PROVIDER;
    const modelRef = effectiveModel.modelId
      ? `${modelProvider}/${effectiveModel.modelId}`
      : defaultProviderModelRef(modelProvider);
    const modelStatus = modelCredentialStatus(
      modelProvider,
      modelTokens,
      deps.env(),
    );
    const modelReady = modelStatus.state !== "missing";

    const checks: GuideCheck[] = [
      {
        id: "model-credentials",
        name: "Model Credentials",
        ok: modelReady,
        status: modelReady ? "ready" : "missing",
        action: modelReady
          ? `Inspect route with 'refarm model current' (${modelRef}).`
          : `Configure model credentials for ${modelRef}.`,
        actionCommand: modelReady
          ? refarmCommand(["model", "current", "--json"])
          : refarmCommand(["model", "providers", "--json"]),
      },
      {
        id: "github-token",
        name: "GITHUB_TOKEN",
        ok: Boolean(infraTokens.REFARM_GITHUB_TOKEN),
        status: infraTokens.REFARM_GITHUB_TOKEN ? "ready" : "missing",
        action: "Configure GitHub credentials interactively.",
        actionCommand: "gh auth status",
      },
      {
        id: "cloudflare-token",
        name: "CLOUDFLARE_API_TOKEN",
        ok: Boolean(infraTokens.REFARM_CLOUDFLARE_API_TOKEN),
        status: infraTokens.REFARM_CLOUDFLARE_API_TOKEN ? "ready" : "missing",
        action: "Configure Cloudflare credentials interactively.",
        actionCommand: refarmCommand(["provision", "cloudflare", "turbo-cache", "--dry-run", "--json"]),
      },
      {
        id: "brand-config",
        name: "Brand Config",
        ok: Boolean(config.brand),
        status: config.brand ? "ready" : "missing",
        action: "Check your refarm.config.json.",
      },
    ];
    const nextActions = checks
      .filter((check) => !check.ok)
      .map((check) => check.action);
    const nextCommands = checks
      .filter((check) => !check.ok)
      .flatMap((check) => check.actionCommand ? [check.actionCommand] : []);
    const report: GuideReport = {
      schemaVersion: 1,
      command: "guide",
      operation: "audit",
      outputPath: "refarm-audit.md",
      ok: nextActions.length === 0,
      checks,
      nextAction: nextActions[0] ?? null,
      nextActions,
      nextCommand: nextCommands[0] ?? null,
      nextCommands,
    };

    if (options.json) {
      printJson(report);
      return;
    }

    const guideContent = renderGuideMarkdown(report);
    deps.writeFile("refarm-audit.md", guideContent);
    console.log(chalk.green("refarm-audit.md written."));
  });
}

export const guideCommand = createGuideCommand();
