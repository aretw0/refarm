import {
	FileSystemAuditor,
	HealthCore,
	ProjectAuditor,
	RefarmProjectAuditor,
} from "@refarm.dev/health";
import chalk from "chalk";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import {
	buildDiagnosticNextActionPayload,
	diagnosticNextActions,
	type DiagnosticRecommendation,
} from "./diagnostic-recommendations.js";
import { RUNTIME_DOCTOR_NEXT_ACTION_COMMAND } from "./runtime-recovery.js";

export interface HealthIssue {
  file?: string;
  package?: string;
  type: string;
  entry?: string;
}

export interface HealthRecommendation extends DiagnosticRecommendation {
  issueType: string;
}

export interface HealthResults {
  git: HealthIssue[];
  builds: HealthIssue[];
  alignment: HealthIssue[];
}

export interface ResolutionStatus {
  package: string;
  mode: string;
}

export interface HealthReport {
  ok: boolean;
  issueCount: number;
  results: HealthResults;
  resolution: ResolutionStatus[];
  recommendations: HealthRecommendation[];
  nextActions: string[];
}

interface HealthOptions {
  json?: boolean;
  nextAction?: boolean;
  failOnIssues?: boolean;
}

interface HealthPolicy {
  preset: "refarm" | "workspace";
  workspaceRoots?: string[];
  exemptPackageIds?: string[];
  ignoredGitVisibilityPatterns: string[];
  title?: string;
}

interface RefarmConfig {
  health?: {
    preset?: "refarm" | "workspace";
    workspaceRoots?: unknown;
    exemptPackageIds?: unknown;
    ignoredGitVisibilityPatterns?: unknown;
    title?: unknown;
  };
}

const REFARM_DEFAULT_IGNORED_GIT_VISIBILITY_PATTERNS = [
  "**/*.d.ts",
  "packages/pi-agent/src/bindings.rs",
];

export function buildHealthReport(
  results: HealthResults,
  resolution: ResolutionStatus[],
): HealthReport {
  const issueCount = results.git.length + results.builds.length + results.alignment.length;
  const recommendations = buildHealthRecommendations(results);
  return {
    ok: issueCount === 0,
    issueCount,
    results,
    resolution,
    recommendations,
    nextActions: diagnosticNextActions(recommendations),
  };
}

export function buildHealthRecommendations(results: HealthResults): HealthRecommendation[] {
  return [
    ...results.git.map((issue) => ({
      issueType: issue.type,
      diagnostic: issue.type,
      target: issue.file,
      summary: `${issue.file ?? "A source file"} is ignored by Git.`,
      action: "Track the source file, or add an explicit health policy exclusion if it is generated.",
    })),
    ...results.builds.map((issue) => ({
      issueType: issue.type,
      diagnostic: issue.type,
      target: issue.package,
      summary: `${issue.package ?? "A workspace package"} is missing a build config.`,
      action: "Add the package build configuration or mark the package exempt in the project health policy.",
    })),
    ...results.alignment.map((issue) => ({
      issueType: issue.type,
      diagnostic: issue.type,
      target: issue.package,
      summary: `${issue.package ?? "A workspace package"} resolves to ${issue.entry ?? "source"} instead of its build output.`,
      action: "Point package entrypoints at build output, or run the project's configured resolution-alignment workflow.",
    })),
  ];
}

export function resolveHealthPolicy(rootDir = process.cwd()): HealthPolicy {
  const configPath = path.join(rootDir, "refarm.config.json");
  const fallback: HealthPolicy = {
    preset: "refarm",
    ignoredGitVisibilityPatterns: REFARM_DEFAULT_IGNORED_GIT_VISIBILITY_PATTERNS,
  };

  if (!fs.existsSync(configPath)) {
    return fallback;
  }

  let config: RefarmConfig;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as RefarmConfig;
  } catch {
    return fallback;
  }

  if (!config.health) {
    return fallback;
  }

  const health = config.health;
  const preset = health.preset === "refarm" ? "refarm" : "workspace";
  const ignoredGitVisibilityPatterns = asStringArray(health.ignoredGitVisibilityPatterns);
  const policy: HealthPolicy = {
    preset,
    ignoredGitVisibilityPatterns: ignoredGitVisibilityPatterns.length > 0
      ? ignoredGitVisibilityPatterns
      : preset === "refarm"
        ? REFARM_DEFAULT_IGNORED_GIT_VISIBILITY_PATTERNS
        : [],
  };

  const workspaceRoots = asStringArray(health.workspaceRoots);
  if (workspaceRoots.length > 0) policy.workspaceRoots = workspaceRoots;

  const exemptPackageIds = asStringArray(health.exemptPackageIds);
  if (exemptPackageIds.length > 0) policy.exemptPackageIds = exemptPackageIds;

  if (typeof health.title === "string" && health.title.trim()) {
    policy.title = health.title;
  }

  return policy;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function emitHealthJson(report: HealthReport): void {
  console.log(JSON.stringify(report, null, 2));
}

function emitHealthNextActionJson(report: HealthReport): void {
  console.log(JSON.stringify(buildDiagnosticNextActionPayload({
    ok: report.ok,
    nextActions: report.nextActions,
  }), null, 2));
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
    console.log(chalk.bold("\nRecommendations"));
    report.recommendations.forEach((recommendation) => {
      const target = recommendation.target ? ` (${recommendation.target})` : "";
      console.log(chalk.gray(`   - ${recommendation.summary}${target}`));
      console.log(chalk.gray(`     ${recommendation.action}`));
    });
  }
}

export async function runHealthAudit(): Promise<HealthReport> {
  const policy = resolveHealthPolicy();
  const health = new HealthCore();
  health.register(new FileSystemAuditor({
    ignoredGitVisibilityPatterns: policy.ignoredGitVisibilityPatterns,
  }));
  health.register(
    policy.preset === "refarm"
      ? new RefarmProjectAuditor(policy)
      : new ProjectAuditor(policy),
  );

  const results = await health.audit() as HealthResults;
  const resolution = await health.checkResolutionStatus() as ResolutionStatus[];
  return buildHealthReport(results, resolution);
}

export const healthCommand = new Command("health")
  .description("Run deterministic diagnostics on the project")
  .addHelpText(
    "after",
    [
      "",
      "Examples:",
      "  $ refarm health",
      "  $ refarm health --json",
      "  $ refarm health --next-action",
      "  $ refarm health --next-action --json",
      "  $ refarm health --fail-on-issues",
      "",
      "Notes:",
      "  Health audits filesystem source visibility, build configuration, and package entrypoint alignment.",
      "  It does not require the Refarm runtime sidecar.",
      `  Use ${RUNTIME_DOCTOR_NEXT_ACTION_COMMAND} for host/runtime recovery steps.`,
      "  Project-specific policy can live under health in refarm.config.json.",
    ].join("\n"),
  )
  .option("--json", "Output machine-readable health report")
  .option("--next-action", "Print only the first blocking recovery action")
  .option("--fail-on-issues", "Exit non-zero when health issues are found")
  .action(async (options: HealthOptions) => {
    const report = await runHealthAudit();

    if (options.nextAction && options.json) {
      emitHealthNextActionJson(report);
    } else if (options.nextAction) {
      const [action] = report.nextActions;
      if (action) console.log(action);
    } else if (options.json) {
      emitHealthJson(report);
    } else {
      emitHealthSummary(report);
    }

    if (options.failOnIssues && !report.ok) {
      process.exitCode = 1;
    }
  });
