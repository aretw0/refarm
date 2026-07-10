import {
	createFsAssetResolver,
	createFsAssetStore,
	layeredAssetResolver,
} from "@refarm.dev/asset-resolver-contract-v1/node";
import type {
	CapabilityDescriptor,
	CapabilityGroup,
} from "@refarm.dev/capabilities";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
} from "@refarm.dev/capabilities/envelope";
import {
	loadAgentSkillsFromDir,
	loadCheckersFromPluginsDir,
	loadProfilesFromPluginsDir,
	loadSkillsFromPluginsDir,
	type DiscoveredSkill,
	type ImportedAgentSkill,
} from "@refarm.dev/plugin-surface-loader/node";
import {
	createReferenceChecker,
	loadCheckerComponent,
	type CheckerFinding,
	type CheckerProfile,
	type ReferenceChecker,
} from "@refarm.dev/quality-checker-ref";
import {
	openScopedLedger,
	scopedAssetsDir,
} from "@refarm.dev/storage-node-view";
import chalk from "chalk";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
	pluginsBaseDir,
	resolveOrgRoot,
	resolveRefarmHome,
} from "../utils/refarm-home.js";
import {
	type CapabilitySurfaceHooks,
	renderCapabilityError,
} from "./capability-commander.js";
import {
	buildDiagnosticNextActionPayload,
	diagnosticNextActions,
	diagnosticNextCommands,
	type DiagnosticRecommendation,
} from "./diagnostic-recommendations.js";
import {
	runSkillInvocation,
	type SkillInvocationDecisionV1,
	type SkillInvocationSource,
} from "./skill-invoke.js";

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
	 * Load quality PROFILES contributed by installed plugins — rules-as-data
	 * rulesets (matcher-is-data) the checkers run in ADDITION to the built-in
	 * skill-tells profile. A profile is inert data (no behavior), so a plugin can
	 * safely extend what `check` flags without shipping code. Defaults to scanning
	 * the plugins dir; injected so `check` run() stays testable.
	 */
	loadProfiles: () => CheckerProfile[];
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

/** JSON-LD type of a persisted skill invocation decision (the approval record). */
const SKILL_INVOCATION_DECISION_NODE_TYPE = "refarm:skill-invocation-decision";

/**
 * The ledger node for a recorded invocation decision — the approval gate's
 * durable output. It carries the skill identity, the decision + reason, and the
 * per-capability grants; the full decision (plan/request included) lives in
 * `decision`. It is NOT a receipt: the contract stays plan-only, so `executed` is
 * never set here — this records that the host approved/denied, not that anything
 * ran.
 */
function skillInvocationDecisionNode(decision: SkillInvocationDecisionV1) {
	return {
		"@id": `urn:refarm:skill-invocation-decision:${decision.request.skill.id}:${decision.decision}`,
		"@type": SKILL_INVOCATION_DECISION_NODE_TYPE,
		skillId: decision.request.skill.id,
		skillName: decision.request.skill.name,
		decision: decision.decision,
		reason: decision.reason,
		capabilityDecisions: decision.capabilityDecisions,
		requiresRuntimeDispatch: decision.requiresRuntimeDispatch,
		fullDecision: decision,
	};
}

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

/**
 * The imported-skill LEDGER node is a POINTER, not a container: it carries the
 * skill's identity + metadata and the content-address of its instructions, but
 * NOT the instruction bytes themselves. Those live once in the scope's
 * content-store (`<scope>/.refarm/assets/<sha256>`), keyed by hash.
 *
 * `sha256` is the address of the STORED bytes (the instructions, exactly what the
 * loader resolves + verifies) — it MUST equal `createFsAssetStore.store()`'s
 * result, or the round-trip mismatches. `sourceSha256` is separate provenance:
 * the hash of the whole SKILL.md source file (`skill.source.sha256`), which the
 * parser reports and which differs from the instructions body it extracts. Keep
 * both — one addresses what we store, the other records what we imported from.
 */
function importedSkillNode(
	skill: ImportedAgentSkill,
	stored: { hash: string; bytes: number },
) {
	return {
		"@id": skill.id,
		"@type": IMPORTED_SKILL_NODE_TYPE,
		surfaceId: skill.surfaceId,
		name: skill.name,
		...(skill.description ? { description: skill.description } : {}),
		requiredCapabilities: [...skill.requiredCapabilities],
		sha256: stored.hash,
		bytes: stored.bytes,
		sourceSha256: skill.source.sha256,
	};
}

export async function persistImportedSkillsToLedger(
	skills: ImportedAgentSkill[],
	scope: SkillLedgerScope = "user",
	roots: SkillLedgerRoots = defaultSkillLedgerRoots(),
): Promise<string[]> {
	const ledger = openSkillLedgerAt(scope, roots);
	const store = createFsAssetStore(scopedAssetsDir(scope, roots));
	const written: string[] = [];
	for (const skill of skills) {
		// Move the bytes into the content-store FIRST (idempotent — same content →
		// same address), then persist a pointer keyed on the STORED address, so the
		// node references bytes that are already present and verify on read.
		const stored = await store.store(
			new TextEncoder().encode(skill.instructions),
		);
		await ledger.storeNode(importedSkillNode(skill, stored) as never);
		written.push(skill.id);
	}
	return written;
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string")
		: [];
}

/** A validated skill POINTER — everything but the instruction bytes, plus the
 * `sha256` content-address the loader resolves those bytes from. */
interface SkillPointer {
	surfaceId: string;
	id: string;
	name: string;
	description?: string;
	requiredCapabilities: readonly string[];
	sha256: string;
	ledgerScope: SkillLedgerScope;
}

/**
 * Validate a persisted node into a POINTER (no bytes). The node must carry the
 * `sha256` content-address of its instructions; the bytes are resolved separately
 * from the content-store. A legacy node that still inlines `instructions` without
 * a `sha256` is rejected here — the loader falls back to the inline bytes so the
 * migration is non-destructive (see {@link loadPersistedImportedSkills}).
 */
function skillPointerFromNode(
	node: Record<string, unknown>,
	scope: SkillLedgerScope,
): { pointer?: SkillPointer; issues: string[] } {
	const issues: string[] = [];
	const id =
		typeof node["@id"] === "string" && node["@id"].trim()
			? node["@id"]
			: undefined;
	const name =
		typeof node.name === "string" && node.name.trim() ? node.name : undefined;
	const sha256 =
		typeof node.sha256 === "string" && node.sha256.trim()
			? node.sha256
			: undefined;
	if (!id) issues.push("Expected persisted skill node to carry a string @id.");
	if (!name) issues.push("Expected persisted skill node to carry a name.");
	if (!sha256) {
		issues.push("Expected persisted skill node to carry a sha256 content-address.");
	}
	if (issues.length > 0 || !id || !name || !sha256) return { issues };
	const surfaceId =
		typeof node.surfaceId === "string" && node.surfaceId.trim()
			? node.surfaceId
			: name;
	return {
		issues: [],
		pointer: {
			surfaceId,
			id,
			name,
			...(typeof node.description === "string" && node.description.trim()
				? { description: node.description }
				: {}),
			requiredCapabilities: stringArray(node.requiredCapabilities),
			sha256,
			ledgerScope: scope,
		},
	};
}

/** Legacy fallback: a node that still inlines `instructions` (pre-content-store)
 * with no `sha256`. Read verbatim so old ledgers keep listing while unmigrated. */
function legacyInlineSkill(
	node: Record<string, unknown>,
	scope: SkillLedgerScope,
): PersistedSkill | null {
	if (typeof node.sha256 === "string" && node.sha256.trim()) return null;
	const id = typeof node["@id"] === "string" ? node["@id"].trim() : "";
	const name = typeof node.name === "string" ? node.name.trim() : "";
	const instructions =
		typeof node.instructions === "string" ? node.instructions : "";
	if (!id || !name || !instructions.trim()) return null;
	const surfaceId =
		typeof node.surfaceId === "string" && node.surfaceId.trim()
			? node.surfaceId
			: name;
	return {
		surfaceId,
		id,
		name,
		...(typeof node.description === "string" && node.description.trim()
			? { description: node.description }
			: {}),
		requiredCapabilities: stringArray(node.requiredCapabilities),
		instructions,
		ledgerScope: scope,
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
	// A byte resolver layered across every active scope's content-store. Bytes are
	// resolved by hash and VERIFIED before use — a pointer node can only yield
	// instructions whose sha256 matches, and a copy in any layer satisfies it (a
	// skill imported at org resolves even when listed from user).
	const resolver = layeredAssetResolver(
		scopes.map((scope) => createFsAssetResolver(scopedAssetsDir(scope, roots))),
	);

	const effectivePointers = new Map<string, SkillPointer>();
	const effectiveLegacy = new Map<string, PersistedSkill>();
	const rejected: PersistedSkillLoadResult["rejected"] = [];
	for (const scope of scopes) {
		const ledger = openSkillLedgerAt(scope, roots);
		const nodes = await ledger.queryNodes(IMPORTED_SKILL_NODE_TYPE);
		for (const node of nodes) {
			const record = node as Record<string, unknown>;
			const result = skillPointerFromNode(record, scope);
			if (result.pointer) {
				// Later scopes (higher precedence) overwrite the same id.
				effectivePointers.set(result.pointer.id, result.pointer);
				effectiveLegacy.delete(result.pointer.id);
				continue;
			}
			// Non-destructive migration: a legacy inline node still lists.
			const legacy = legacyInlineSkill(record, scope);
			if (legacy && !effectivePointers.has(legacy.id)) {
				effectiveLegacy.set(legacy.id, legacy);
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

	// Resolve each pointer's instruction bytes from the content-store.
	const skills: PersistedSkill[] = [...effectiveLegacy.values()];
	for (const pointer of effectivePointers.values()) {
		const resolution = await resolver.resolve({ hash: pointer.sha256 });
		if (!resolution.ok) {
			rejected.push({
				ledgerScope: pointer.ledgerScope,
				nodeId: pointer.id,
				issues: [
					`could not resolve instruction bytes for sha256 ${pointer.sha256}: ${resolution.reason}`,
				],
			});
			continue;
		}
		const { sha256: _sha256, ...rest } = pointer;
		skills.push({
			...rest,
			instructions: new TextDecoder().decode(resolution.bytes),
		});
	}
	return { skills, rejected };
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
		loadProfiles: () => {
			const { profiles } = loadProfilesFromPluginsDir(pluginsBaseDir());
			// Normalize each rule's `check` to the checker's string contract: a
			// plugin may author it as a JSON object (natural in a profile asset) or
			// already as a string; both become the opaque JSON string the checker
			// interprets (matcher-is-data).
			return profiles.map((p) => ({
				name: p.name,
				rules: p.rules.map((r) => ({
					id: r.id,
					severity: r.severity,
					description: r.description,
					...(r.category ? { category: r.category } : {}),
					check: typeof r.check === "string" ? r.check : JSON.stringify(r.check),
				})),
			}));
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
				// `show` is the read view of ONE skill, so it carries the resolved
				// instruction body (list stays lean — a summary per skill). For an
				// imported skill these bytes were just resolved + verified from the
				// content-store, so this is the honest, hash-checked text.
				extra: { skill: { ...projectSkill(skill), instructions: skill.instructions } },
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
			// findings aggregate across the bundled + plugin-contributed checkers,
			// each run over the built-in skill-tells profile AND every plugin-
			// contributed rules-as-data profile (matcher-is-data, no plugin code).
			const checkers = await deps.loadCheckers();
			const profiles = [SKILL_TELLS_PROFILE, ...deps.loadProfiles()];
			const subject = { tag: "text" as const, val: skill.instructions };
			const findings: CheckerFinding[] = [];
			for (const checker of checkers) {
				for (const profile of profiles) {
					findings.push(...checker.check(subject, profile));
				}
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

	const invokeAction: CapabilityDescriptor = {
		name: "invoke",
		summary:
			"Plan a skill invocation from a SKILL.md directory and record an approval decision (plan-only; never executes)",
		args: [{ name: "dir", required: true }],
		options: [
			{
				name: "input",
				kind: "string",
				summary: "The input body handed to the skill invocation request",
				defaultValue: "",
			},
			{
				name: "approve",
				kind: "string[]",
				summary:
					"Approve the invocation, granting these capability ids (repeatable)",
			},
			{ name: "deny", kind: "boolean", summary: "Deny the invocation" },
			{
				name: "reason",
				kind: "string",
				summary: "Reason recorded on the approval/denial decision",
			},
			{
				name: "scope",
				kind: "string",
				summary: "Ledger scope for a persisted decision: user | workspace | org",
				defaultValue: "user",
			},
		],
		async run(input) {
			const dir = input.args.dir as string;
			const manifestPath = join(dir, "SKILL.md");
			if (!existsSync(manifestPath)) {
				return buildJsonErrorEnvelope({
					command: "skill",
					operation: "invoke",
					error: "skill-md-not-found",
					message: `No SKILL.md found in "${dir}".`,
					nextAction: "Point invoke at a directory containing a SKILL.md.",
				});
			}
			const scope = parseSkillLedgerScope(input.options.scope as string);
			if (scope === null) {
				return buildJsonErrorEnvelope({
					command: "skill",
					operation: "invoke",
					error: "unknown-ledger-scope",
					message: `Unknown ledger scope: ${input.options.scope}. Use user, workspace, or org.`,
					nextAction: "Retry with --scope user|workspace|org.",
				});
			}

			// `--approve` is a repeatable string[] with a [] default, so an empty list
			// means the flag was NOT passed (not "approve zero capabilities"). An
			// approval intent therefore exists only when --deny is set OR --approve
			// granted at least one capability; otherwise this is a plan-only dry run.
			const approveList = (input.options.approve as string[] | undefined) ?? [];
			const deny = Boolean(input.options.deny);
			const hasApproval = deny || approveList.length > 0;
			const reason =
				(input.options.reason as string | undefined)?.trim() ||
				(deny ? "Denied by operator." : "Approved by operator.");
			const invokeInput = (input.options.input as string) ?? "";
			// An approval decision is about a concrete invocation, so it needs the
			// input the request binds. Guard it before the loop for a clear message.
			if (hasApproval && !invokeInput.trim()) {
				return buildJsonErrorEnvelope({
					command: "skill",
					operation: "invoke",
					error: "input-required-for-decision",
					message:
						"Recording an approval/denial needs --input (the invocation body the decision is about).",
					nextAction: `Retry with --input "<body>".`,
				});
			}
			const approval = hasApproval
				? {
						decision: deny ? ("denied" as const) : ("approved" as const),
						reason,
						...(deny ? {} : { approvedCapabilities: approveList }),
					}
				: undefined;

			const source: SkillInvocationSource = {
				label: manifestPath,
				read: () => readFileSync(manifestPath, "utf-8"),
			};
			// The decision sink is the SAME scoped node-ledger the imports use — a
			// neutral persistence seam, not a skill-specific store.
			const persistDecision = approval
				? async (decision: SkillInvocationDecisionV1) => {
						const ledger = openSkillLedgerAt(scope, defaultSkillLedgerRoots());
						await ledger.storeNode(
							skillInvocationDecisionNode(decision) as never,
						);
					}
				: undefined;

			const result = await runSkillInvocation(
				source,
				invokeInput,
				{ ...(persistDecision ? { persistDecision } : {}) },
				approval,
			);
			if (!result.ok) {
				return buildJsonErrorEnvelope({
					command: "skill",
					operation: "invoke",
					error: "invocation-failed",
					message: result.issues[0]?.message ?? "Could not plan the invocation.",
					nextAction: "Fix the reported issues in the SKILL.md and retry.",
					extra: { issues: result.issues, source: dir },
				});
			}
			return buildJsonSuccessEnvelope({
				command: "skill",
				operation: "invoke",
				extra: {
					source: dir,
					plan: result.plan,
					request: result.request,
					decision: result.decision,
					persisted: result.persisted,
					...(result.decision ? { scope } : {}),
				},
				...(result.decision
					? {}
					: {
							// Plan-only: nudge the approval gate. This is an instruction
							// (nextAction), not an executable handoff — the capability ids
							// to grant come from the plan above, so a literal command would
							// carry a placeholder, which executable handoffs must not.
							nextAction:
								"Record a decision with `skill invoke <dir> --input <body> --approve <cap>` (grant the plan's required capabilities) or `--deny`.",
						}),
			});
		},
	};

	return {
		name: "skill",
		summary: "Inspect skills declared by installed plugins",
		actions: { list, show, check, import: importAction, invoke: invokeAction },
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
					if (envelope.ok === false)
						return renderCapabilityError(envelope, "skill error");
					const { skill } = envelope as unknown as { skill: SkillProjection };
					return formatSkillLine(skill);
				},
			};
		case "check":
			return {
				renderText: (envelope) => {
					if (envelope.ok === false)
						return renderCapabilityError(envelope, "skill error");
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
					if (envelope.ok === false)
						return renderCapabilityError(envelope, "skill error");
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
