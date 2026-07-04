import type {
	CapabilityDescriptor,
	CapabilityGroup,
} from "@refarm.dev/cli/capabilities";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
} from "@refarm.dev/cli/json-output";
import {
	loadAgentSkillsFromDir,
	loadCheckersFromPluginsDir,
	loadSkillsFromPluginsDir,
	type DiscoveredSkill,
	type ImportedAgentSkill,
} from "@refarm.dev/plugin-surface-loader/node";
import {
	createReferenceChecker,
	loadCheckerComponent,
	type CheckerFinding,
	type ReferenceChecker,
} from "@refarm.dev/quality-checker-ref";
import { openScopedLedger } from "@refarm.dev/storage-node-view";
import chalk from "chalk";
import { dirname } from "node:path";

import {
	pluginsBaseDir,
	resolveOrgRoot,
	resolveRefarmHome,
} from "../utils/refarm-home.js";
import type { CapabilitySurfaceHooks } from "./capability-commander.js";
import {
	buildDiagnosticNextActionPayload,
	diagnosticNextActions,
	diagnosticNextCommands,
	type DiagnosticRecommendation,
} from "./diagnostic-recommendations.js";

/**
 * A tiny built-in profile of "skill tells" — writing patterns worth flagging in a
 * skill's instructions. Matcher-is-data (the reference checker interprets
 * `contains`). This is a starter catalog; a plugin-contributed checker + profile
 * can replace or extend it (that is the whole point of the sovereign boundary).
 */
const SKILL_TELLS_PROFILE = {
	name: "skill-tells",
	rules: [
		{
			id: "ai-self-reference",
			severity: "warn",
			description:
				"Instructions mention being an AI/language model — a chatbot tell, not operator-directed prose.",
			category: "ai-tell",
			check: JSON.stringify({ type: "contains", value: "language model" }),
		},
		{
			id: "todo-placeholder",
			severity: "warn",
			description: "Instructions still contain a TODO placeholder.",
			category: "completeness",
			check: JSON.stringify({ type: "contains", value: "TODO" }),
		},
	],
};

/**
 * The `skill` command as a multi-surface CapabilityGroup — the DESTINATION that
 * finally wires the (previously orphaned) plugin surface loader: `skill list`
 * enumerates installed plugins and loads every pi/skill surface, making skills
 * addressable on the CLI, the REPL `/skill`, and to the agent from ONE
 * declaration. `skill import --write` adds content-addressed skill nodes to the
 * same visible catalog. It does NOT invoke a skill (that stays behind the runtime
 * activation preflight — a later slice); it makes them visible.
 *
 * `deps.discover` is injected (defaults to reading `<refarm-home>/plugins`) so
 * run() never touches the filesystem directly and stays testable.
 */
export interface SkillCommandDeps {
	/** Discover installed skills. Defaults to scanning the refarm plugins dir. */
	discover: () => { skills: DiscoveredSkill[]; rejected: { pluginId: string | null; pluginDir: string; issues: string[] }[] };
	/** Load skills previously persisted by `skill import --write`. */
	loadPersistedSkills: () => Promise<PersistedSkillLoadResult>;
	/**
	 * Load the quality checkers to run: the bundled reference checker plus any a
	 * plugin contributes via a {kind:"quality-checker"} surface. Each is loaded
	 * under the deny-all sandbox by the host loader — a checker sees only the
	 * subject, never fs/network. Injected so `check` run() stays testable.
	 */
	loadCheckers: () => Promise<ReferenceChecker[]>;
	/**
	 * Import Agent Skills (the portable agentskills.io SKILL.md format) from a
	 * directory into refarm's skill model — the convergence front-half. Injected
	 * so `import` run() stays testable; defaults to loadAgentSkillsFromDir.
	 */
	importSkills: (dir: string) => {
		skills: ImportedAgentSkill[];
		rejected: { skillDir: string; issues: string[] }[];
	};
	/**
	 * Persist imported skills into refarm's store as CONTENT-ADDRESSED nodes: the
	 * skill's `@id` is `urn:refarm:skill:v1:<name>:<sha256>` — the sha256 of the
	 * SKILL.md IS the identity, so the same content maps to the same node whether
	 * it came from fs today or p2p/OPFS tomorrow. Returns the ids written. This is
	 * the seam a future content-addressed/p2p resolver plugs into unchanged.
	 */
	persistSkills: (
		skills: ImportedAgentSkill[],
		scope: SkillLedgerScope,
	) => Promise<string[]>;
}

/** JSON-LD type of a persisted, imported skill node. */
const IMPORTED_SKILL_NODE_TYPE = "refarm:imported-skill";

/**
 * The scope a persisted skill lives at, most-specific first: `user` (personal) >
 * `workspace` (this project) > `org` (a shared base an organization distributes).
 * `import --scope` chooses where a skill is written; listing folds all three, and
 * the highest-precedence copy of a content-addressed id wins.
 */
export type SkillLedgerScope = "org" | "workspace" | "user";

const SKILL_LEDGER_SCOPES: readonly SkillLedgerScope[] = [
	"org",
	"workspace",
	"user",
];

/** Parse a scope string; null when unrecognized (the caller errors loudly). */
function parseSkillLedgerScope(value: string | undefined): SkillLedgerScope | null {
	if (value === undefined) return "user";
	return (SKILL_LEDGER_SCOPES as readonly string[]).includes(value)
		? (value as SkillLedgerScope)
		: null;
}

/** A skill imported earlier and loaded back from a scoped skills ledger. */
export interface PersistedSkill {
	surfaceId: string;
	id: string;
	name: string;
	description?: string;
	requiredCapabilities: readonly string[];
	instructions: string;
	ledgerScope: SkillLedgerScope;
}

export interface PersistedSkillLoadResult {
	skills: PersistedSkill[];
	rejected: {
		ledgerScope: SkillLedgerScope;
		nodeId: string;
		issues: string[];
	}[];
}

interface CatalogSkill {
	surfaceId: string;
	id: string;
	name: string;
	description?: string;
	requiredCapabilities: readonly string[];
	instructions: string;
	source: "plugin" | "imported";
	pluginId?: string;
	pluginDir?: string;
	ledgerScope?: SkillLedgerScope;
}

type SkillCatalogRejected =
	| ReturnType<SkillCommandDeps["discover"]>["rejected"][number]
	| PersistedSkillLoadResult["rejected"][number];

/**
 * The scope roots for the skills ledger: the user home, the workspace root, and
 * (opt-in) the org root. Resolved from env/cwd by default; injected for tests.
 * openScopedLedger's user scope appends `.refarm` itself, so the user root is the
 * PARENT of the resolved refarm home. Org is absent unless REFARM_ORG_HOME is set.
 */
export interface SkillLedgerRoots {
	userHome: string;
	workspaceRoot: string;
	orgRoot?: string;
}

function defaultSkillLedgerRoots(env = process.env): SkillLedgerRoots {
	return {
		userHome: dirname(resolveRefarmHome(env)),
		workspaceRoot: process.cwd(),
		...(resolveOrgRoot(env) ? { orgRoot: resolveOrgRoot(env) } : {}),
	};
}

/** Open the skills ledger at ONE scope (for a scoped write). */
function openSkillLedgerAt(scope: SkillLedgerScope, roots: SkillLedgerRoots) {
	return openScopedLedger("skills", scope, roots);
}

function importedSkillNode(skill: ImportedAgentSkill) {
	return {
		"@id": skill.id,
		"@type": IMPORTED_SKILL_NODE_TYPE,
		surfaceId: skill.surfaceId,
		name: skill.name,
		...(skill.description ? { description: skill.description } : {}),
		requiredCapabilities: [...skill.requiredCapabilities],
		instructions: skill.instructions,
	};
}

export async function persistImportedSkillsToLedger(
	skills: ImportedAgentSkill[],
	scope: SkillLedgerScope = "user",
	roots: SkillLedgerRoots = defaultSkillLedgerRoots(),
): Promise<string[]> {
	const ledger = openSkillLedgerAt(scope, roots);
	const written: string[] = [];
	for (const skill of skills) {
		await ledger.storeNode(importedSkillNode(skill) as never);
		written.push(skill.id);
	}
	return written;
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string")
		: [];
}

function persistedSkillFromNode(
	node: Record<string, unknown>,
	scope: SkillLedgerScope,
): { skill?: PersistedSkill; issues: string[] } {
	const issues: string[] = [];
	const id =
		typeof node["@id"] === "string" && node["@id"].trim()
			? node["@id"]
			: undefined;
	const name =
		typeof node.name === "string" && node.name.trim() ? node.name : undefined;
	const instructions =
		typeof node.instructions === "string" && node.instructions.trim()
			? node.instructions
			: undefined;
	if (!id) issues.push("Expected persisted skill node to carry a string @id.");
	if (!name) issues.push("Expected persisted skill node to carry a name.");
	if (!instructions) {
		issues.push("Expected persisted skill node to carry instructions.");
	}
	if (issues.length > 0 || !id || !name || !instructions) return { issues };
	const surfaceId =
		typeof node.surfaceId === "string" && node.surfaceId.trim()
			? node.surfaceId
			: name;
	return {
		issues: [],
		skill: {
			surfaceId,
			id,
			name,
			...(typeof node.description === "string" && node.description.trim()
				? { description: node.description }
				: {}),
			requiredCapabilities: stringArray(node.requiredCapabilities),
			instructions,
			ledgerScope: scope,
		},
	};
}

/**
 * Load imported skills across ALL active ledger scopes and FOLD them with the
 * override doctrine: layers are read org → workspace → user, and for a given
 * content-addressed id the highest-precedence copy wins (user overrides
 * workspace overrides org). The org layer only participates when an org root is
 * present. Each returned skill is tagged with the scope it effectively came from.
 */
export async function loadPersistedImportedSkills(
	roots: SkillLedgerRoots = defaultSkillLedgerRoots(),
): Promise<PersistedSkillLoadResult> {
	// Apply order (lowest precedence first): org, workspace, user.
	const scopes: SkillLedgerScope[] = [
		...(roots.orgRoot ? (["org"] as const) : []),
		"workspace",
		"user",
	];
	const effective = new Map<string, PersistedSkill>();
	const rejected: PersistedSkillLoadResult["rejected"] = [];
	for (const scope of scopes) {
		const ledger = openSkillLedgerAt(scope, roots);
		const nodes = await ledger.queryNodes(IMPORTED_SKILL_NODE_TYPE);
		for (const node of nodes) {
			const result = persistedSkillFromNode(
				node as Record<string, unknown>,
				scope,
			);
			if (result.skill) {
				// Later scopes (higher precedence) overwrite the same id.
				effective.set(result.skill.id, result.skill);
				continue;
			}
			rejected.push({
				ledgerScope: scope,
				nodeId:
					typeof node["@id"] === "string" && node["@id"].trim()
						? node["@id"]
						: "(unknown)",
				issues: result.issues,
			});
		}
	}
	return { skills: [...effective.values()], rejected };
}

async function loadSkillCatalog(deps: SkillCommandDeps): Promise<{
	skills: CatalogSkill[];
	rejected: SkillCatalogRejected[];
}> {
	const discovered = deps.discover();
	const persisted = await deps.loadPersistedSkills();
	return {
		skills: [
			...discovered.skills.map((skill) => ({
				...skill,
				source: "plugin" as const,
			})),
			...persisted.skills.map((skill) => ({
				...skill,
				source: "imported" as const,
			})),
		],
		rejected: [...discovered.rejected, ...persisted.rejected],
	};
}

export function defaultSkillDeps(): SkillCommandDeps {
	return {
		discover: () => loadSkillsFromPluginsDir(pluginsBaseDir()),
		loadPersistedSkills: () => loadPersistedImportedSkills(),
		loadCheckers: async () => {
			// Always include the bundled reference checker; add every
			// plugin-contributed one, each sandboxed by the same host loader.
			const checkers: ReferenceChecker[] = [await createReferenceChecker()];
			const { checkers: discovered } = loadCheckersFromPluginsDir(
				pluginsBaseDir(),
			);
			for (const c of discovered) {
				try {
					checkers.push(
						await loadCheckerComponent({ pkgDir: c.pkgDir, entry: c.entry }),
					);
				} catch {
					// A broken checker component must not block the others.
				}
			}
			return checkers;
		},
		importSkills: (dir) => loadAgentSkillsFromDir(dir),
		persistSkills: (skills, scope) =>
			persistImportedSkillsToLedger(skills, scope),
	};
}

/** Map a checker finding to a resolvable pending-action recommendation. */
function findingToRecommendation(
	skillId: string,
	finding: CheckerFinding,
): DiagnosticRecommendation {
	return {
		diagnostic: finding.ruleId,
		summary: finding.message,
		severity: finding.severity === "info" ? "info" : "warning",
		action: `Revise the skill's instructions to resolve "${finding.ruleId}".`,
		command: `skill show ${skillId}`,
		target: skillId,
	};
}

/** A skill projected for output — the addressable summary a surface renders. */
function projectSkill(skill: CatalogSkill) {
	return {
		id: skill.id,
		name: skill.name,
		...(skill.description ? { description: skill.description } : {}),
		requiredCapabilities: skill.requiredCapabilities,
		surfaceId: skill.surfaceId,
		source: skill.source,
		sourceLabel:
			skill.source === "plugin"
				? (skill.pluginId ?? "unknown plugin")
				: `imported ledger (${skill.ledgerScope ?? "user"})`,
		...(skill.pluginId ? { pluginId: skill.pluginId } : {}),
		...(skill.ledgerScope ? { ledgerScope: skill.ledgerScope } : {}),
		// Permissive skills declare no capabilities — surfaced as a hint, never a
		// gate (completeness is a policy evaluator's concern, not this listing's).
		maturity: skill.requiredCapabilities.length > 0 ? "complete" : "permissive",
	};
}

export function createSkillCapabilityGroup(
	deps: SkillCommandDeps = defaultSkillDeps(),
): CapabilityGroup {
	const list: CapabilityDescriptor = {
		name: "list",
		summary: "List plugin-declared and imported skills",
		async run() {
			const { skills, rejected } = await loadSkillCatalog(deps);
			return buildJsonSuccessEnvelope({
				command: "skill",
				operation: "list",
				extra: {
					skills: skills.map(projectSkill),
					rejected,
					count: skills.length,
				},
			});
		},
	};

	const show: CapabilityDescriptor = {
		name: "show",
		summary: "Show one discovered skill by id",
		args: [{ name: "id", required: true }],
		async run(input) {
			const id = input.args.id as string;
			const { skills } = await loadSkillCatalog(deps);
			const skill = skills.find((s) => s.id === id || s.name === id);
			if (!skill) {
				return buildJsonErrorEnvelope({
					command: "skill",
					operation: "show",
					error: "skill-not-found",
					message: `No skill matches "${id}".`,
					nextAction:
						"Run `skill list` to see plugin-declared and imported skills.",
				});
			}
			return buildJsonSuccessEnvelope({
				command: "skill",
				operation: "show",
				extra: { skill: projectSkill(skill) },
			});
		},
	};

	const check: CapabilityDescriptor = {
		name: "check",
		summary: "Run quality checkers over a skill's instructions",
		args: [{ name: "id", required: true }],
		async run(input) {
			const id = input.args.id as string;
			const { skills } = await loadSkillCatalog(deps);
			const skill = skills.find((s) => s.id === id || s.name === id);
			if (!skill) {
				return buildJsonErrorEnvelope({
					command: "skill",
					operation: "check",
					error: "skill-not-found",
					message: `No skill matches "${id}".`,
					nextAction:
						"Run `skill list` to see plugin-declared and imported skills.",
				});
			}

			// Every checker inspects the SAME subject (the skill's instructions);
			// findings aggregate across the bundled + plugin-contributed checkers.
			const checkers = await deps.loadCheckers();
			const subject = { tag: "text" as const, val: skill.instructions };
			const findings: CheckerFinding[] = [];
			for (const checker of checkers) {
				findings.push(...checker.check(subject, SKILL_TELLS_PROFILE));
			}

			const recommendations = findings.map((f) =>
				findingToRecommendation(skill.id, f),
			);
			// Findings are POLICY, not a gate: check reports them as resolvable
			// pending-actions on the tri-interface (CLI/REPL/agent) and stays ok —
			// a permissive skill with tells still exists; the operator is nudged.
			return buildDiagnosticNextActionPayload({
				ok: true,
				command: "skill",
				operation: "check",
				skill: projectSkill(skill),
				findingCount: findings.length,
				checkersRun: checkers.length,
				recommendations,
				nextActions: diagnosticNextActions(recommendations),
				nextCommands: diagnosticNextCommands(recommendations),
			});
		},
	};

	const importAction: CapabilityDescriptor = {
		name: "import",
		summary:
			"Import Agent Skills (agentskills.io SKILL.md) from a directory into refarm's model",
		args: [{ name: "dir", required: true }],
		options: [
			{
				name: "write",
				kind: "boolean",
				summary:
					"Persist the imported skills into refarm's store (content-addressed nodes)",
			},
			{
				name: "scope",
				kind: "string",
				summary:
					"Ledger scope to persist into: user (default) | workspace | org",
				defaultValue: "user",
			},
		],
		async run(input) {
			const dir = input.args.dir as string;
			const write = Boolean(input.options.write);
			const scope = parseSkillLedgerScope(input.options.scope as string);
			if (scope === null) {
				return buildJsonErrorEnvelope({
					command: "skill",
					operation: "import",
					error: "unknown-ledger-scope",
					message: `Unknown ledger scope: ${input.options.scope}. Use user, workspace, or org.`,
					nextAction: "Retry with --scope user|workspace|org.",
				});
			}
			const { skills, rejected } = deps.importSkills(dir);
			// Default is REPORT-ONLY: surface WHAT would import on every surface.
			// With --write, persist each skill as a content-addressed node into the
			// chosen scope (user/workspace/org). The sha256-derived id is the @id —
			// idempotent, and the seam a future p2p/OPFS resolver reuses unchanged.
			const persisted = write ? await deps.persistSkills(skills, scope) : [];
			const imported = skills.map((s) => ({
				name: s.name,
				id: s.id,
				...(s.description ? { description: s.description } : {}),
				requiredCapabilities: s.requiredCapabilities,
				skillDir: s.skillDir,
				translated: s.translated,
			}));
			return buildJsonSuccessEnvelope({
				command: "skill",
				operation: "import",
				extra: {
					source: dir,
					imported,
					rejected,
					count: imported.length,
					written: persisted,
					persisted: write,
					scope,
				},
				...(write
					? {}
					: {
							nextCommand:
								imported.length > 0
									? `skill import ${dir} --write`
									: undefined,
						}),
			});
		},
	};

	return {
		name: "skill",
		summary: "Inspect skills declared by installed plugins",
		actions: { list, show, check, import: importAction },
		// Bare `skill` / `/skill` lists what's available (read-only default).
		defaultAction: "list",
		transports: {
			cli: {},
			repl: { slashAliases: ["skills"] },
			http: { method: "GET", path: "/skills" },
		},
		renderers: { tui: { section: "extensions" } },
	};
}

type SkillProjection = ReturnType<typeof projectSkill>;

function formatMaturity(maturity: string): string {
	return maturity === "permissive"
		? chalk.yellow("permissive")
		: chalk.green("complete");
}

function formatSkillLine(skill: SkillProjection): string {
	const caps =
		skill.requiredCapabilities.length > 0
			? skill.requiredCapabilities.join(", ")
			: chalk.dim("(none declared)");
	return [
		`  ${chalk.bold(skill.name)}  ${chalk.dim(skill.id)}`,
		`    from:         ${skill.sourceLabel}`,
		`    maturity:     ${formatMaturity(skill.maturity)}`,
		`    capabilities: ${caps}`,
		...(skill.description ? [`    ${skill.description}`] : []),
	].join("\n");
}

function formatRejectedSource(rejection: SkillCatalogRejected): string {
	if ("pluginDir" in rejection) return rejection.pluginDir;
	if ("nodeId" in rejection) {
		return `imported ledger (${rejection.ledgerScope}) ${rejection.nodeId}`;
	}
	return "unknown skill source";
}

/**
 * Per-sub-action text rendering, mirroring the human output style of the other
 * capability groups. Exit intent stays here (a surface concern), never in run().
 */
export function skillCapabilityHooks(subVerb: string): CapabilitySurfaceHooks {
	const renderError = (envelope: { message?: string; error?: string }): string =>
		chalk.red(`✗  ${envelope.message ?? envelope.error ?? "skill error"}`);

	switch (subVerb) {
		case "list":
			return {
				renderText: (envelope) => {
					const e = envelope as unknown as {
						skills: SkillProjection[];
						rejected: SkillCatalogRejected[];
						count: number;
					};
					if (e.count === 0) {
						return chalk.dim(
							"No skills found. Install a plugin that declares a pi/skill surface or run `skill import <dir> --write`.",
						);
					}
					const lines = [
						`Skills (${e.count})`,
						...e.skills.map(formatSkillLine),
					];
					if (e.rejected.length > 0) {
						lines.push(
							chalk.yellow(
								`\n${e.rejected.length} skill source(s) could not load:`,
							),
							...e.rejected.map(
								(r) =>
									`  ${chalk.dim(formatRejectedSource(r))}: ${r.issues.join("; ")}`,
							),
						);
					}
					return lines.join("\n");
				},
			};
		case "show":
			return {
				renderText: (envelope) => {
					if (envelope.ok === false) return renderError(envelope);
					const { skill } = envelope as unknown as { skill: SkillProjection };
					return formatSkillLine(skill);
				},
			};
		case "check":
			return {
				renderText: (envelope) => {
					if (envelope.ok === false) return renderError(envelope);
					const e = envelope as unknown as {
						skill: SkillProjection;
						findingCount: number;
						checkersRun: number;
						recommendations: DiagnosticRecommendation[];
						nextActions: string[];
					};
					const header = `Quality check: ${chalk.bold(e.skill.name)}  ${chalk.dim(
						`(${e.checkersRun} checker${e.checkersRun === 1 ? "" : "s"})`,
					)}`;
					if (e.findingCount === 0) {
						return `${header}\n  ${chalk.green("✓ no findings")}`;
					}
					const lines = [
						header,
						...e.recommendations.map(
							(r) =>
								`  ${chalk.yellow("⚠")} ${chalk.dim(r.diagnostic)}  ${r.summary}`,
						),
						chalk.dim(`\n  ${e.nextActions.length} pending action(s):`),
						...e.nextActions.map((a) => `    → ${a}`),
					];
					return lines.join("\n");
				},
			};
		case "import":
			return {
				renderText: (envelope) => {
					if (envelope.ok === false) return renderError(envelope);
					const e = envelope as unknown as {
						source: string;
						imported: {
							name: string;
							id: string;
							translated: {
								nameInjected: boolean;
								newlinesNormalized: boolean;
							};
						}[];
						rejected: { skillDir: string; issues: string[] }[];
						count: number;
						persisted: boolean;
						written: string[];
					};
					if (e.count === 0 && e.rejected.length === 0) {
						return chalk.dim(`No Agent Skills found under ${e.source}.`);
					}
					const verb = e.persisted ? "Imported" : "Importable";
					const lines = [
						`${verb} Agent Skills from ${chalk.dim(e.source)} (${e.count})`,
						...e.imported.map((s) => {
							const tags: string[] = [];
							if (s.translated.nameInjected) tags.push("name-injected");
							if (s.translated.newlinesNormalized) {
								tags.push("newline-normalized");
							}
							const suffix = tags.length
								? `  ${chalk.dim(`(${tags.join(", ")})`)}`
								: "";
							return `  ${chalk.bold(s.name)}  ${chalk.dim(s.id)}${suffix}`;
						}),
					];
					if (e.rejected.length > 0) {
						lines.push(
							chalk.yellow(`\n${e.rejected.length} could not import:`),
							...e.rejected.map(
								(r) => `  ${chalk.dim(r.skillDir)}: ${r.issues.join("; ")}`,
							),
						);
					}
					if (e.persisted) {
						lines.push(
							chalk.green(
								`\n✓ persisted ${e.written.length} skill(s) as content-addressed nodes`,
							),
						);
					} else if (e.count > 0) {
						lines.push(
							chalk.dim("\nRe-run with --write to persist these into refarm."),
						);
					}
					return lines.join("\n");
				},
			};
		default:
			return {};
	}
}
