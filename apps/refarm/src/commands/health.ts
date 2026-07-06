import { refarmCommand } from "@refarm.dev/cli/command-handoff";
import { buildJsonErrorEnvelope, printJson } from "@refarm.dev/cli/json-output";
import { defaultRefarmConfigPath, findRefarmConfigPath } from "@refarm.dev/config";
import {
	ComplexityAuditor,
	ConfigNodeAuditor,
	FileSystemAuditor,
	HealthCore,
	ProjectAuditor,
	RefarmProjectAuditor,
} from "@refarm.dev/health";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { openTractorGraph } from "../utils/tractor-store.js";
import {
	buildDiagnosticNextActionPayload,
	diagnosticNextActions,
	diagnosticNextCommands,
	type DiagnosticRecommendation,
} from "./diagnostic-recommendations.js";
import {
	buildHealthAuditFingerprint,
	readHealthAuditCache,
	writeHealthAuditCache,
} from "./health-audit-cache.js";
import {
	emitHealthPolicyApplicationSummary,
	emitHealthPolicySuggestionSummary,
	emitHealthPolicySummary,
	emitHealthSummary,
} from "./health-output.js";
import {
	resolveHealthPolicy,
	resolveHealthPolicyReport,
	type HealthPolicy,
	type RefarmConfig,
} from "./health-policy.js";
import { assertAtMostOneFlagEnabled } from "./option-guards.js";
import { RUNTIME_DOCTOR_NEXT_ACTION_COMMAND } from "./runtime-recovery.js";

export { buildHealthAuditFingerprint } from "./health-audit-cache.js";
export { resolveHealthPolicy, resolveHealthPolicyReport } from "./health-policy.js";

export interface HealthIssue {
  file?: string;
  package?: string;
  path?: string;
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
  automations?: HealthIssue[];
  namespaceWarnings?: HealthIssue[];
  complexity?: HealthIssue[];
  complexitySummary?: unknown;
  configNode?: HealthIssue[];
  /** The orchestrator's per-auditor results (config-node lives here). */
  _orchestrator?: Record<string, { issues?: HealthIssue[]; note?: string }>;
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

const HEALTH_HELP_COMMAND = "refarm health --help";
const HEALTH_SUGGEST_POLICY_COMMAND = "refarm health --suggest-policy --json";
const HEALTH_NEXT_ACTION_COMMAND = "refarm health --next-action --json";
const HEALTH_POLICY_JSON_COMMAND = refarmCommand(["health", "--policy", "--json"]);
const RESOLUTION_ALIGNMENT_COMMAND = "node packages/toolbox/src/cli.mjs reso dist";
const HEALTH_POLICY_MODE_CONFLICT_MESSAGE = "Choose only one health policy mode: --policy, --suggest-policy, or --apply-suggested-policy.";

export function buildHealthReport(
  results: HealthResults,
  resolution: ResolutionStatus[],
): HealthReport {
  const issueCount = results.git.length
    + results.builds.length
    + results.alignment.length
    + (results.automations?.length ?? 0)
    + (results.complexity?.length ?? 0)
    + (results.configNode?.length ?? 0);
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
    ...(results.automations ?? []).map((issue) => ({
      issueType: issue.type,
      diagnostic: issue.type,
      target: issue.file,
      summary: `${issue.file ?? "Project automations"} has an invalid automation manifest entry.`,
      action: "Fix .project/automations.json before adding automation writers or relying on scheduled-work handoffs.",
      command: HEALTH_NEXT_ACTION_COMMAND,
    })),
    ...(results.namespaceWarnings ?? []).map((issue) => ({
      issueType: issue.type,
      diagnostic: issue.type,
      severity: "warning" as const,
      target: issue.path,
      summary: `${issue.path ?? "A workspace namespace"} is present without a workspaceNamespaces declaration.`,
      action: "Declare the namespace owner, purpose, persistence, and access in refarm.config.json, or remove the drift.",
      command: HEALTH_POLICY_JSON_COMMAND,
    })),
    ...(results.complexity ?? []).map((issue) => ({
      issueType: issue.type,
      diagnostic: issue.type,
      target: issue.file,
      summary: `${issue.file ?? "A workspace file"} has ${issue.lines ?? "too many"} lines.`,
      action: "Split the file or add a documented health.complexity allowed pattern for generated/vendor content.",
      command: HEALTH_SUGGEST_POLICY_COMMAND,
    })),
    ...(results.configNode ?? []).map((issue) => ({
      issueType: issue.type,
      diagnostic: issue.type,
      target: issue.path,
      summary:
        issue.type === "config_node_drift"
          ? "The replicated config graph node differs from the local .refarm/config.json."
          : "The stored config graph node is malformed.",
      action:
        "Reconcile the config: another device changed it, or the local file drifted. Re-run the runtime to re-sync the RefarmConfig node.",
    })),
  ];
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

function healthPolicyModeConflictMessage(options: HealthOptions): string | null {
  try {
    assertAtMostOneFlagEnabled(
      [
        { flag: "--policy", enabled: options.policy },
        { flag: "--suggest-policy", enabled: options.suggestPolicy },
        { flag: "--apply-suggested-policy", enabled: options.applySuggestedPolicy },
      ],
      HEALTH_POLICY_MODE_CONFLICT_MESSAGE,
    );
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function reportHealthOptionError(message: string, options: HealthOptions): void {
  const nextAction = "Run `refarm health --help` and choose one health policy mode.";
  if (options.json) {
    printJson(buildJsonErrorEnvelope({
      command: "health",
      operation: "policy-mode",
      error: "invalid-health-policy-mode",
      message,
      nextAction,
      nextActions: [nextAction],
      nextCommand: HEALTH_HELP_COMMAND,
      nextCommands: [HEALTH_HELP_COMMAND],
    }));
  } else {
    console.error(message);
  }
  process.exitCode = 1;
}


export async function runHealthAudit(rootDir = process.cwd()): Promise<HealthReport> {
  const policyReport = resolveHealthPolicyReport(rootDir);
  const policy = policyReport.policy;
  const fingerprint = buildHealthAuditFingerprint(rootDir, policyReport);
  const cached = readHealthAuditCache(rootDir, fingerprint);
  if (cached) return cached;

  const graphContext = openTractorGraph();
  const health = new HealthCore(graphContext);
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
  // Cross-device: audit the RefarmConfig graph node against the local config.
  // No-ops informatively when the graph store is absent (graphContext null).
  health.register(new ConfigNodeAuditor({ graphContext }));

  const results = await health.audit(null, null, { rootDir }) as HealthResults;
  // Lift the config-node auditor's issues out of the orchestrator bag so the
  // report surfaces cross-device config drift alongside the fs/build findings.
  results.configNode = results._orchestrator?.["config-node"]?.issues ?? [];
  const resolution = await health.checkResolutionStatus(rootDir) as ResolutionStatus[];
  const report = buildHealthReport(results, resolution);
  writeHealthAuditCache(rootDir, fingerprint, report);
  return report;
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
    const policyModeConflict = healthPolicyModeConflictMessage(options);
    if (policyModeConflict) {
      reportHealthOptionError(policyModeConflict, options);
      return;
    }

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
