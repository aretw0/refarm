import { refarmCommand } from "./command-handoff.js";

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

export interface RefarmReferenceDriverSupplyEntry {
	capabilityId: string;
	provider: RefarmCapabilityProvider;
	policyState: RefarmCapabilityPolicyState;
	activation: RefarmCapabilityActivation;
	targets: readonly RefarmCapabilitySupplyTarget[];
	nextDecision: string;
}

export interface RefarmReferenceDriverSupplyMap {
	schemaVersion: typeof REFARM_CAPABILITY_INDEX_SCHEMA_VERSION;
	discoverySdk: "@refarm.dev/cli/capability-index";
	smokeCommand: "pnpm run reference-driver:smoke";
	entries: readonly RefarmReferenceDriverSupplyEntry[];
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
		tags: ["daily-driver", "runtime", "streaming"],
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
		title: "Runtime agent worker profiles",
		description:
			"Describe bounded delegated workers with context, tools, model route, concurrency, output schema, and resume policy.",
		provider: {
			kind: "runtime",
			package: "@refarm.dev/pi-agent",
			surface: "runtime-agent worker profile",
		},
		requirements: [
			"context packet",
			"allowed toolset",
			"model route",
			"max concurrency",
		],
		policy: {
			state: "governed",
			enforcement: [
				"explicit worker context",
				"bounded tool access",
				"cancellation/resume contract",
			],
			evidence: [
				"packages/cli/src/worker-profile.test.ts",
				"docs/REFERENCE_AGENT_DRIVER_RESEARCH.md",
			],
		},
		activation: {
			sdk: "@refarm.dev/cli/worker-profile",
		},
		tags: ["runtime", "workers", "planning"],
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
				name: "refarm tree",
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
				status: "candidate",
				note:
					"Canonical host contract for code-ops; guarded by pi-agent WIT sync and reference-driver smoke.",
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
			"Keep code-ops contract in WIT and Tractor host bridge; publish implementation crates only after runtime packaging policy is explicit.",
	},
} as const satisfies Record<
	string,
	{
		targets: readonly RefarmCapabilitySupplyTarget[];
		nextDecision: string;
	}
>;

export function buildRefarmCapabilityIndex(): RefarmCapabilityIndex {
	return {
		schemaVersion: REFARM_CAPABILITY_INDEX_SCHEMA_VERSION,
		capabilities: CAPABILITIES,
	};
}

export function getRefarmCapabilityDescriptors(): readonly RefarmCapabilityDescriptor[] {
	return CAPABILITIES;
}

export function buildRefarmReferenceDriverSupplyMap(): RefarmReferenceDriverSupplyMap {
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
				targets: supply.targets,
				nextDecision: supply.nextDecision,
			};
		}),
	};
}
