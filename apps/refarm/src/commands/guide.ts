import { Command } from "commander";
import chalk from "chalk";
import { writeFileSync } from "node:fs";
import { loadConfig } from "@refarm.dev/config";
import { SiloCore } from "@refarm.dev/silo";

export const guideCommand = new Command("guide")
  .description("Generate a local refarm-audit.md setup report")
  .addHelpText(
    "after",
    [
      "",
      "Examples:",
      "  $ refarm guide",
      "  $ refarm sow",
      "  $ refarm health",
      "",
      "Notes:",
      "  This writes refarm-audit.md in the current directory.",
      "  The report is a local setup audit; it is not a runtime readiness check.",
      "  Use refarm health for deterministic project diagnostics.",
    ].join("\n"),
  )
  .action(async () => {
    console.log(chalk.blue("Generating setup audit..."));

    const config = loadConfig();
    const silo = new SiloCore(config);
    const tokens = silo.provision("object") as unknown as Record<string, unknown>;

    const checks = [
      { name: "GITHUB_TOKEN", status: tokens.REFARM_GITHUB_TOKEN ? "✅" : "❌", action: "Run 'refarm sow' to add your PAT." },
      { name: "CLOUDFLARE_API_TOKEN", status: tokens.REFARM_CLOUDFLARE_API_TOKEN ? "✅" : "❌", action: "Run 'refarm sow' to add your API Token." },
      { name: "Brand Config", status: config.brand ? "✅" : "❌", action: "Check your refarm.config.json" }
    ];

    let guideContent = `# Setup Audit — refarm\n\nDynamically generated based on your current state.\n\n## Status Summary\n\n`;
    
    guideContent += `| Item | Status | Required Action |\n|------|--------|-----------------|\n`;
    for (const check of checks) {
      guideContent += `| ${check.name} | ${check.status} | ${check.action} |\n`;
    }

    guideContent += `\n\n## Next Steps\n\n`;
    const missing = checks.filter(c => c.status === "❌");
    if (missing.length > 0) {
      guideContent += `Follow the actions in the table above to complete setup.\n`;
    } else {
      guideContent += `Your workspace is ready. Run the health checks to verify your infrastructure.\n`;
    }

    writeFileSync("refarm-audit.md", guideContent);
    console.log(chalk.green("refarm-audit.md written."));
  });
