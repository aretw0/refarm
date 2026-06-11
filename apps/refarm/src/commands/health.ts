import {
	defaultRefarmConfigPath,
	findRefarmConfigPath,
} from "@refarm.dev/config";
import {
	ComplexityAuditor,
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
	diagnosticNextCommands,
	type DiagnosticRecommendation,
} from "./diagnostic-recommendations.js";
import { printJson } from "./json-output.js";
import { assertAtMostOneFlagEnabled } from "./option-guards.js";
import { RUNTIME_DOCTOR_NEXT_ACTION_COMMAND } from "./runtime-recovery.js";

export interface HealthIssue {
  file?: string;
  package?: string;
  type: string;
  entry?: string;
  category?: string;
  lines?: number;
  size?: number;
  allowed?: boolean;
  note?: string;
}

export interface HealthRecommendation extends DiagnosticRecommendation {
  issueType: string;
}

export interface HealthResults {
  git: HealthIssue[];
  builds: HealthIssue[];
  alignment: HealthIssue[];
  complexity?: HealthIssue[];
  complexitySummary?: unknown;
}

export interface ResolutionStatus {
  package: string;
  mode: string;
}

export interface HealthReport {
  command: "health";
  operation: "audit";
  ok: boolean;
  issueCount: number;
  results: HealthResults;
  resolution: ResolutionStatus[];
  recommendations: HealthRecommendation[];
  nextAction: string | null;
  nextActions: string[];
  nextCommand: string | null;
  nextCommands: string[];
}

export interface HealthPolicyReport {
  command: "health";
  operation: "policy";
  ok: true;
  rootDir: string;
  configPath: string;
  configFound: boolean;
  source: "config" | "refarm-default" | "workspace-default";
  policy: HealthPolicy;
  nextAction: null;
  nextActions: [];
  nextCommand: null;
  nextCommands: [];
}

export interface HealthPolicySuggestionReport {
  command: "health";
  operation: "policy-suggestion";
  ok: true;
  policy: HealthPolicy;
  suggestedHealth: HealthPolicy;
  sourceIssueCount: number;
  nextAction: string | null;
  nextActions: string[];
  nextCommand: string | null;
  nextCommands: string[];
}

export interface HealthPolicyApplicationReport {
  command: "health";
  operation: "policy-application";
  ok: true;
  configPath: string;
  policy: HealthPolicy;
  previousHealth: unknown;
  appliedHealth: HealthPolicy;
  sourceIssueCount: number;
  nextAction: string;
  nextActions: string[];
  nextCommand: string;
  nextCommands: string[];
}

interface HealthOptions {
  json?: boolean;
  nextAction?: boolean;
  nextCommand?: boolean;
  failOnIssues?: boolean;
  policy?: boolean;
  suggestPolicy?: boolean;
  applySuggestedPolicy?: boolean;
}

interface HealthPolicy {
  preset: "refarm" | "workspace";
  workspaceRoots?: string[];
  exemptPackageIds?: string[];
  ignoredGitVisibilityPatterns: string[];
  complexity?: HealthComplexityPolicy;
  title?: string;
}

interface HealthComplexityPolicy {
  enabled: boolean;
  maxLines: number;
  paths?: string[];
  allowedPatterns: string[];
  reportLimit: number;
}

interface RefarmConfig {
  health?: {
    preset?: "refarm" | "workspace";
    workspaceRoots?: unknown;
    exemptPackageIds?: unknown;
    ignoredGitVisibilityPatterns?: unknown;
    complexity?: unknown;
    title?: unknown;
  };
}

const REFARM_DEFAULT_IGNORED_GIT_VISIBILITY_PATTERNS = [
  "**/*.d.ts",
  "packages/pi-agent/src/bindings.rs",
];
const HEALTH_SUGGEST_POLICY_COMMAND = "refarm health --suggest-policy --json";
const HEALTH_NEXT_ACTION_COMMAND = "refarm health --next-action --json";
const RESOLUTION_ALIGNMENT_COMMAND = "node packages/toolbox/src/cli.mjs reso dist";

function looksLikeRefarmMonorepo(rootDir: string): boolean {
  const manifestPath = path.join(rootDir, "apps", "refarm", "package.json");
  if (!fs.existsSync(manifestPath)) return false;

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as { name?: unknown };
    return manifest.name === "@refarm.dev/refarm";
  } catch {
    return false;
  }
}

function defaultHealthPolicy(rootDir: string): HealthPolicy {
  if (looksLikeRefarmMonorepo(rootDir)) {
    return {
      preset: "refarm",
      ignoredGitVisibilityPatterns: REFARM_DEFAULT_IGNORED_GIT_VISIBILITY_PATTERNS,
    };
  }

  return {
    preset: "workspace",
    ignoredGitVisibilityPatterns: [],
  };
}

export function buildHealthReport(
  results: HealthResults,
  resolution: ResolutionStatus[],
): HealthReport {
  const issueCount = results.git.length
    + results.builds.length
    + results.alignment.length
    + (results.complexity?.length ?? 0);
  const recommendations = buildHealthRecommendations(results);
  const nextActions = diagnosticNextActions(recommendations);
  const nextCommands = diagnosticNextCommands(recommendations);
  return {
    command: "health",
    operation: "audit",
    ok: issueCount === 0,
    issueCount,
    results,
    resolution,
    recommendations,
    nextAction: nextActions[0] ?? null,
    nextActions,
    nextCommand: nextCommands[0] ?? null,
    nextCommands,
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
      command: HEALTH_SUGGEST_POLICY_COMMAND,
    })),
    ...results.builds.map((issue) => ({
      issueType: issue.type,
      diagnostic: issue.type,
      target: issue.package,
      summary: `${issue.package ?? "A workspace package"} is missing a build config.`,
      action: "Add the package build configuration or mark the package exempt in the project health policy.",
      command: HEALTH_SUGGEST_POLICY_COMMAND,
    })),
    ...results.alignment.map((issue) => ({
      issueType: issue.type,
      diagnostic: issue.type,
      target: issue.package,
      summary: `${issue.package ?? "A workspace package"} resolves to ${issue.entry ?? "source"} instead of its build output.`,
      action: "Point package entrypoints at build output, or run the project's configured resolution-alignment workflow.",
      command: RESOLUTION_ALIGNMENT_COMMAND,
    })),
    ...(results.complexity ?? []).map((issue) => ({
      issueType: issue.type,
      diagnostic: issue.type,
      target: issue.file,
      summary: `${issue.file ?? "A workspace file"} has ${issue.lines ?? "too many"} lines.`,
      action: "Split the file or add a documented health.complexity allowed pattern for generated/vendor content.",
      command: HEALTH_SUGGEST_POLICY_COMMAND,
    })),
  ];
}

export function resolveHealthPolicy(rootDir = process.cwd()): HealthPolicy {
  return resolveHealthPolicyReport(rootDir).policy;
}

export function resolveHealthPolicyReport(rootDir = process.cwd()): HealthPolicyReport {
  const configPath = findRefarmConfigPath(rootDir) ?? defaultRefarmConfigPath(rootDir);
  const fallback = defaultHealthPolicy(rootDir);
  const fallbackSource = fallback.preset === "refarm" ? "refarm-default" : "workspace-default";

  if (!fs.existsSync(configPath)) {
    return buildHealthPolicyReport({
      rootDir,
      configPath,
      configFound: false,
      source: fallbackSource,
      policy: fallback,
    });
  }

  let config: RefarmConfig;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as RefarmConfig;
  } catch {
    return buildHealthPolicyReport({
      rootDir,
      configPath,
      configFound: true,
      source: fallbackSource,
      policy: fallback,
    });
  }

  if (!config.health) {
    return buildHealthPolicyReport({
      rootDir,
      configPath,
      configFound: true,
      source: fallbackSource,
      policy: fallback,
    });
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

  const complexity = normalizeComplexityPolicy(health.complexity);
  if (complexity) policy.complexity = complexity;

  return buildHealthPolicyReport({
    rootDir,
    configPath,
    configFound: true,
    source: "config",
    policy,
  });
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function asPositiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function normalizeComplexityPolicy(value: unknown): HealthComplexityPolicy | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as {
    enabled?: unknown;
    maxLines?: unknown;
    paths?: unknown;
    allowedPatterns?: unknown;
    reportLimit?: unknown;
  };
  if (input.enabled !== true) return undefined;
  return {
    enabled: true,
    maxLines: asPositiveInteger(input.maxLines, 1000),
    paths: asStringArray(input.paths),
    allowedPatterns: asStringArray(input.allowedPatterns),
    reportLimit: asPositiveInteger(input.reportLimit, 10),
  };
}

function buildHealthPolicyReport(options: {
  rootDir: string;
  configPath: string;
  configFound: boolean;
  source: HealthPolicyReport["source"];
  policy: HealthPolicy;
}): HealthPolicyReport {
  return {
    command: "health",
    operation: "policy",
    ok: true,
    rootDir: options.rootDir,
    configPath: options.configPath,
    configFound: options.configFound,
    source: options.source,
    policy: options.policy,
    nextAction: null,
    nextActions: [],
    nextCommand: null,
    nextCommands: [],
  };
}

function emitHealthJson(report: HealthReport): void {
  printJson(report);
}

function emitHealthNextActionJson(report: HealthReport): void {
  printJson(buildDiagnosticNextActionPayload({
    ok: report.ok,
    nextActions: report.nextActions,
    nextCommands: report.nextCommands,
  }));
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

  console.log(chalk.bold("\n4. Complexity Pressure"));
  if (!report.results.complexity) {
    console.log(chalk.gray("   Not enabled in health policy."));
  } else if (report.results.complexity.length === 0) {
    console.log(chalk.green("   ✅ No blocking large files found."));
  } else {
    report.results.complexity.forEach((issue: HealthIssue) => {
      console.log(chalk.yellow(`   ⚠️  ${issue.file} has ${issue.lines} lines.`));
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

function emitHealthPolicySummary(report: HealthPolicyReport): void {
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

function emitHealthPolicySuggestionSummary(report: HealthPolicySuggestionReport): void {
  console.log(chalk.bold("Health Policy Suggestion"));
  console.log(`   Source issues: ${report.sourceIssueCount}`);
  console.log(JSON.stringify({ health: report.suggestedHealth }, null, 2));
}

function emitHealthPolicyApplicationSummary(report: HealthPolicyApplicationReport): void {
  console.log(chalk.green("Health policy applied"));
  console.log(chalk.dim(`   ${report.configPath}`));
  console.log(JSON.stringify({ health: report.appliedHealth }, null, 2));
}

export async function runHealthAudit(rootDir = process.cwd()): Promise<HealthReport> {
  const policy = resolveHealthPolicy(rootDir);
  const health = new HealthCore();
  health.register(new FileSystemAuditor({
    ignoredGitVisibilityPatterns: policy.ignoredGitVisibilityPatterns,
  }));
  health.register(
    policy.preset === "refarm"
      ? new RefarmProjectAuditor(policy)
      : new ProjectAuditor(policy),
  );
  if (policy.complexity?.enabled) {
    health.register(new ComplexityAuditor({
      maxLines: policy.complexity.maxLines,
      paths: policy.complexity.paths?.length ? policy.complexity.paths : policy.workspaceRoots,
      allowedPatterns: policy.complexity.allowedPatterns,
      reportLimit: policy.complexity.reportLimit,
    }));
  }

  const results = await health.audit(null, null, { rootDir }) as HealthResults;
  const resolution = await health.checkResolutionStatus(rootDir) as ResolutionStatus[];
  return buildHealthReport(results, resolution);
}

export async function runHealthPolicySuggestion(rootDir = process.cwd()): Promise<HealthPolicySuggestionReport> {
  const policy = resolveHealthPolicy(rootDir);
  const report = await runHealthAudit(rootDir);
  const suggestedHealth = suggestHealthPolicy(policy, report.results);
  return {
    command: "health",
    operation: "policy-suggestion",
    ok: true,
    policy,
    suggestedHealth,
    sourceIssueCount: report.issueCount,
    nextAction: null,
    nextActions: [],
    nextCommand: null,
    nextCommands: [],
  };
}

export async function applySuggestedHealthPolicy(
  rootDir = process.cwd(),
): Promise<HealthPolicyApplicationReport> {
  const configPath = findRefarmConfigPath(rootDir) ?? defaultRefarmConfigPath(rootDir);
  const suggestion = await runHealthPolicySuggestion(rootDir);
  const config = readRefarmConfigForWrite(configPath);
  const previousHealth = config.health;
  const nextCommand = HEALTH_NEXT_ACTION_COMMAND;
  const nextCommands = [nextCommand];
  const nextActions = [nextCommand];
  config.health = suggestion.suggestedHealth;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
  return {
    command: "health",
    operation: "policy-application",
    ok: true,
    configPath,
    policy: suggestion.policy,
    previousHealth,
    appliedHealth: suggestion.suggestedHealth,
    sourceIssueCount: suggestion.sourceIssueCount,
    nextAction: nextCommand,
    nextActions,
    nextCommand,
    nextCommands,
  };
}

function readRefarmConfigForWrite(configPath: string): RefarmConfig {
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8")) as RefarmConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read ${configPath}: ${message}`);
  }
}

export function suggestHealthPolicy(policy: HealthPolicy, results: HealthResults): HealthPolicy {
  const ignoredGitVisibilityPatterns = uniqueStrings([
    ...policy.ignoredGitVisibilityPatterns,
    ...suggestIgnoredGitVisibilityPatterns(results.git),
  ]);
  const exemptPackageIds = uniqueStrings([
    ...(policy.exemptPackageIds ?? []),
    ...results.builds
      .map((issue) => issue.package)
      .filter((value): value is string => Boolean(value)),
  ]);
  return {
    preset: policy.preset,
    ...(policy.workspaceRoots ? { workspaceRoots: policy.workspaceRoots } : {}),
    ...(exemptPackageIds.length > 0 ? { exemptPackageIds } : {}),
    ignoredGitVisibilityPatterns,
    ...(policy.complexity ? { complexity: policy.complexity } : {}),
    ...(policy.title ? { title: policy.title } : {}),
  };
}

function suggestIgnoredGitVisibilityPatterns(issues: HealthIssue[]): string[] {
  const exactPatterns: string[] = [];
  const directoryPatterns = new Set<string>();

  for (const issue of issues) {
    if (!issue.file) continue;
    const normalized = issue.file.split(path.sep).join("/");
    const siteIndex = normalized.indexOf("/_site/");
    if (siteIndex > 0) {
      directoryPatterns.add(`${normalized.slice(0, siteIndex)}/_site/**`);
      continue;
    }
    exactPatterns.push(normalized);
  }

  return uniqueStrings([...directoryPatterns, ...exactPatterns]);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].filter((value) => value.length > 0).sort();
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
      "  $ refarm health --policy --json",
      "  $ refarm health --suggest-policy --json",
      "  $ refarm health --apply-suggested-policy --json",
      "  $ refarm health --next-action",
      "  $ refarm health --next-action --json",
      "  $ refarm health --next-command",
      "  $ refarm health --fail-on-issues",
      "",
      "Notes:",
      "  Health audits filesystem source visibility, build configuration, and package entrypoint alignment.",
      "  It does not require the Refarm runtime sidecar.",
      `  Use ${RUNTIME_DOCTOR_NEXT_ACTION_COMMAND} for host/runtime recovery steps.`,
      "  Project-specific policy can live under health in .refarm/config.json.",
    ].join("\n"),
  )
  .option("--json", "Output machine-readable health report")
  .option("--policy", "Print the resolved health policy and exit")
  .option("--suggest-policy", "Suggest a reviewed health policy from current diagnostics")
  .option("--apply-suggested-policy", "Apply the suggested health policy to .refarm/config.json")
  .option("--next-action", "Print only the first blocking recovery action")
  .option("--next-command", "Print only the first executable recovery command")
  .option("--fail-on-issues", "Exit non-zero when health issues are found")
  .action(async (options: HealthOptions) => {
    assertAtMostOneFlagEnabled(
      [
        { flag: "--policy", enabled: options.policy },
        { flag: "--suggest-policy", enabled: options.suggestPolicy },
        { flag: "--apply-suggested-policy", enabled: options.applySuggestedPolicy },
      ],
      "Choose only one health policy mode: --policy, --suggest-policy, or --apply-suggested-policy.",
    );

    if (options.policy) {
      const report = resolveHealthPolicyReport();
      if (options.json) {
        printJson(report);
      } else {
        emitHealthPolicySummary(report);
      }
      return;
    }

    if (options.applySuggestedPolicy) {
      const report = await applySuggestedHealthPolicy();
      if (options.json) {
        printJson(report);
      } else {
        emitHealthPolicyApplicationSummary(report);
      }
      return;
    }

    if (options.suggestPolicy) {
      const report = await runHealthPolicySuggestion();
      if (options.json) {
        printJson(report);
      } else {
        emitHealthPolicySuggestionSummary(report);
      }
      return;
    }

    const report = await runHealthAudit();

    if (options.nextCommand && options.json) {
      emitHealthNextActionJson(report);
    } else if (options.nextCommand) {
      const [command] = report.nextCommands;
      if (command) console.log(command);
    } else if (options.nextAction && options.json) {
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
