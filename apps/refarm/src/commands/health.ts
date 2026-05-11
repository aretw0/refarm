import { HealthCore, FileSystemAuditor, RefarmProjectAuditor } from "@refarm.dev/health";
import chalk from "chalk";
import { Command } from "commander";

interface HealthIssue {
  file?: string;
  package?: string;
  type: string;
  entry?: string;
}

export const healthCommand = new Command("health")
  .description("Run deterministic diagnostics on the project")
  .action(async () => {
    console.log(chalk.blue("🔍 Running health audit...\n"));

    const health = new HealthCore();
    health.register(new FileSystemAuditor());
    health.register(new RefarmProjectAuditor());

    const results = await health.audit() as { git: HealthIssue[], builds: HealthIssue[], alignment: HealthIssue[] };
    const resolution = await health.checkResolutionStatus() as { package: string, mode: string }[];

    let issueCount = 0;

    // 0. Resolution status
    console.log(chalk.bold("Package Resolution"));
    resolution.forEach(item => {
      const modeColor = item.mode.includes("LOCAL (src)") ? chalk.yellow : chalk.green;
      console.log(`   - ${chalk.bold(item.package.padEnd(25))} : ${modeColor(item.mode)}`);
    });
    console.log("");

    // 1. Git visibility
    console.log(chalk.bold("1. Git Source Visibility"));
    if (results.git.length === 0) {
      console.log(chalk.green("   ✅ All source files are tracked by Git."));
    } else {
      results.git.forEach((issue: HealthIssue) => {
        console.log(chalk.yellow(`   ⚠️  ${issue.file} is a source file but is git-ignored.`));
        issueCount++;
      });
    }

    // 2. Build config
    console.log(chalk.bold("\n2. Build Pipeline"));
    if (results.builds.length === 0) {
      console.log(chalk.green("   ✅ All TypeScript packages have tsconfig.build.json."));
    } else {
      results.builds.forEach((issue: HealthIssue) => {
        console.log(chalk.yellow(`   ⚠️  ${issue.package} is missing tsconfig.build.json.`));
        issueCount++;
      });
    }

    // 3. Entrypoints
    console.log(chalk.bold("\n3. Package Entrypoints"));
    if (results.alignment.length === 0) {
      console.log(chalk.green("   ✅ All TypeScript package entrypoints point to dist/."));
    } else {
      results.alignment.forEach((issue: HealthIssue) => {
        console.log(chalk.yellow(`   ⚠️  ${issue.package} main points to ${issue.entry} instead of dist/.`));
        issueCount++;
      });
    }

    if (issueCount === 0) {
      console.log(chalk.bold.green("\n✨ All checks passed."));
    } else {
      console.log(chalk.bold.yellow(`\n⚠️  ${issueCount} issue${issueCount === 1 ? "" : "s"} found. Review and reconcile.`));
    }
  });
