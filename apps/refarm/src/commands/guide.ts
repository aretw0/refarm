import { Command } from "commander";
import chalk from "chalk";
import { writeFileSync } from "node:fs";
import {
  DEFAULT_MODEL_PROVIDER,
  defaultProviderModelRef,
  loadConfig,
  modelCredentialStatus,
} from "@refarm.dev/config";
import { SiloCore } from "@refarm.dev/silo";

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export const guideCommand = new Command("guide")
  .description("Generate a local refarm-audit.md setup report")
  .addHelpText(
    "after",
    [
      "",
      "Examples:",
      "  $ refarm guide",
      "  $ refarm sow",
      "  $ refarm sow --cloudflare",
      "  $ refarm model current",
      "  $ refarm health",
      "",
      "Notes:",
      "  This writes refarm-audit.md in the current directory.",
      "  The report is a local setup audit; it is not a runtime readiness check.",
      "  It checks model, GitHub, Cloudflare, and brand setup and prints the",
      "  next refarm command for each missing item.",
      "  Use refarm health for deterministic project diagnostics.",
    ].join("\n"),
  )
  .action(async () => {
    console.log(chalk.blue("Generating setup audit..."));

    const config = loadConfig();
    const silo = new SiloCore(config);
    const infraTokens = await silo.provision("object") as unknown as Record<
      string,
      unknown
    >;
    const modelTokens = await silo.loadTokens() as Record<string, unknown>;
    const modelProvider =
      stringValue(modelTokens.modelProvider) ?? DEFAULT_MODEL_PROVIDER;
    const modelRef = defaultProviderModelRef(modelProvider);
    const modelStatus = modelCredentialStatus(
      modelProvider,
      modelTokens,
      process.env,
    );
    const modelReady = modelStatus.state !== "missing";

    const checks = [
      {
        name: "Model Credentials",
        status: modelReady ? "✅" : "❌",
        action: modelReady
          ? `Inspect route with 'refarm model current' (${modelRef}).`
          : `Run 'refarm sow' to configure ${modelRef}.`,
      },
      {
        name: "GITHUB_TOKEN",
        status: infraTokens.REFARM_GITHUB_TOKEN ? "✅" : "❌",
        action: "Run 'refarm sow --github' to add your PAT.",
      },
      {
        name: "CLOUDFLARE_API_TOKEN",
        status: infraTokens.REFARM_CLOUDFLARE_API_TOKEN ? "✅" : "❌",
        action: "Run 'refarm sow --cloudflare' to add your API token.",
      },
      {
        name: "Brand Config",
        status: config.brand ? "✅" : "❌",
        action: "Check your refarm.config.json.",
      },
    ];

    let guideContent = `# Setup Audit — refarm\n\nDynamically generated based on your current state.\n\n## Status Summary\n\n`;

    guideContent += `| Item | Status | Required Action |\n|------|--------|-----------------|\n`;
    for (const check of checks) {
      guideContent += `| ${check.name} | ${check.status} | ${check.action} |\n`;
    }

    guideContent += `\n\n## Next Steps\n\n`;
    const missing = checks.filter((check) => check.status === "❌");
    if (missing.length > 0) {
      guideContent += `Follow the actions in the table above to complete setup.\n`;
    } else {
      guideContent += `Your workspace is ready. Run the health checks to verify your infrastructure.\n`;
    }

    writeFileSync("refarm-audit.md", guideContent);
    console.log(chalk.green("refarm-audit.md written."));
  });
