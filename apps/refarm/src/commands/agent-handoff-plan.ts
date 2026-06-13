import { quoteCommandArg, refarmCommand, refarmProcess } from "./command-handoff.js";
import {
	LOCAL_MODEL_JSON_COMMAND,
	MODEL_CURRENT_JSON_COMMAND,
	MODEL_DOCTOR_JSON_COMMAND,
	MODEL_PROVIDERS_JSON_COMMAND,
	OPENAI_MODEL_JSON_COMMAND,
	OPENAI_MONITOR_MODEL_JSON_COMMAND,
	OPENAI_WORKER_MODEL_JSON_COMMAND,
	OPERATOR_LINKS_CONFIG_COMMAND,
	RESUME_JSON_COMMAND,
	SOW_INTERACTIVE_COMMAND,
	SOW_JSON_COMMAND
} from "./credential-handoffs.js";
import { buildJsonSuccessEnvelope } from "./json-output.js";
import {
	RUNTIME_DOCTOR_NEXT_COMMAND,
	RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
} from "./runtime-recovery.js";

export const AGENT_NEXT_ACTION_COMMAND = refarmCommand([
	"check",
	"--next-action",
	"--json",
]);
export const AGENT_NEXT_COMMAND = refarmCommand(["check", "--next-command"]);

export function agentFinishCommand(args: string[]): string {
	return refarmCommand(["agent", "finish", ...args]);
}

function agentFinishProcess(args: string[]) {
	return refarmProcess(["agent", "finish", ...args]);
}

export const agentFinishLaneCatalog = [
	{
		id: "after-edit",
		recommendedKey: "afterEdit",
		command: agentFinishCommand(["--lane", "after-edit", "--run", "--json"]),
		description: "Validate the current dirty tree after source edits.",
		useWhen: "After source edits, before an atomic commit.",
		validationScope: "dirtyTree",
	},
	{
		id: "after-commit",
		recommendedKey: "afterCommit",
		command: agentFinishCommand(["--lane", "after-commit", "--run", "--json"]),
		description: "Validate the most recent atomic commit.",
		useWhen: "After an atomic commit, before continuing the branch.",
		validationScope: "lastCommit",
	},
	{
		id: "before-push",
		recommendedKey: "beforePush",
		command: agentFinishCommand(["--lane", "before-push", "--run", "--json"]),
		description: "Run final branch-local validation before pushing.",
		useWhen: "Before pushing a branch with an upstream configured.",
		validationScope: "branchRange",
	},
	{
		id: "handoffs",
		recommendedKey: "handoffs",
		command: agentFinishCommand(["--lane", "handoffs", "--run", "--json"]),
		description: "Validate public JSON handoff contracts after CLI contract changes.",
		useWhen: "After changing public JSON output, nextCommands, or agent handoffs.",
		validationScope: "contract",
	},
	{
		id: "agent-e2e-mock",
		recommendedKey: "agentE2eMock",
		command: agentFinishCommand(["--lane", "agent-e2e-mock", "--run", "--json"]),
		description: "Run the no-token Refarm agent runtime e2e smoke.",
		useWhen: "After runtime, model routing, runtime agent, or ask execution-plane changes.",
		validationScope: "runtime",
	},
	{
		id: "with-package-tests",
		recommendedKey: "withPackageTests",
		command: agentFinishCommand([
			"--lane",
			"with-package-tests",
			"--run",
			"--json",
		]),
		description: "Validate dirty-tree edits and include package tests.",
		useWhen: "After source edits that need package test scripts in addition to type/lint/build.",
		validationScope: "dirtyTree",
	},
] as const;

export type AgentFinishLane = typeof agentFinishLaneCatalog[number]["id"];
type AgentFinishLaneRecommendedKey = typeof agentFinishLaneCatalog[number]["recommendedKey"];
export type AgentFinishLaneValidationScope = typeof agentFinishLaneCatalog[number]["validationScope"];

export const AGENT_FINISH_LANE_HELP = agentFinishLaneCatalog.map((lane) => lane.id).join(" | ");
const agentFinishLanes = agentFinishLaneCatalog.map((lane) => ({
	id: lane.id,
	command: lane.command,
	description: lane.description,
	useWhen: lane.useWhen,
	validationScope: lane.validationScope,
}));
const agentFinishRecommended = Object.fromEntries(
	agentFinishLaneCatalog.map((lane) => [lane.recommendedKey, lane.command]),
) as Record<AgentFinishLaneRecommendedKey, string>;

function agentFinishTemplates() {
	return [
		{
			id: "external-consumer-resume-json",
			command: refarmCommand(["resume", "--json"]),
			process: refarmProcess(["resume", "--json"]),
			effects: ["observe"],
			writes: false,
			parameters: ["dir"],
			cwdParameter: "dir",
			useWhen: "Refresh operator state from a non-Refarm consumer workspace before dispatching work.",
		},
		{
			id: "external-consumer-check-json",
			command: refarmCommand(["check", "--next-action", "--json"]),
			process: refarmProcess(["check", "--next-action", "--json"]),
			effects: ["observe"],
			writes: false,
			parameters: ["dir"],
			cwdParameter: "dir",
			useWhen: "Run the readiness gate from a non-Refarm consumer workspace.",
		},
		{
			id: "external-consumer-health-policy-json",
			command: refarmCommand(["health", "--policy", "--json"]),
			process: refarmProcess(["health", "--policy", "--json"]),
			effects: ["observe"],
			writes: false,
			parameters: ["dir"],
			cwdParameter: "dir",
			useWhen: "Inspect resolved health policy in a non-Refarm consumer workspace without running auditors or writing config.",
		},
		{
			id: "external-consumer-health-suggest-policy-json",
			command: refarmCommand(["health", "--suggest-policy", "--json"]),
			process: refarmProcess(["health", "--suggest-policy", "--json"]),
			effects: ["observe"],
			writes: false,
			parameters: ["dir"],
			cwdParameter: "dir",
			useWhen: "Generate a reviewed health policy candidate in a non-Refarm consumer workspace without writing .refarm/config.json.",
		},
		{
			id: "package-workspace-plan",
			command: agentFinishCommand([
				"--profile",
				"package",
				"--workspace",
				"<dir>",
				"--next-command",
			]),
			process: agentFinishProcess([
				"--profile",
				"package",
				"--workspace",
				"<dir>",
				"--next-command",
			]),
			parameters: ["dir"],
			useWhen: "Validate a known workspace/package directory without using Git status.",
		},
		{
			id: "package-workspace-run",
			command: agentFinishCommand([
				"--profile",
				"package",
				"--workspace",
				"<dir>",
				"--run",
				"--next-command",
			]),
			process: agentFinishProcess([
				"--profile",
				"package",
				"--workspace",
				"<dir>",
				"--run",
				"--next-command",
			]),
			parameters: ["dir"],
			useWhen: "Execute validation for a known workspace/package directory.",
		},
		{
			id: "package-workspace-fix-run",
			command: agentFinishCommand([
				"--fix",
				"--profile",
				"package",
				"--workspace",
				"<dir>",
				"--run",
				"--next-command",
			]),
			process: agentFinishProcess([
				"--fix",
				"--profile",
				"package",
				"--workspace",
				"<dir>",
				"--run",
				"--next-command",
			]),
			parameters: ["dir"],
			useWhen: "Organize imports, then execute validation for a known workspace/package directory.",
		},
		{
			id: "affected-since-ref-run-json",
			command: agentFinishCommand([
				"--profile",
				"affected",
				"--since",
				"<ref>",
				"--run",
				"--json",
			]),
			process: agentFinishProcess([
				"--profile",
				"affected",
				"--since",
				"<ref>",
				"--run",
				"--json",
			]),
			parameters: ["ref"],
			useWhen: "Validate affected workspaces against an explicit Git ref.",
		},
		{
			id: "affected-since-ref-run-command",
			command: agentFinishCommand([
				"--profile",
				"affected",
				"--since",
				"<ref>",
				"--run",
				"--next-command",
			]),
			process: agentFinishProcess([
				"--profile",
				"affected",
				"--since",
				"<ref>",
				"--run",
				"--next-command",
			]),
			parameters: ["ref"],
			useWhen: "Print the next recovery command while validating against an explicit Git ref.",
		},
	] as const;
}

export const agentRuntimePlan = {
	environment: {
		packageManager: refarmCommand(["package-manager", "--json"]),
		codingProfile: refarmCommand(["config", "profile", "coding", "--local", "--json"]),
	},
	runtime: {
		status: refarmCommand(["runtime", "status", "--json"]),
		ensure: RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
		start: refarmCommand(["runtime", "start", "--wait", "--json"]),
		doctor: refarmCommand(["doctor", "--next-action", "--json"]),
		doctorCommand: RUNTIME_DOCTOR_NEXT_COMMAND,
	},
	usage: {
		ask: `refarm ask "hello" --json`,
		session: refarmCommand(["sessions", "list", "--json"]),
		resume: RESUME_JSON_COMMAND,
		tidyCheck: refarmCommand(["tidy", "imports", "--check", "--json"]),
		tidyApply: refarmCommand(["tidy", "imports", "--json"]),
	},
	credentials: {
		configureInteractive: SOW_INTERACTIVE_COMMAND,
		configureJson: SOW_JSON_COMMAND,
		doctor: MODEL_DOCTOR_JSON_COMMAND,
		inspectCurrent: MODEL_CURRENT_JSON_COMMAND,
		inspectProviders: MODEL_PROVIDERS_JSON_COMMAND,
		openExternalLinks: OPERATOR_LINKS_CONFIG_COMMAND,
		localNoKeyModel: LOCAL_MODEL_JSON_COMMAND,
		setModel: OPENAI_MODEL_JSON_COMMAND,
		setWorkerModel: OPENAI_WORKER_MODEL_JSON_COMMAND,
		setMonitorModel: OPENAI_MONITOR_MODEL_JSON_COMMAND,
	},
	plugins: {
		list: refarmCommand(["plugin", "list", "--json"]),
		install: refarmCommand(["plugin", "install", "--json"]),
	},
	workers: {
		list: refarmCommand(["task", "list", "--json"]),
		resume: refarmCommand(["task", "resume", "--json"]),
		templates: [
			{
				id: "worker-task-run",
				command: refarmCommand([
					"task",
					"run",
					"<plugin>",
					"<fn>",
					"--args",
					quoteCommandArg("{}"),
					"--json",
				]),
				process: {
					...refarmProcess([
						"task",
						"run",
						"<plugin>",
						"<fn>",
						"--args",
						"{}",
						"--json",
					]),
					display: refarmCommand([
						"task",
						"run",
						"<plugin>",
						"<fn>",
						"--args",
						quoteCommandArg("{}"),
						"--json",
					]),
				},
				parameters: ["plugin", "fn"],
				useWhen: "Dispatch a concrete plugin function as an asynchronous worker effort.",
			},
			{
				id: "worker-task-status",
				command: refarmCommand([
					"task",
					"status",
					"<effort-id>",
					"--json",
				]),
				process: refarmProcess([
					"task",
					"status",
					"<effort-id>",
					"--json",
				]),
				parameters: ["effort-id"],
				useWhen: "Inspect a concrete worker effort after dispatch.",
			},
			{
				id: "worker-task-logs",
				command: refarmCommand([
					"task",
					"logs",
					"<effort-id>",
					"--json",
				]),
				process: refarmProcess([
					"task",
					"logs",
					"<effort-id>",
					"--json",
				]),
				parameters: ["effort-id"],
				useWhen: "Inspect logs for a concrete worker effort after dispatch.",
			},
		],
	},
	verification: {
		quick: AGENT_NEXT_ACTION_COMMAND,
		quickCommand: AGENT_NEXT_COMMAND,
		health: refarmCommand(["health", "--next-action", "--json"]),
		doctor: refarmCommand(["doctor", "--next-action", "--json"]),
		doctorCommand: RUNTIME_DOCTOR_NEXT_COMMAND,
		tidyCheck: refarmCommand(["tidy", "imports", "--check", "--json"]),
		finishTemplatesJsonCommand: agentFinishCommand(["--templates", "--json"]),
		finishLanesJsonCommand: agentFinishCommand(["--lanes", "--json"]),
		finishLanesNextJsonCommand: agentFinishCommand([
			"--lanes",
			"--json",
			"--next-command",
		]),
		finishPlanJsonCommand: agentFinishCommand(["--json"]),
		finishPlanNextJsonCommand: agentFinishCommand(["--json", "--next-command"]),
		finishPlanCommand: agentFinishCommand(["--next-command"]),
		finishRunCommand: agentFinishCommand(["--run", "--next-command"]),
		finishFixPlanCommand: agentFinishCommand(["--fix", "--next-command"]),
		finishFixRunCommand: agentFinishCommand(["--fix", "--run", "--next-command"]),
		finishAffectedPlanJsonCommand: agentFinishCommand([
			"--profile",
			"affected",
			"--json",
		]),
		finishAffectedRunJsonCommand: agentFinishCommand([
			"--profile",
			"affected",
			"--run",
			"--json",
		]),
		finishAffectedUpstreamRunJsonCommand: agentFinishCommand([
			"--profile",
			"affected",
			"--since",
			"upstream",
			"--run",
			"--json",
		]),
		finishAffectedTestRunJsonCommand: agentFinishCommand([
			"--profile",
			"affected",
			"--include-tests",
			"--run",
			"--json",
		]),
		finishAffectedRunCommand: agentFinishCommand([
			"--profile",
			"affected",
			"--run",
			"--next-command",
		]),
		finishAffectedUpstreamRunCommand: agentFinishCommand([
			"--profile",
			"affected",
			"--since",
			"upstream",
			"--run",
			"--next-command",
		]),
		finishAffectedTestRunCommand: agentFinishCommand([
			"--profile",
			"affected",
			"--include-tests",
			"--run",
			"--next-command",
		]),
		recommended: agentFinishRecommended,
		lanes: agentFinishLanes,
		get templates() {
			return agentFinishTemplates();
		},
	},
};

export function buildAgentNextHandoffEnvelope() {
	return buildJsonSuccessEnvelope({
		command: "agent",
		operation: "handoff",
		nextAction: AGENT_NEXT_ACTION_COMMAND,
		nextCommand: AGENT_NEXT_COMMAND,
		nextActions: [AGENT_NEXT_ACTION_COMMAND],
		nextCommands: [AGENT_NEXT_COMMAND],
		extra: { action: "agent", status: "handoff" },
	});
}

export function buildAgentFinishLanesEnvelope() {
	const lanes = agentRuntimePlan.verification.lanes;
	const commands = lanes.map((lane) => lane.command);
	return buildJsonSuccessEnvelope({
		command: "agent",
		operation: "finish-lanes",
		nextActions: commands,
		nextCommands: commands,
		extra: {
			action: "finish",
			status: "lanes",
			lanes,
			recommended: agentRuntimePlan.verification.recommended,
		},
	});
}
export function buildAgentFinishTemplatesEnvelope() {
	return buildJsonSuccessEnvelope({
		command: "agent",
		operation: "finish-templates",
		nextAction: "Substitute template parameters before executing a finish command.",
		nextActions: [
			"Substitute template parameters before executing a finish command.",
		],
		nextCommands: [],
		extra: {
			action: "finish",
			status: "templates",
			templates: agentRuntimePlan.verification.templates,
		},
	});
}
