import { HealthCore, FileSystemAuditor, RefarmProjectAuditor } from "@refarm.dev/health";
import chalk from "chalk";
import { Command } from "commander";

interface HealthIssue {
  file?: string;
  package?: string;
  type: string;
  entry?: string;
}

interface HealthResults {
  git: HealthIssue[];
  builds: HealthIssue[];
  alignment: HealthIssue[];
}

interface ResolutionStatus {
  package: string;
  mode: string;
}

interface HealthReport {
  ok: boolean;
  issueCount: number;
  results: HealthResults;
  resolution: ResolutionStatus[];
}

interface HealthOptions {
  json?: boolean;
  failOnIssues?: boolean;
}

export function buildHealthReport(
  results: HealthResults,
  resolution: ResolutionStatus[],
): HealthReport {
  const issueCount = results.git.length + results.builds.length + results.alignment.length;
  return {
    ok: issueCount === 0,
    issueCount,
    results,
    resolution,
  };
}

function emitHealthJson(report: HealthReport): void {
  console.log(JSON.stringify(report, null, 2));
}

function emitHealthSummary(report: HealthReport): void {
  console.log(chalk.blue("🔍 Running health audit...\n"));

  // 0. Resolution status
  console.log(chalk.bold("Package Resolution"));
  report.resolution.forEach(item => {
    const modeColor = item.mode.includes("LOCAL (src)") ? chalk.yellow : chalk.green;
    console.log(`   - ${chalk.bold(item.package.padEnd(25))} : ${modeColor(item.mode)}`);
  });
  console.log("");

  // 1. Git visibility
  console.log(chalk.bold("1. Git Source Visibility"));
  if (report.results.git.length === 0) {
    console.log(chalk.green("   ✅ All source files are tracked by Git."));
  } else {
    report.results.git.forEach((issue: HealthIssue) => {
      console.log(chalk.yellow(`   ⚠️  ${issue.file} is a source file but is git-ignored.`));
    });
  }

  // 2. Build config
  console.log(chalk.bold("\n2. Build Pipeline"));
  if (report.results.builds.length === 0) {
    console.log(chalk.green("   ✅ All TypeScript packages have tsconfig.build.json."));
  } else {
    report.results.builds.forEach((issue: HealthIssue) => {
      console.log(chalk.yellow(`   ⚠️  ${issue.package} is missing tsconfig.build.json.`));
    });
  }

  // 3. Entrypoints
  console.log(chalk.bold("\n3. Package Entrypoints"));
  if (report.results.alignment.length === 0) {
    console.log(chalk.green("   ✅ All TypeScript package entrypoints point to dist/."));
  } else {
    report.results.alignment.forEach((issue: HealthIssue) => {
      console.log(chalk.yellow(`   ⚠️  ${issue.package} main points to ${issue.entry} instead of dist/.`));
    });
  }

  if (report.ok) {
    console.log(chalk.bold.green("\n✨ All checks passed."));
  } else {
    console.log(chalk.bold.yellow(`\n⚠️  ${report.issueCount} issue${report.issueCount === 1 ? "" : "s"} found. Review and reconcile.`));
  }
}

export const healthCommand = new Command("health")
  .description("Run deterministic diagnostics on the project")
  .option("--json", "Output machine-readable health report")
  .option("--fail-on-issues", "Exit non-zero when health issues are found")
  .action(async (options: HealthOptions) => {
    const health = new HealthCore();
    health.register(new FileSystemAuditor());
    health.register(new RefarmProjectAuditor());

    const results = await health.audit() as HealthResults;
    const resolution = await health.checkResolutionStatus() as ResolutionStatus[];
    const report = buildHealthReport(results, resolution);

    if (options.json) {
      emitHealthJson(report);
    } else {
      emitHealthSummary(report);
    }

    if (options.failOnIssues && !report.ok) {
      process.exitCode = 1;
    }
  });
