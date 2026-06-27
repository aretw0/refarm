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
			state: "planned",
			enforcement: [
				"durable owner",
				"fail-closed model route",
				"health/resume visibility",
			],
			evidence: [
				"docs/DAILY_DRIVER_PARITY.md",
				"docs/REFERENCE_AGENT_DRIVER_RESEARCH.md",
			],
		},
		activation: {},
		tags: ["automation", "scheduler", "planning"],
	},
] as const satisfies readonly RefarmCapabilityDescriptor[];

export function buildRefarmCapabilityIndex(): RefarmCapabilityIndex {
	return {
		schemaVersion: REFARM_CAPABILITY_INDEX_SCHEMA_VERSION,
		capabilities: CAPABILITIES,
	};
}

export function getRefarmCapabilityDescriptors(): readonly RefarmCapabilityDescriptor[] {
	return CAPABILITIES;
}
