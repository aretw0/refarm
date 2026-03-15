import { Command } from "commander";
import chalk from "chalk";
import { writeFileSync } from "node:fs";
import { loadConfig } from "@refarm.dev/config";
import { SiloCore } from "@refarm.dev/silo";

export const guideCommand = new Command("guide")
  .description("Generate or update the dynamic SETUP_GUIDE.md")
  .action(async () => {
    console.log(chalk.blue("📖 Generating your Sovereign Setup Audit..."));

    const config = loadConfig() as any;
    const silo = new SiloCore(config);
    const tokens = silo.provision("object") as any;

    const checks = [
      { name: "GITHUB_TOKEN", status: tokens.REFARM_GITHUB_TOKEN ? "✅" : "❌", action: "Run 'refarm sow' to add your PAT." },
      { name: "CLOUDFLARE_API_TOKEN", status: tokens.REFARM_CLOUDFLARE_API_TOKEN ? "✅" : "❌", action: "Run 'refarm sow' to add your API Token." },
      { name: "Brand Config", status: config.brand ? "✅" : "❌", action: "Check your refarm.config.json" }
    ];

    let guideContent = `# Sovereign Setup Audit (Refarm)\n\nThis guide is dynamically generated based on your current state.\n\n## Status Summary\n\n`;
    
    guideContent += `| Nutrient | Status | Required Action |\n|----------|--------|-----------------|\n`;
    for (const check of checks) {
      guideContent += `| ${check.name} | ${check.status} | ${check.action} |\n`;
    }

    guideContent += `\n\n## Next Steps\n\n`;
    const missing = checks.filter(c => c.status === "❌");
    if (missing.length > 0) {
      guideContent += `Follow the actions in the table above to complete your seeding.\n`;
    } else {
      guideContent += `Your soil is ready! Run \`refarm harvest\` to verify your infrastructure.\n`;
    }

    writeFileSync("Sovereign_Setup_Audit.md", guideContent);
    console.log(chalk.green("✨ Sovereign_Setup_Audit.md updated. Check it out!"));
  });
