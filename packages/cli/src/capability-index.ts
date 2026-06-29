import { refarmCommand } from "./command-handoff.js";
import { INTERACTION_DRIVER_GATEWAY_BLOCKERS } from "./interaction-driver.js";
import { WORKER_TOOL_RUNTIME_DISPATCH_BLOCKERS } from "./worker-profile.js";

export const REFARM_CAPABILITY_INDEX_SCHEMA_VERSION = 1 as const;

export type RefarmCapabilityProviderKind =
	| "cli"
	| "sdk"
	| "runtime"
	| "policy"
	| "ui";

export type RefarmCapabilityPolicyState =
	| "planned"
	| "governed"
	| "proven";

export interface RefarmCapabilityProvider {
	kind: RefarmCapabilityProviderKind;
	package?: string;
	surface?: string;
}

export interface RefarmCapabilityActivation {
	command?: string;
	sdk?: string;
}

export interface RefarmCapabilityPolicy {
	state: RefarmCapabilityPolicyState;
	enforcement: readonly string[];
	evidence: readonly string[];
}

export interface RefarmCapabilityDescriptor {
	id: string;
	title: string;
	description: string;
	provider: RefarmCapabilityProvider;
	requirements: readonly string[];
	policy: RefarmCapabilityPolicy;
	activation: RefarmCapabilityActivation;
	tags: readonly string[];
}

export interface RefarmCapabilityIndex {
	schemaVersion: typeof REFARM_CAPABILITY_INDEX_SCHEMA_VERSION;
	capabilities: readonly RefarmCapabilityDescriptor[];
}

export type RefarmCapabilitySupplyChannel =
	| "npm"
	| "crate"
	| "wit"
	| "runtime";

export type RefarmCapabilitySupplyStatus =
	| "exported"
	| "candidate"
	| "internal"
	| "hold";

export interface RefarmCapabilitySupplyTarget {
	channel: RefarmCapabilitySupplyChannel;
	name: string;
	export?: string;
	path?: string;
	status: RefarmCapabilitySupplyStatus;
	note: string;
}

export interface ReferenceDriverSourceReference {
	name: string;
	url: string;
}

export interface ReferenceDriverSupplyEntry {
	capabilityId: string;
	provider: RefarmCapabilityProvider;
	policyState: RefarmCapabilityPolicyState;
	activation: RefarmCapabilityActivation;
	referenceSources: readonly ReferenceDriverSourceReference[];
	referenceLessons: readonly string[];
	promotionProofTargets: readonly string[];
	targets: readonly RefarmCapabilitySupplyTarget[];
	nextDecision: string;
}

export interface ReferenceDriverSupplyMap {
	schemaVersion: typeof REFARM_CAPABILITY_INDEX_SCHEMA_VERSION;
	discoverySdk: "@refarm.dev/cli/capability-index";
	smokeCommand: "pnpm run reference-driver:smoke";
	entries: readonly ReferenceDriverSupplyEntry[];
}

export interface ReferenceDriverSupplyPreflightTarget extends RefarmCapabilitySupplyTarget {
	capabilityId: string;
}

export interface ReferenceDriverSupplyPreflightSummary {
	status: Exclude<RefarmCapabilitySupplyStatus, "exported">;
	count: number;
}

export interface ReferenceDriverSupplyPreflight {
	schemaVersion: typeof REFARM_CAPABILITY_INDEX_SCHEMA_VERSION;
	source: "@refarm.dev/cli/capability-index";
	mode: "plan-only";
	targets: readonly ReferenceDriverSupplyPreflightTarget[];
	summary: readonly ReferenceDriverSupplyPreflightSummary[];
	nextDecisions: readonly {
		capabilityId: string;
		nextDecision: string;
	}[];
}

const CAPABILITIES = [
	{
		id: "runtime-agent.ask",
		title: "Runtime agent ask loop",
		description:
			"Submit a prompt to the runtime agent, follow stream output, and persist session/task handoffs.",
		provider: {
			kind: "runtime",
			package: "@refarm.dev/pi-agent",
			surface: "apps/refarm ask",
		},
		requirements: [
			"Runtime ready",
			"Usable model route",
			"runtime-agent plugin loaded",
		],
		policy: {
			state: "proven",
			enforcement: [
				"WIT host capabilities",
				"runtime-agent effort handoff",
				"session/task checkpoint recorder",
			],
			evidence: [
				"apps/refarm/test/commands/ask.test.ts",
				"scripts/ci/smoke-refarm-agent-model-mock.mjs",
			],
		},
		activation: {
			command: refarmCommand(["ask", "ok", "--json"]),
		},
		tags: ["daily-driver", "runtime", "streaming", "reference-driver"],
	},
	{
		id: "project-handoff.governed",
		title: "Governed project handoff",
		description:
			"Validate and write durable project recovery state without relying on chat memory.",
		provider: {
			kind: "sdk",
			package: "@refarm.dev/cli",
			surface: "project-handoff",
		},
		requirements: [".project/handoff.json for repository state"],
		policy: {
			state: "proven",
			enforcement: [
				"schema validation",
				"freshness warning",
				"explicit write command",
			],
			evidence: [
				"packages/cli/src/project-handoff.test.ts",
				"apps/refarm/test/commands/project.test.ts",
			],
		},
		activation: {
			command: refarmCommand(["project", "handoff", "validate", "--json"]),
			sdk: "@refarm.dev/cli/project-handoff",
		},
		tags: ["handoff", "memory", "sdk"],
	},
	{
		id: "project-automations.governed",
		title: "Governed project automations",
		description:
			"Validate, list, write, and lifecycle project-local automations that resume can surface without running a daemon.",
		provider: {
			kind: "sdk",
			package: "@refarm.dev/cli",
			surface: "project-automations",
		},
		requirements: [".project/automations.json for project-local automations"],
		policy: {
			state: "proven",
			enforcement: [
				"schema validation",
				"explicit write command",
				"explicit lifecycle command",
				"health/check visibility",
			],
			evidence: [
				"packages/cli/src/project-automations.test.ts",
				"apps/refarm/test/commands/project.test.ts",
				"packages/health/src/auditors/project.test.js",
			],
		},
		activation: {
			command: refarmCommand(["project", "automations", "validate", "--json"]),
			sdk: "@refarm.dev/cli/project-automations",
		},
		tags: ["automation", "handoff", "scheduler", "sdk"],
	},
	{
		id: "agent-finish.lanes",
		title: "Agent finish lanes",
		description:
			"Run scoped end-of-slice validation with machine-readable next commands.",
		provider: {
			kind: "cli",
			package: "@refarm.dev/cli",
			surface: "agent finish",
		},
		requirements: ["Git checkout", "package manager available"],
		policy: {
			state: "proven",
			enforcement: [
				"affected validation profile",
				"health/check gates",
				"JSON nextCommands contract",
			],
			evidence: [
				"apps/refarm/test/commands/json-next-command-contract.test.ts",
				"packages/cli/src/command-plan.test.ts",
			],
		},
		activation: {
			command: refarmCommand([
				"agent",
				"finish",
				"--lane",
				"after-edit",
				"--run",
				"--json",
			]),
		},
		tags: ["validation", "handoff", "resource-discipline"],
	},
	{
		id: "policy.shell-audit",
		title: "Runtime shell policy audit",
		description:
			"Gate shell-capable plugin execution by allowlist, filesystem root, trusted plugin, and audit telemetry.",
		provider: {
			kind: "policy",
			package: "@refarm.dev/tractor",
			surface: "Scarecrow audit",
		},
		requirements: [
			"MODEL_SHELL_ALLOWLIST",
			"MODEL_FS_ROOT",
			"trusted_plugins",
		],
		policy: {
			state: "proven",
			enforcement: [
				"host shell allowlist",
				"filesystem root guard",
				"trusted plugin guard",
				"agent-tool:shell:spawn audit event",
			],
			evidence: [
				"packages/tractor shell policy unit tests",
				"REFARM_AGENT_MOCK_POLICY_PROOF=1 runtime-agent smoke",
			],
		},
		activation: {
			command: refarmCommand(["health", "--policy", "--json"]),
		},
		tags: ["policy", "audit", "runtime"],
	},
	{
		id: "stream-observation.ui",
		title: "Stream observation subscriber",
		description:
			"Render generic StreamSession and StreamChunk observations without schema-specific runtime coupling.",
		provider: {
			kind: "ui",
			package: "@refarm.dev/homestead",
			surface: "StudioShell stream slot",
		},
		requirements: [
			"Tractor observation stream",
			"StreamSession nodes",
			"StreamChunk nodes",
		],
		policy: {
			state: "proven",
			enforcement: [
				"schema-neutral BrowserSyncClient",
				"surface capability filtering",
			],
			evidence: [
				"packages/homestead/test/Shell.test.ts",
				"packages/homestead/test/stream-observer.test.ts",
			],
		},
		activation: {
			command: refarmCommand(["status", "--json"]),
		},
		tags: ["ui", "streaming", "daily-driver"],
	},
	{
		id: "runtime-agent.worker-profiles",
		title: "Runtime agent worker tools",
		description:
			"Describe bounded delegated workers as plan-only agent tools before runtime fanout is enabled.",
		provider: {
			kind: "runtime",
			package: "@refarm.dev/pi-agent",
			surface: "runtime-agent worker tools",
		},
		requirements: [
			"context packet",
			"allowed toolset",
			"model route",
			"bounded budget",
		],
		policy: {
			state: "governed",
			enforcement: [
				"explicit worker context",
				"bounded tool access",
				"plan-only invocation guard",
				"max turns and max concurrency",
			],
			evidence: [
				"packages/cli/src/worker-profile.test.ts",
				"scripts/ci/reference-driver-smoke.mjs",
				"docs/REFERENCE_AGENT_DRIVER_RESEARCH.md",
			],
		},
		activation: {
			sdk: "@refarm.dev/cli",
		},
		tags: ["runtime", "workers", "planning", "reference-driver"],
	},
	{
		id: "runtime-agent.session-tree",
		title: "Runtime agent session tree",
		description:
			"List, inspect, navigate, and fork CRDT-backed conversation sessions through runtime-agent tools.",
		provider: {
			kind: "runtime",
			package: "@refarm.dev/pi-agent",
			surface: "session tools",
		},
		requirements: [
			"CRDT Session nodes",
			"SessionEntry tree",
			"runtime-agent tool dispatch",
		],
		policy: {
			state: "proven",
			enforcement: [
				"session ownership validation",
				"leaf pointer navigation",
				"fork keeps source session intact",
			],
			evidence: [
				"packages/pi-agent/src/tool_dispatch/session_tools.rs",
				"packages/pi-agent/src/tests/session_schema_tests.rs",
				"packages/pi-agent/src/tests/history_tree_tests.rs",
			],
		},
		activation: {
			command: refarmCommand(["ask", "list my sessions", "--json"]),
		},
		tags: ["runtime", "session", "memory", "reference-driver"],
	},
	{
		id: "runtime-agent.structured-io",
		title: "Runtime agent structured IO",
		description:
			"Read and write JSON, TOML, and YAML through validated, paged runtime-agent tools.",
		provider: {
			kind: "runtime",
			package: "@refarm.dev/pi-agent",
			surface: "structured tools",
		},
		requirements: [
			"agent-tools structured-io",
			"filesystem capability",
			"format parser",
		],
		policy: {
			state: "proven",
			enforcement: [
				"format validation before write",
				"paged reads",
				"atomic write path",
			],
			evidence: [
				"packages/pi-agent/src/tool_dispatch/structured_tools.rs",
				"packages/pi-agent/src/tests/structured_read_tests.rs",
				"packages/pi-agent/src/tests/structured_validate_tests.rs",
			],
		},
		activation: {
			command: refarmCommand(["ask", "inspect package metadata", "--json"]),
		},
		tags: ["runtime", "tools", "structured-io", "reference-driver"],
	},
	{
		id: "runtime-agent.code-ops",
		title: "Runtime agent code ops",
		description:
			"Expose LSP-shaped find-references and rename-symbol tools behind a host capability boundary.",
		provider: {
			kind: "runtime",
			package: "@refarm.dev/pi-agent",
			surface: "code-ops tools",
		},
		requirements: [
			"connected language server",
			"host code-ops bridge",
			"source checkout",
		],
		policy: {
			state: "governed",
			enforcement: [
				"explicit symbol location",
				"host capability boundary",
				"rename result contract",
			],
			evidence: [
				"packages/pi-agent/src/tool_dispatch/code_ops_tools.rs",
				"packages/tractor/wit/host/agent-tools/world.wit",
				"packages/pi-agent/src/tests/tools_schema_tests.rs",
			],
		},
		activation: {
			command: refarmCommand(["ask", "find references for this symbol", "--json"]),
		},
		tags: ["runtime", "tools", "code-ops", "reference-driver"],
	},
	{
		id: "scheduler.local-jobs",
		title: "Local scheduled work",
		description:
			"Run one-shot and recurring no-token jobs with durable ownership and visible resume or health handoffs.",
		provider: {
			kind: "runtime",
			package: "@refarm.dev/windmill",
			surface: "scheduler",
		},
		requirements: [
			"local job store",
			"ownership metadata",
			"resume visibility",
		],
		policy: {
			state: "governed",
			enforcement: [
				"durable owner",
				"fail-closed model route",
				"health/resume visibility",
			],
			evidence: [
				"packages/windmill/src/local-scheduler.test.js",
				"docs/DAILY_DRIVER_PARITY.md",
				"docs/REFERENCE_AGENT_DRIVER_RESEARCH.md",
			],
		},
		activation: {
			sdk: "@refarm.dev/windmill/local-scheduler",
		},
		tags: ["automation", "scheduler", "planning"],
	},
] as const satisfies readonly RefarmCapabilityDescriptor[];

const REFERENCE_DRIVER_SUPPLY_TARGETS = {
	"runtime-agent.ask": {
		targets: [
			{
				channel: "runtime",
				name: "runtime-agent ask command",
				path: "apps/refarm/src/commands/ask.ts",
				status: "candidate",
				note:
					"Operator CLI ask loop is source-proven and mock-runtime proven; broader gateway/RPC promotion waits for steering, abort, resume, and event contract proofs.",
			},
			{
				channel: "npm",
				name: "@refarm.dev/cli interaction driver",
				export: "@refarm.dev/cli/interaction-driver",
				path: "packages/cli/src/interaction-driver.ts",
				status: "exported",
				note:
					"Product-neutral local-loop descriptor and gateway/RPC readiness SDK for consumers that need ask-loop promotion status without importing the app.",
			},
			{
				channel: "npm",
				name: "@refarm.dev/pi-agent",
				path: "packages/pi-agent",
				status: "hold",
				note:
					"Runtime-agent package remains private until plugin artifact policy and daily-driver mileage justify publishing the interaction engine.",
			},
		],
		nextDecision:
			"Keep ask as the local daily-driver spine; promote cross-surface gateway/RPC only after prompt acceptance, streaming, abort/steer/follow-up, resume, and provider-cost visibility are all locally proven.",
	},
	"runtime-agent.worker-profiles": {
		targets: [
			{
				channel: "npm",
				name: "@refarm.dev/cli",
				export: "@refarm.dev/cli",
				path: "packages/cli/src/index.ts",
				status: "exported",
				note:
					"Plan-only worker descriptor and readiness SDK for consumers that want agents-as-tools without runtime fanout; also available through @refarm.dev/cli/worker-profile.",
			},
			{
				channel: "npm",
				name: "@refarm.dev/cli worker profile SDK",
				export: "@refarm.dev/cli/worker-profile",
				path: "packages/cli/src/worker-profile.ts",
				status: "exported",
				note:
					"Dedicated worker profile subpath for consumers that only need bounded delegated-worker descriptors, readiness blockers, and result envelopes.",
			},
			{
				channel: "npm",
				name: "@refarm.dev/cli worker result envelope",
				export: "@refarm.dev/cli/worker-profile",
				path: "packages/cli/src/worker-profile.ts",
				status: "exported",
				note:
					"Worker result envelope requires compact summaries, declared output fields, handoffs, and issues for non-completed statuses; also available through @refarm.dev/cli/worker-profile.",
			},
			{
				channel: "runtime",
				name: "worker tool promotion gate",
				path: "packages/cli/src/worker-profile.ts",
				status: "candidate",
				note:
					"assessWorkerToolReadiness() is the promotion gate; runtime-dispatch remains blocked until local policy, cancellation, observability, and cost-control proofs exist.",
			},
			{
				channel: "npm",
				name: "@refarm.dev/pi-agent",
				path: "packages/pi-agent",
				status: "hold",
				note:
					"Runtime worker execution still belongs behind the private plugin boundary until dispatch policy is proven.",
			},
		],
		nextDecision:
			"Keep agents-as-tools plan-only with descriptor, readiness, and result envelopes; promote runtime dispatch only after the worker engine can prove policy, cancellation, observability, and provider cost bounds locally.",
	},
	"runtime-agent.session-tree": {
		targets: [
			{
				channel: "npm",
				name: "@refarm.dev/cli",
				export: "@refarm.dev/cli/capability-index",
				path: "packages/cli/src/capability-index.ts",
				status: "exported",
				note:
					"Discovery SDK for the reference-driver capability surface; it does not dispatch runtime tools.",
			},
			{
				channel: "npm",
				name: "@refarm.dev/pi-agent",
				path: "packages/pi-agent",
				status: "hold",
				note:
					"Runtime plugin package is still private; publish only after plugin artifact policy and daily-driver gate.",
			},
			{
				channel: "runtime",
				name: "session tree command",
				path: "apps/refarm/src/commands/tree.ts",
				status: "candidate",
				note:
					"Operator command exercises the session-tree primitive without exposing a separate SDK yet.",
			},
		],
		nextDecision:
			"Keep session-tree dispatch in the runtime plugin; expose a product-neutral SDK only after a second non-CLI consumer needs direct session navigation.",
	},
	"runtime-agent.structured-io": {
		targets: [
			{
				channel: "wit",
				name: "refarm:agent-tools@0.1.0",
				path: "packages/agent-tools/wit/world.wit",
				status: "internal",
				note:
					"WIT component boundary for structured reads/writes; not an npm/crate release surface yet.",
			},
			{
				channel: "npm",
				name: "@refarm.dev/pi-agent",
				path: "packages/pi-agent",
				status: "hold",
				note:
					"Runtime plugin consumes structured tools, but its npm package remains private until plugin distribution is ready.",
			},
		],
		nextDecision:
			"Promote structured-io through WIT/component distribution first; avoid an npm helper until consumers need non-WASM structured parsing.",
	},
	"runtime-agent.code-ops": {
		targets: [
			{
				channel: "wit",
				name: "refarm:plugin@0.1.0",
				path: "packages/refarm-plugin-wit/wit/refarm-plugin-host.wit",
				status: "internal",
				note:
					"Canonical host contract for code-ops; supplyable as WIT, but not promoted as an npm or crates.io package yet.",
			},
			{
				channel: "crate",
				name: "refarm-plugin-wit",
				path: "packages/refarm-plugin-wit",
				status: "internal",
				note:
					"Cargo package is publish=false and exists to give cargo-component a canonical WIT package source inside the workspace.",
			},
			{
				channel: "crate",
				name: "refarm-tractor",
				path: "packages/tractor",
				status: "hold",
				note:
					"Host LSP bridge implementation remains a reference runtime until the daily-driver gate allows publishing runtime crates.",
			},
		],
		nextDecision:
			"Keep refarm-plugin-wit internal; publish implementation crates only after runtime packaging policy is explicit and daily-driver evidence justifies it.",
	},
} as const satisfies Record<
	string,
	{
		targets: readonly RefarmCapabilitySupplyTarget[];
		nextDecision: string;
	}
>;

const REFERENCE_DRIVER_LESSONS: Record<string, readonly string[]> = {
	"runtime-agent.ask": [
		"Hermes: one interaction loop can serve CLI and messaging gateways, but the gateway must stay behind one contract.",
		"Pi: steering, follow-up, abort, and session state are part of the embeddable driver protocol.",
		"Codex/Claude: headless asks need machine-readable handoffs and lifecycle enforcement, not scraped terminal text.",
	],
	"runtime-agent.worker-profiles": [
		"Codex/Claude: isolate subagent context and return compact summaries.",
		"Hermes: keep delegation bounded; do not make worker fanout ambient.",
		"Pi: expose embeddable SDK/RPC shapes without forcing product labels.",
	],
	"runtime-agent.session-tree": [
		"Pi: branchable sessions, resume, fork, and export are first-class driver primitives.",
		"Codex/Hermes: durable context must survive terminal/session changes.",
	],
	"runtime-agent.structured-io": [
		"Codex/Pi: headless automation needs machine-readable payloads, not scraped text.",
		"Claude: keep memory/context separate from enforcement and validation.",
	],
	"runtime-agent.code-ops": [
		"Claude/Codex: code operations must stay tool-shaped and reviewable.",
		"Refarm stricter-than-Pi rule: host capability boundaries must gate source mutation.",
	],
} as const;

const REFERENCE_DRIVER_SOURCE_REFERENCES: Record<
	string,
	readonly ReferenceDriverSourceReference[]
> = {
	"runtime-agent.ask": [
		{
			name: "Hermes Agent README",
			url: "https://github.com/NousResearch/hermes-agent",
		},
		{
			name: "Pi coding-agent README",
			url:
				"https://github.com/earendil-works/pi/tree/main/packages/coding-agent",
		},
		{
			name: "Pi RPC mode",
			url:
				"https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md",
		},
	],
	"runtime-agent.worker-profiles": [
		{
			name: "Hermes Agent README",
			url: "https://github.com/NousResearch/hermes-agent",
		},
		{
			name: "Pi coding-agent README",
			url:
				"https://github.com/earendil-works/pi/tree/main/packages/coding-agent",
		},
	],
	"runtime-agent.session-tree": [
		{
			name: "Pi sessions and branching",
			url:
				"https://github.com/earendil-works/pi/tree/main/packages/coding-agent",
		},
		{
			name: "Pi RPC mode",
			url:
				"https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md",
		},
	],
	"runtime-agent.structured-io": [
		{
			name: "Pi RPC mode",
			url:
				"https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md",
		},
	],
	"runtime-agent.code-ops": [
		{
			name: "Pi permissions and containerization",
			url: "https://github.com/earendil-works/pi",
		},
	],
} as const;

const REFERENCE_DRIVER_PROMOTION_PROOF_TARGETS: Record<string, readonly string[]> = {
	"runtime-agent.ask": INTERACTION_DRIVER_GATEWAY_BLOCKERS.map(
		(blocker) => blocker.proofTarget,
	),
	"runtime-agent.worker-profiles": WORKER_TOOL_RUNTIME_DISPATCH_BLOCKERS.map(
		(blocker) => blocker.proofTarget,
	),
} as const;

export function buildRefarmCapabilityIndex(): RefarmCapabilityIndex {
	return {
		schemaVersion: REFARM_CAPABILITY_INDEX_SCHEMA_VERSION,
		capabilities: CAPABILITIES,
	};
}

export function getRefarmCapabilityDescriptors(): readonly RefarmCapabilityDescriptor[] {
	return CAPABILITIES;
}

export function buildReferenceDriverSupplyMap(): ReferenceDriverSupplyMap {
	const descriptors = CAPABILITIES as readonly RefarmCapabilityDescriptor[];
	return {
		schemaVersion: REFARM_CAPABILITY_INDEX_SCHEMA_VERSION,
		discoverySdk: "@refarm.dev/cli/capability-index",
		smokeCommand: "pnpm run reference-driver:smoke",
		entries: Object.entries(REFERENCE_DRIVER_SUPPLY_TARGETS).map(([id, supply]) => {
			const capability = descriptors.find((candidate) => candidate.id === id);
			if (!capability || !capability.tags.includes("reference-driver")) {
				throw new Error(`Reference-driver capability descriptor missing: ${id}`);
			}
			return {
				capabilityId: capability.id,
				provider: capability.provider,
				policyState: capability.policy.state,
				activation: capability.activation,
				referenceSources: REFERENCE_DRIVER_SOURCE_REFERENCES[id] ?? [],
				referenceLessons: REFERENCE_DRIVER_LESSONS[id] ?? [],
				promotionProofTargets:
					REFERENCE_DRIVER_PROMOTION_PROOF_TARGETS[id] ?? [],
				targets: supply.targets,
				nextDecision: supply.nextDecision,
			};
		}),
	};
}

export function buildReferenceDriverSupplyPreflight(): ReferenceDriverSupplyPreflight {
	const includedStatuses = ["candidate", "internal", "hold"] as const;
	const includedStatusSet = new Set<RefarmCapabilitySupplyStatus>(includedStatuses);
	const supplyMap = buildReferenceDriverSupplyMap();
	const targets = supplyMap.entries.flatMap((entry) =>
		entry.targets
			.filter((target) => includedStatusSet.has(target.status))
			.map((target) => ({
				capabilityId: entry.capabilityId,
				...target,
			})),
	);

	return {
		schemaVersion: REFARM_CAPABILITY_INDEX_SCHEMA_VERSION,
		source: "@refarm.dev/cli/capability-index",
		mode: "plan-only",
		targets,
		summary: includedStatuses.map((status) => ({
			status,
			count: targets.filter((target) => target.status === status).length,
		})),
		nextDecisions: supplyMap.entries.map((entry) => ({
			capabilityId: entry.capabilityId,
			nextDecision: entry.nextDecision,
		})),
	};
}
