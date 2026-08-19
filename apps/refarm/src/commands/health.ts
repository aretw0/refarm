import {
	declaredBase,
	defaultSovereignConfigPath,
	findSovereignConfigPath,
	sovereignConfigRelativePath,
} from "@refarm.dev/config";
import {
	ComplexityAuditor,
	ConfigNodeAuditor,
	describeRenewalCoverage,
	describeSubstrate,
	FileSystemAuditor,
	HealthCore,
	ProjectAuditor,
	readNodeSubstrate,
	readToolRequirements,
	RefarmProjectAuditor,
	renewalCoverage,
	ToolchainAuditor,
	type NodeSubstrate,
} from "@refarm.dev/health";
import type { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { readNodeDescriptor } from "../utils/node-descriptor.js";
import { resolveRefarmHome } from "../utils/refarm-home.js";
import { openTractorGraph } from "../utils/tractor-store.js";
import { toCommanderGroup } from "./capability-commander.js";
import {
	diagnosticNextActions,
	diagnosticNextCommands,
	type DiagnosticRecommendation,
} from "./diagnostic-recommendations.js";
import {
	buildHealthAuditFingerprint,
	readHealthAuditCache,
	writeHealthAuditCache,
} from "./health-audit-cache.js";
import { createHealthCapabilityGroup, healthCapabilityHooks } from "./health-capability.js";
import {
	HEALTH_NEXT_ACTION_COMMAND,
	HEALTH_POLICY_JSON_COMMAND,
	HEALTH_SUGGEST_POLICY_COMMAND,
} from "./health-commands.js";
import {
	resolveHealthPolicy,
	resolveHealthPolicyReport,
	type HealthPolicy,
	type RefarmConfig,
} from "./health-policy.js";
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
	/** Declared tools this node could not satisfy, plus declaration entries that could not be
	 *  read. Present-and-EMPTY when the node declared nothing: "asked, nothing to report" is a
	 *  different fact from a build that never looked, and only one of them is absence. */
	nodeTools?: NodeToolFindings;
	/** Whether anything on this node keeps its short-lived credentials alive. */
	credentialRenewal?: { state: "unneeded" | "covered" | "uncovered"; providers: string[]; by?: string };
	/** Which code this node executes, and whether a git tree encloses it. The DISCRIMINATED union,
	 *  not a widened shape: `repository` exists only on the arm that has one, and widening it here
	 *  would let a reader ask for it on an installed node and get `undefined` instead of a type
	 *  error. */
	nodeSubstrate?: NodeSubstrate;
	/**
	 * The orchestrator's per-auditor results (config-node lives here).
	 * `applicable`/`reason` are set by project-shaped auditors (generic_fs,
	 * project) — see SkippedAuditor: `applicable === false` means the auditor
	 * did not run because `rootDir` is not a project (a node base like `~`),
	 * not that it ran and found nothing.
	 */
	_orchestrator?: Record<
		string,
		{
			issues?: HealthIssue[];
			note?: string;
			applicable?: boolean;
			reason?: string;
			// Auditors carry other fields too (generic_fs's `git`/`structure`,
			// project's `builds`/`alignment`/…) that this bag does not otherwise
			// model — only applicability is read generically here.
			[key: string]: unknown;
		}
	>;
}

/** A declared tool the node could not satisfy. `state` separates the repairs: install it, update
 *  it, or find out why its version cannot be read. */
export interface NodeToolCheck {
	id: string;
	label: string;
	ok: boolean;
	required: boolean;
	state?: "ok" | "absent" | "outdated" | "cannot-say";
	minVersion?: string;
	measuredVersion?: string;
	detail?: string;
}

export interface NodeToolFindings {
	checks: NodeToolCheck[];
	malformed: unknown[];
}

/**
 * An auditor that did not run because it does not apply to this `rootDir` —
 * distinct from an auditor that ran and found zero issues. Surfaced at the
 * envelope's top level so `ok: true` / `issueCount: 0` at a node base (e.g.
 * the operator's `~`) reads as "nothing HERE was checkable and found dirty",
 * not "everything was checked and is clean".
 */
export interface SkippedAuditor {
	id: string;
	title: string;
	reason: string;
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
	/** Auditors that did not apply to this base and therefore did not run. */
	skippedAuditors: SkippedAuditor[];
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

export interface HealthAuditOptions {
	cacheMode?: "fresh" | "stable";
}

const RESOLUTION_ALIGNMENT_COMMAND = "node packages/toolbox/src/cli.mjs reso dist";

export function buildHealthReport(
	results: HealthResults,
	resolution: ResolutionStatus[],
	skippedAuditors: SkippedAuditor[] = [],
): HealthReport {
	const issueCount =
		results.git.length +
		results.builds.length +
		results.alignment.length +
		(results.automations?.length ?? 0) +
		(results.complexity?.length ?? 0) +
		(results.configNode?.length ?? 0) +
		// Counted, so `ok` cannot say all-clear while recommending a repair. Only a node that
		// DECLARED tools can reach this — an operator who does not want an outdated tool to fail
		// the gate lowers the minimum or drops the entry, which are both honest answers.
		(results.nodeTools?.checks.length ?? 0) +
		(results.nodeTools?.malformed.length ?? 0);
	// NOT COUNTED, and the line is worth stating because the sibling above IS counted.
	//
	// `issueCount` is what is broken NOW against something this node DECLARED. An unmet
	// `nodeTools` minimum is exactly that: the operator said `gh >= 2.40` and it is not. The
	// renewal gap is a PREDICTION — nothing is broken, the node dispatches, and the operator never
	// declared a position on it. Counting a prediction as a fault turns `refarm check` red on a
	// working node and blocks the agent loop over a risk, which teaches operators to pass their
	// eyes over a red gate. It rides as a RECOMMENDATION instead, which is what advice is.
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
		skippedAuditors,
		nextAction: nextActions[0] ?? null,
		nextActions,
		nextCommand: nextCommands[0] ?? null,
		nextCommands,
	};
}

/**
 * Reads applicability off the orchestrator's per-auditor results (set by
 * project-shaped auditors — see project-base.js in @refarm.dev/health) and
 * turns it into the envelope's `skippedAuditors` list. `titles` maps an
 * auditor id to the human-readable title of the concrete instance
 * `runHealthAudit` registered, so the report names the SAME auditor an
 * operator would see if it had run.
 */
export function collectSkippedAuditors(
	orchestrator: HealthResults["_orchestrator"],
	titles: Record<string, string>,
): SkippedAuditor[] {
	if (!orchestrator) return [];
	const skipped: SkippedAuditor[] = [];
	for (const [id, result] of Object.entries(orchestrator)) {
		if (result?.applicable !== false || !result.reason) continue;
		skipped.push({ id, title: titles[id] ?? id, reason: result.reason });
	}
	return skipped;
}

/**
 * Presentation for each `configNode` issue type the ConfigNodeAuditor emits.
 * Three distinct findings, not two — `config_node_drift` and
 * `config_node_invalid` are "checked, found a problem"; `config_node_unreachable`
 * is "could not check" (the graph read itself threw). Collapsing the third into
 * the second's wording ("malformed") would tell the operator to reconcile a
 * config that was never successfully read — a different, misleading action.
 * Keyed by the auditor's own `issue.type` string so a new type added there
 * degrades to the `config_node_invalid` wording (still visible as an issue,
 * just under-described) rather than silently vanishing from the report.
 */
interface ConfigNodeIssuePresentation {
	summary: string;
	action: string;
}

const DEFAULT_CONFIG_NODE_ISSUE_PRESENTATION: ConfigNodeIssuePresentation = {
	summary: "The stored config graph node is malformed.",
	action:
		"Reconcile the config: another device changed it, or the local file drifted. Re-run the runtime to re-sync the RefarmConfig node.",
};

const CONFIG_NODE_ISSUE_PRESENTATION: Record<string, ConfigNodeIssuePresentation> = {
	config_node_drift: {
		summary: "The replicated config graph node differs from the local .refarm/config.json.",
		action:
			"Reconcile the config: another device changed it, or the local file drifted. Re-run the runtime to re-sync the RefarmConfig node.",
	},
	config_node_invalid: DEFAULT_CONFIG_NODE_ISSUE_PRESENTATION,
	config_node_unreachable: {
		summary:
			"The config graph node could not be read — the audit could not run, not that it ran clean.",
		action:
			"Confirm the runtime sidecar is reachable and the graph store is healthy (refarm check --next-action --json), then re-run refarm health.",
	},
};

export function buildHealthRecommendations(results: HealthResults): HealthRecommendation[] {
	return [
		...results.git.map((issue) => ({
			issueType: issue.type,
			diagnostic: issue.type,
			target: issue.file,
			summary: `${issue.file ?? "A source file"} is ignored by Git.`,
			action:
				"Track the source file, or add an explicit health policy exclusion if it is generated.",
			command: HEALTH_SUGGEST_POLICY_COMMAND,
		})),
		...results.builds.map((issue) => ({
			issueType: issue.type,
			diagnostic: issue.type,
			target: issue.package,
			summary: `${issue.package ?? "A workspace package"} is missing a build config.`,
			action:
				"Add the package build configuration or mark the package exempt in the project health policy.",
			command: HEALTH_SUGGEST_POLICY_COMMAND,
		})),
		...results.alignment.map((issue) => ({
			issueType: issue.type,
			diagnostic: issue.type,
			target: issue.package,
			summary: `${issue.package ?? "A workspace package"} resolves to ${issue.entry ?? "source"} instead of its build output.`,
			action:
				"Point package entrypoints at build output, or run the project's configured resolution-alignment workflow.",
			command: RESOLUTION_ALIGNMENT_COMMAND,
		})),
		...(results.automations ?? []).map((issue) => ({
			issueType: issue.type,
			diagnostic: issue.type,
			target: issue.file,
			summary: `${issue.file ?? "Project automations"} has an invalid automation manifest entry.`,
			action:
				"Fix .project/automations.json before adding automation writers or relying on scheduled-work handoffs.",
			command: HEALTH_NEXT_ACTION_COMMAND,
		})),
		...(results.namespaceWarnings ?? []).map((issue) => ({
			issueType: issue.type,
			diagnostic: issue.type,
			severity: "warning" as const,
			target: issue.path,
			summary: `${issue.path ?? "A workspace namespace"} is present without a workspaceNamespaces declaration.`,
			action:
				"Declare the namespace owner, purpose, persistence, and access in refarm.config.json, or remove the drift.",
			command: HEALTH_POLICY_JSON_COMMAND,
		})),
		...(results.complexity ?? []).map((issue) => ({
			issueType: issue.type,
			diagnostic: issue.type,
			target: issue.file,
			summary: `${issue.file ?? "A workspace file"} has ${issue.lines ?? "too many"} lines.`,
			action:
				"Split the file or add a documented health.complexity allowed pattern for generated/vendor content.",
			command: HEALTH_SUGGEST_POLICY_COMMAND,
		})),
		...(results.configNode ?? []).map((issue) => {
			const presentation =
				CONFIG_NODE_ISSUE_PRESENTATION[issue.type] ?? DEFAULT_CONFIG_NODE_ISSUE_PRESENTATION;
			return {
				issueType: issue.type,
				diagnostic: issue.type,
				target: issue.path,
				summary: presentation.summary,
				action: presentation.action,
			};
		}),
		// No `command`: this node has no verb that installs a tool for the operator, and inventing
		// one that does not exist would put a dead handoff into `nextCommands`, which every agent
		// loop in this repo is told to follow.
		...(results.nodeTools?.checks ?? []).map((check) => ({
			issueType: `node-tool-${check.state ?? "absent"}`,
			diagnostic: `node-tool-${check.state ?? "absent"}`,
			target: check.label,
			summary: check.detail ?? `${check.label} is declared by this node and is not satisfied.`,
			action: NODE_TOOL_ACTIONS[check.state ?? "absent"],
		})),
		...(results.nodeSubstrate?.kind === "working-tree"
			? [
					{
						issueType: "node-runs-working-tree",
						diagnostic: "node-runs-working-tree",
						// INFO, so it never leads `nextAction`. A handoff is what to DO next, and
						// "nothing is broken, know this about your node" is not that — putting it
						// first would push a real recovery below an advisory. `diagnosticNextActions`
						// already skips this severity; the category existed and this is what it is for.
						severity: "info" as const,
						target: results.nodeSubstrate.repository ?? "",
						summary: describeSubstrate(results.nodeSubstrate) ?? "",
						action:
							"Nothing is broken. Know that building, switching branches or moving that " +
							"repository changes what this node runs, and that a backup of the node does " +
							"not carry it — see ISS-154.",
					},
				]
			: []),
		...(results.credentialRenewal?.state === "uncovered"
			? [
					{
						issueType: "credential-renewal-uncovered",
						diagnostic: "credential-renewal-uncovered",
						// Same reason: a prediction about tomorrow must not displace a fault today.
						severity: "info" as const,
						target: results.credentialRenewal.providers.join(", "),
						summary: describeRenewalCoverage(results.credentialRenewal) ?? "",
						action:
							"Declare a supervised process that runs the renewal — `refarm process add`, " +
							"with `refarm credential renew`. It asks no provider when nothing has lapsed, " +
							"so a short interval costs nothing and closes the window a dispatch can fail in.",
					},
				]
			: []),
		...(results.nodeTools?.malformed ?? []).map((entry) => ({
			issueType: "node-tool-malformed",
			diagnostic: "node-tool-malformed",
			target: typeof entry === "string" ? entry : JSON.stringify(entry),
			summary: "A nodeTools entry could not be read, so nothing is checking the tool it names.",
			action:
				"Fix the entry in the sovereign config: each tool needs a `command`, and may carry " +
				"`minVersion` and `why`.",
		})),
	];
}

/** What an operator actually does about each state. Kept beside the mapping rather than inside
 *  @refarm.dev/health, which reports the FACT and must not name one surface's repair. */
const NODE_TOOL_ACTIONS: Record<NonNullable<NodeToolCheck["state"]>, string> = {
	absent: "Install the tool on this node, or remove it from `nodeTools` if it is no longer needed.",
	outdated:
		"Update the tool on this node, or lower the declared minimum if the older version is genuinely enough.",
	"cannot-say":
		"Read the tool's version output by hand: the declared minimum is UNVERIFIED, not met, and one of the two is a real problem.",
	ok: "No action: this tool satisfies its declaration.",
};

/**
 * The base `ConfigNodeAuditor` must read the local `.refarm/config.json` from —
 * the scope the graph node's OWNING DAEMON actually used, not `rootDir` (which
 * is very often a `process.cwd()`-derived project checkout, a different
 * `.refarm/config.json` entirely from whatever the running daemon was started
 * with). Comparing the graph node against the wrong scope's file is not a
 * cross-device drift check, it is diffing two unrelated configs and reporting
 * the difference as if it meant something.
 *
 * Mirrors `resolveScopeComparison` in `doctor.ts` (the declared-node-base
 * design, docs/superpowers/specs/2026-08-03-declared-node-base-design.md),
 * which solves this exact problem for the sibling `scope:config-divergence`
 * finding: a live node descriptor (`<refarmHome>/node.json`) names the ACTUAL
 * base the running daemon declared itself with — it can differ from what this
 * process would infer locally (a daemon started with an explicit
 * `--refarm-dir`). Absent a live descriptor, `resolveRefarmHome()` IS the
 * sovereign dir (e.g. `~/.refarm`), so its parent is the base
 * `loadRawSovereignConfig` needs (it joins `<base>/<SOVEREIGN_DIR>/config.json`).
 *
 * Deliberately reuses the SAME two primitives `doctor.ts` already combined for
 * this — not a second, bespoke resolution rule.
 */
export function resolveConfigNodeBase(env = process.env): string {
	const nodeHome = path.resolve(resolveRefarmHome(env));
	const running = readNodeDescriptor(nodeHome);
	return running ? path.resolve(running.declarationBase) : path.dirname(nodeHome);
}

export async function runHealthAudit(
	// os-resolution: project — audits the repository tree the operator is standing in
	rootDir = process.cwd(),
	options: HealthAuditOptions = {},
): Promise<HealthReport> {
	const policyReport = resolveHealthPolicyReport(rootDir);
	const policy = policyReport.policy;
	const fingerprint = buildHealthAuditFingerprint(rootDir, policyReport);
	const cached = readHealthAuditCache(rootDir, fingerprint, {
		allowStale: options.cacheMode === "stable",
	});
	if (cached) {
		// The cache is a fingerprint over the REPOSITORY. A node tool lives outside it entirely —
		// which is the whole reason this surface exists — so no hash of the tree can notice `gh`
		// being upgraded. Re-measured on every hit: an operator who updates a tool and re-runs
		// `health` must not be told the stale answer they just repaired.
		cached.results.nodeTools = await auditDeclaredNodeTools(rootDir);
		// SAME REASON as nodeTools above: which accounts this node holds and which processes it
		// declares are facts about the MACHINE, and the cache fingerprints the repository. A
		// cached "all clear" would keep saying nothing is wrong while the node walks toward the
		// day it stops dispatching — and `refarm check` reads exactly this cached path.
		cached.results.credentialRenewal = readRenewalCoverage();
		// Rebuilt, not patched: recommendations, nextActions and `ok` are all derived from results,
		// and hand-updating one of the four is how a report comes to contradict itself.
		return buildHealthReport(cached.results, cached.resolution, cached.skippedAuditors);
	}

	const graphContext = await openTractorGraph();
	const health = new HealthCore(graphContext);
	const fileSystemAuditor = new FileSystemAuditor({
		ignoredGitVisibilityPatterns: policy.ignoredGitVisibilityPatterns,
	});
	health.register(fileSystemAuditor);
	const projectAuditor =
		policy.preset === "refarm" ? new RefarmProjectAuditor(policy) : new ProjectAuditor(policy);
	health.register(projectAuditor);
	if (policy.complexity?.enabled) {
		health.register(
			new ComplexityAuditor({
				maxLines: policy.complexity.maxLines,
				paths: policy.complexity.paths?.length ? policy.complexity.paths : policy.workspaceRoots,
				allowedPatterns: policy.complexity.allowedPatterns,
				reportLimit: policy.complexity.reportLimit,
			}),
		);
	}
	// Cross-device: audit the RefarmConfig graph node against the local config.
	// No-ops informatively when the graph store is absent (graphContext null).
	health.register(new ConfigNodeAuditor({ graphContext }));

	const results = (await health.audit(null, null, {
		rootDir,
		// The node's declared scope, NOT rootDir — see resolveConfigNodeBase.
		configBase: resolveConfigNodeBase(),
	})) as HealthResults;
	// Lift the config-node auditor's issues out of the orchestrator bag so the
	// report surfaces cross-device config drift alongside the fs/build findings.
	results.configNode = results._orchestrator?.["config-node"]?.issues ?? [];
	results.nodeTools = await auditDeclaredNodeTools(rootDir);
	// A CREDENTIAL THAT EXPIRES AND NOTHING RENEWING IT. Measured 2026-08-19: a node up for a day
	// answered every dispatch with `token expired`. Reported rather than declared — writing a
	// timer that talks to a provider into someone's machine is their decision, and the node's job
	// is to make sure it is made deliberately instead of discovered by the node stopping.
	results.credentialRenewal = readRenewalCoverage();
	// WHAT THIS NODE ACTUALLY EXECUTES. Measured 2026-08-19: the launcher is a shim into a git
	// working tree, so every supervised service runs the development repo's build output while
	// naming a path under `~/.local/bin`. Reported, not counted — nothing is broken, and running
	// the working tree is a legitimate choice that simply must not be invisible.
	results.nodeSubstrate = readNodeSubstrate(process.argv[1] ?? undefined);
	// generic_fs and project self-report `applicable: false` when `rootDir` is
	// not a project (a node base like `~`) — surface that at the envelope's
	// top level instead of letting their resulting empty arrays read as a
	// clean pass over something that was never actually checked.
	const skippedAuditors = collectSkippedAuditors(results._orchestrator, {
		generic_fs: fileSystemAuditor.title,
		project: projectAuditor.title,
	});
	const resolution = (await health.checkResolutionStatus(rootDir)) as ResolutionStatus[];
	const report = buildHealthReport(results, resolution, skippedAuditors);
	writeHealthAuditCache(rootDir, fingerprint, report);
	return report;
}

export async function runHealthPolicySuggestion(
	// os-resolution: project — audits the repository tree the operator is standing in
	rootDir = process.cwd(),
): Promise<HealthPolicySuggestionReport> {
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
	// os-resolution: project — audits the repository tree the operator is standing in
	rootDir = process.cwd(),
): Promise<HealthPolicyApplicationReport> {
	const configPath = resolveSovereignConfigPath(rootDir);
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

/**
 * The tools this node depends on but does not ship: `gh`, a VPN client, `rsync`. They drift on
 * their own schedule and nothing here noticed when they did — measured on this node as `gh` 2.4.0
 * from 2022, present and answering, so every presence check passed.
 *
 * A declared tool that is absent, outdated or unverifiable is a NODE finding, not a project one:
 * it belongs beside the fs/build results so `health` answers "can this node work?" and not only
 * "is this repository well-formed?".
 *
 * ONE function owns this, deliberately. It runs on the full audit AND on a cache hit, and two
 * copies of the mapping would be two places for the declaration to be read differently. A node
 * that declared nothing measures nothing, so adopting this changes no existing node's report.
 */
async function auditDeclaredNodeTools(rootDir: string): Promise<NodeToolFindings> {
	const declaration = readNodeToolDeclaration(rootDir);
	if (declaration.tools.length === 0) return { checks: [], malformed: declaration.malformed };
	const auditor = new ToolchainAuditor({
		title: "Declared Node Tools",
		commandChecks: declaration.tools.map((tool) => ({
			id: `node-tool:${tool.command}`,
			label: tool.minVersion ? `${tool.command} >= ${tool.minVersion}` : tool.command,
			command: tool.command,
			args: tool.args,
			minVersion: tool.minVersion,
			why: tool.why,
		})),
	});
	const report = await auditor.audit({ rootDir });
	return {
		checks: (report.checks as NodeToolCheck[]).filter((check) => !check.ok),
		malformed: declaration.malformed,
	};
}

/** ONE place that decides which file this node speaks its config through. Two call sites drifting
 *  apart would have `health` audit one file while `--apply-policy` writes another. */
function resolveSovereignConfigPath(rootDir: string): string {
	return findSovereignConfigPath(rootDir) ?? defaultSovereignConfigPath(rootDir);
}

/**
 * The declared node tools — read from the NODE tier only, and never from where the operator stands.
 *
 * This is a privilege boundary, not a lookup preference. Auditing a declared tool SPAWNS it to read
 * its version, so whoever may write this key chooses which binaries this machine executes. Cloning
 * a repository whose `.refarm/config.json` declared `nodeTools` would be enough. `docs/CONFIG_TIERS.md`
 * registers the key as node-owned and workspace-REQUESTABLE, but `auditConfigTier` is reporting-only
 * today — so the reader that creates the risk is the one that holds the line, rather than waiting
 * for the general enforcement slice.
 *
 * A parse failure comes back as MALFORMED, not as an empty declaration: `readRefarmConfigForWrite`
 * throws, which is right for a writer (never overwrite a file you could not read) and wrong here —
 * `health` exists to report problems, and crashing on the config it audits reports nothing. A config
 * this build cannot read is not a node that declared no tools, and letting it read that way is the
 * silence this surface exists to break.
 */
/** PURE-ish. The held accounts and declared processes, read without secrets and without throwing:
 *  a health run must not die because a catalog is unreadable, and an unreadable catalog holds no
 *  accounts as far as anything here can tell. */
function readRenewalCoverage(): {
	state: "unneeded" | "covered" | "uncovered";
	providers: string[];
	by?: string;
} {
	try {
		const home = declaredBase();
		const dir = path.dirname(path.join(home, sovereignConfigRelativePath()));
		const accounts = JSON.parse(
			fs.readFileSync(path.join(dir, "model-accounts.json"), "utf-8"),
		) as { provider?: string }[];
		const config = JSON.parse(
			fs.readFileSync(path.join(dir, "config.json"), "utf-8"),
		) as { processes?: Record<string, { command?: string[] | string }> };
		const processes = Object.entries(config.processes ?? {}).map(([name, value]) => ({
			name,
			...(value?.command !== undefined ? { command: value.command } : {}),
		}));
		return renewalCoverage(Array.isArray(accounts) ? accounts : [], processes);
	} catch {
		return { state: "unneeded", providers: [] };
	}
}

function readNodeToolDeclaration(rootDir: string): ReturnType<typeof readToolRequirements> {
	// `sovereignConfigRelativePath`, not a hardcoded ".refarm": the sovereign dir is selected by
	// SOVEREIGN_DIR, and a reader that assumes the default answers about a file the operator
	// does not use. `refarm tools` resolves the same path through the same helper.
	const nodeConfigPath = path.join(declaredBase(), sovereignConfigRelativePath());
	const declaration = readToolDeclarationAt(nodeConfigPath);

	// A workspace may STATE the need; it may not hold the declaration. Reported rather than
	// silently ignored, so an operator who wrote it in the wrong file learns why nothing happened.
	const workspaceConfigPath = resolveSovereignConfigPath(rootDir);
	if (path.resolve(workspaceConfigPath) !== path.resolve(nodeConfigPath)) {
		const requested = readToolDeclarationAt(workspaceConfigPath);
		// `tools` only. A workspace config that is merely unreadable has not declared anything, and
		// saying it did would be an accusation the file does not support.
		if (requested.tools.length > 0) {
			declaration.malformed.push(
				`${workspaceConfigPath} declares nodeTools, which only the node tier may hold — ` +
					"auditing a tool runs it, so a repository declaring this would choose which binaries " +
					"this machine executes. Move it to the node config to honour it.",
			);
		}
	}
	return declaration;
}

function readToolDeclarationAt(configPath: string): ReturnType<typeof readToolRequirements> {
	if (!fs.existsSync(configPath)) return { tools: [], malformed: [] };
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(configPath, "utf-8"));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { tools: [], malformed: [`${configPath} could not be parsed: ${message}`] };
	}
	// OUTSIDE the catch, deliberately. Wrapping the reader too turned a missing export into
	// "this config could not be parsed" — a failure in this build, reported as a fault in the
	// operator's file. A broken reader must fail loudly as itself.
	return readToolRequirements(parsed);
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

/**
 * `health` projected onto commander from its CapabilityGroup, for the CLI-
 * contract tests that parse it directly. The CLI mount, the `/health` REPL slash,
 * the HTTP surface, and the TUI section all derive from the ONE registry entry
 * (see capability-registry.ts) — this export mirrors that projection so the
 * pinned tests exercise the same command the registry mounts. The sub-verb help
 * (`health policy`, `health suggest-policy`, `health apply-policy`) and the audit
 * modifier options are generated from the group, so no hand-written help block or
 * flag list lives here anymore.
 */
export const healthCommand: Command = toCommanderGroup(
	createHealthCapabilityGroup(),
	healthCapabilityHooks,
).addHelpText(
	"after",
	[
		"",
		"Notes:",
		"  Health audits filesystem source visibility, build configuration, and package entrypoint alignment.",
		"  It does not require the Refarm runtime sidecar.",
		"  A non-zero exit signals issues were found — health is a diagnostic gate.",
		`  Use ${RUNTIME_DOCTOR_NEXT_ACTION_COMMAND} for host/runtime recovery steps.`,
		"  Project-specific policy can live under health in .refarm/config.json.",
	].join("\n"),
);
