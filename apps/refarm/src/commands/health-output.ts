import chalk from "chalk";
import type { HealthPolicyReport } from "./health-policy.js";
import type {
	HealthIssue,
	HealthPolicyApplicationReport,
	HealthPolicySuggestionReport,
	HealthReport,
} from "./health.js";

export function emitHealthSummary(report: HealthReport): void {
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

  console.log(chalk.bold("\n4. Project Automations"));
  if (!report.results.automations || report.results.automations.length === 0) {
    console.log(chalk.green("   ✅ Project automation manifest is valid or absent."));
  } else {
    report.results.automations.forEach((issue: HealthIssue) => {
      console.log(chalk.yellow(`   ⚠️  ${issue.file} ${issue.note ?? "has an invalid automation entry."}`));
    });
  }

  console.log(chalk.bold("\n5. Complexity Pressure"));
  if (!report.results.complexity) {
    console.log(chalk.gray("   Not enabled in health policy."));
  } else if (report.results.complexity.length === 0) {
    console.log(chalk.green("   ✅ No blocking large files found."));
  } else {
    report.results.complexity.forEach((issue: HealthIssue) => {
      console.log(chalk.yellow(`   ⚠️  ${issue.file} has ${issue.lines} lines.`));
    });
  }

  console.log(chalk.bold("\n6. Workspace Namespaces"));
  if (!report.results.namespaceWarnings || report.results.namespaceWarnings.length === 0) {
    console.log(chalk.green("   ✅ Versioned root namespaces are declared or conventional infrastructure."));
  } else {
    report.results.namespaceWarnings.forEach((issue: HealthIssue) => {
      console.log(chalk.yellow(`   ⚠️  ${issue.path} ${issue.note ?? "is undeclared."}`));
    });
  }

  if (report.ok) {
    console.log(chalk.bold.green("\n✨ All checks passed."));
  } else {
    console.log(chalk.bold.yellow(`\n⚠️  ${report.issueCount} issue${report.issueCount === 1 ? "" : "s"} found. Review and reconcile.`));
    console.log(chalk.bold("\nRecommendations"));
    report.recommendations.forEach((recommendation) => {
      const target = recommendation.target ? ` (${recommendation.target})` : "";
      console.log(chalk.gray(`   - ${recommendation.summary}${target}`));
      console.log(chalk.gray(`     ${recommendation.action}`));
      if (recommendation.command) {
        console.log(chalk.gray(`     ${recommendation.command}`));
      }
    });
  }
}

export function emitHealthPolicySummary(report: HealthPolicyReport): void {
  console.log(chalk.bold("Health Policy"));
  console.log(`   Source: ${report.source}`);
  console.log(`   Config: ${report.configFound ? report.configPath : "not found"}`);
  console.log(`   Preset: ${report.policy.preset}`);
  if (report.policy.workspaceRoots?.length) {
    console.log(`   Workspace roots: ${report.policy.workspaceRoots.join(", ")}`);
  }
  if (report.policy.exemptPackageIds?.length) {
    console.log(`   Exempt packages: ${report.policy.exemptPackageIds.join(", ")}`);
  }
  if (report.policy.ignoredGitVisibilityPatterns.length) {
    console.log(`   Ignored git visibility patterns: ${report.policy.ignoredGitVisibilityPatterns.join(", ")}`);
  }
  if (report.policy.workspaceNamespaces?.length) {
    console.log(`   Workspace namespaces: ${report.policy.workspaceNamespaces.map((namespace) => namespace.path).join(", ")}`);
  }
  if (report.policy.complexity?.enabled) {
    console.log(`   Complexity max lines: ${report.policy.complexity.maxLines}`);
    if (report.policy.complexity.paths?.length) {
      console.log(`   Complexity paths: ${report.policy.complexity.paths.join(", ")}`);
    }
    if (report.policy.complexity.allowedPatterns.length) {
      console.log(`   Complexity allowed patterns: ${report.policy.complexity.allowedPatterns.join(", ")}`);
    }
  }
}

export function emitHealthPolicySuggestionSummary(report: HealthPolicySuggestionReport): void {
  console.log(chalk.bold("Health Policy Suggestion"));
  console.log(`   Source issues: ${report.sourceIssueCount}`);
  console.log(JSON.stringify({ health: report.suggestedHealth }, null, 2));
}

export function emitHealthPolicyApplicationSummary(report: HealthPolicyApplicationReport): void {
  console.log(chalk.green("Health policy applied"));
  console.log(chalk.dim(`   ${report.configPath}`));
  console.log(JSON.stringify({ health: report.appliedHealth }, null, 2));
}
