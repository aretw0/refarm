import { HealthCore } from "@refarm.dev/health";
import chalk from "chalk";
import { Command } from "commander";

interface HealthIssue {
  file?: string;
  package?: string;
  type: string;
  entry?: string;
}

export const healthCommand = new Command("health")
  .description("Run deterministic diagnostics on the Sovereign Project")
  .action(async () => {
    console.log(chalk.blue("🔍 Running Sovereign Health Audit...\n"));

    const health = new HealthCore();
    const results = await health.audit() as { git: HealthIssue[], builds: HealthIssue[], alignment: HealthIssue[] };
    const resonance = await health.checkResolutionStatus() as { package: string, mode: string }[];

    let issueCount = 0;

    // 0. Sovereign Resonance (Resolution Status)
    console.log(chalk.bold("Sovereign Resonance (Resolution Mode)"));
    resonance.forEach(item => {
      const modeColor = item.mode.includes("LOCAL") ? chalk.yellow : chalk.green;
      console.log(`   - ${chalk.bold(item.package.padEnd(25))} : ${modeColor(item.mode)}`);
    });
    console.log("");

    // 1. Git Ignore Audit
    console.log(chalk.bold("1. Git Source Visibility"));
    if (results.git.length === 0) {
      console.log(chalk.green("   ✅ All source files are visible to Git."));
    } else {
      results.git.forEach((issue: HealthIssue) => {
        console.log(chalk.red(`   ❌ ${issue.file} is incorrectly ignored.`));
        issueCount++;
      });
    }

    // 2. Build Config Audit
    console.log(chalk.bold("\n2. Build Pipeline Alignment"));
    if (results.builds.length === 0) {
      console.log(chalk.green("   ✅ All packages have tsconfig.build.json."));
    } else {
      results.builds.forEach((issue: HealthIssue) => {
        console.log(chalk.yellow(`   ⚠️  Package ${issue.package} is missing tsconfig.build.json.`));
        issueCount++;
      });
    }

    // 3. Package Entrypoints Audit
    console.log(chalk.bold("\n3. Package Distribution Alignment"));
    if (results.alignment.length === 0) {
      console.log(chalk.green("   ✅ All package entrypoints are dist-aligned."));
    } else {
      results.alignment.forEach((issue: HealthIssue) => {
        console.log(chalk.yellow(`   ⚠️  Package ${issue.package} main points to ${issue.entry} instead of dist/.`));
        issueCount++;
      });
    }

    if (issueCount === 0) {
      console.log(chalk.bold.green("\n✨ Project health is excellent. Soil is rich."));
    } else {
      console.log(chalk.bold.yellow(`\n⚠️ Found ${issueCount} health issues. Please review and reconcile.`));
    }
  });
