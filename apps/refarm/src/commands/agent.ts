import {
	affectedWorkspacePackagesFromChangedPaths,
	affectedWorkspacePackagesFromGitStatus,
	changedFilePathsFromGitNameOnly,
	changedFilePathsFromGitStatus,
	findWorkspaceRoot as findWorkspaceRootFromMarkers,
} from "@refarm.dev/config";
import { Command } from "commander";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
	buildAgentFinishRecord,
	createAgentFinishSessionRecorder,
	type AgentFinishSessionRecorder,
} from "./agent-finish-session.js";
import { refarmCommand } from "./command-handoff.js";
import {
	buildCommandPlanEnvelope,
	buildCommandPlanRunEnvelope,
	commandPlanStepCommands,
	runCommandPlan,
	type CommandPlanRunResult,
	type CommandPlanStep,
	type CommandPlanStepRunResult,
} from "./command-plan.js";
import { parseCommandJsonPayload } from "./command-result.js";
import {
	LOCAL_MODEL_JSON_COMMAND,
	MODEL_CURRENT_JSON_COMMAND,
	MODEL_PROVIDERS_JSON_COMMAND,
	OPENAI_DEFAULT_REF,
	OPENAI_MODEL_JSON_COMMAND,
	OPENAI_MONITOR_MODEL_JSON_COMMAND,
	OPENAI_WORKER_MODEL_JSON_COMMAND,
	OPERATOR_LINKS_CONFIG_COMMAND,
	SOW_INTERACTIVE_COMMAND,
	SOW_JSON_COMMAND,
} from "./credential-handoffs.js";
import { buildJsonErrorEnvelope, buildJsonSuccessEnvelope, printJson } from "./json-output.js";
import { createPackageScriptCommand } from "./package-manager.js";
import {
	RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
	RUNTIME_DOCTOR_NEXT_COMMAND,
	RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
	RUNTIME_START_WAIT_COMMAND,
	RUNTIME_STATUS_COMMAND,
} from "./runtime-recovery.js";

const AGENT_NEXT_ACTION_COMMAND = "refarm check --next-action --json";
const AGENT_NEXT_COMMAND = "refarm check --next-command";

const agentFinishLaneCatalog = [
	{
		id: "after-edit",
		recommendedKey: "afterEdit",
		command: "refarm agent finish --lane after-edit --run --json",
		description: "Validate the current dirty tree after source edits.",
		useWhen: "After source edits, before an atomic commit.",
		validationScope: "dirtyTree",
	},
	{
		id: "after-commit",
		recommendedKey: "afterCommit",
		command: "refarm agent finish --lane after-commit --run --json",
		description: "Validate the most recent atomic commit.",
		useWhen: "After an atomic commit, before continuing the branch.",
		validationScope: "lastCommit",
	},
	{
		id: "before-push",
		recommendedKey: "beforePush",
		command: "refarm agent finish --lane before-push --run --json",
		description: "Run final branch-local validation before pushing.",
		useWhen: "Before pushing a branch with an upstream configured.",
		validationScope: "branchRange",
	},
	{
		id: "handoffs",
		recommendedKey: "handoffs",
		command: "refarm agent finish --lane handoffs --run --json",
		description: "Validate public JSON handoff contracts after CLI contract changes.",
		useWhen: "After changing public JSON output, nextCommands, or agent handoffs.",
		validationScope: "contract",
	},
	{
		id: "with-package-tests",
		recommendedKey: "withPackageTests",
		command: "refarm agent finish --lane with-package-tests --run --json",
		description: "Validate dirty-tree edits and include package tests.",
		useWhen: "After source edits that need package test scripts in addition to type/lint/build.",
		validationScope: "dirtyTree",
	},
] as const;

type AgentFinishLane = typeof agentFinishLaneCatalog[number]["id"];
type AgentFinishLaneRecommendedKey = typeof agentFinishLaneCatalog[number]["recommendedKey"];
type AgentFinishLaneValidationScope = typeof agentFinishLaneCatalog[number]["validationScope"];

const AGENT_FINISH_LANE_HELP = agentFinishLaneCatalog.map((lane) => lane.id).join(" | ");
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

const agentFinishTemplates = [
	{
		id: "package-workspace-plan",
		command: "refarm agent finish --profile package --workspace <dir> --next-command",
		parameters: ["dir"],
		useWhen: "Validate a known workspace/package directory without using Git status.",
	},
	{
		id: "package-workspace-run",
		command: "refarm agent finish --profile package --workspace <dir> --run --next-command",
		parameters: ["dir"],
		useWhen: "Execute validation for a known workspace/package directory.",
	},
	{
		id: "package-workspace-fix-run",
		command: "refarm agent finish --fix --profile package --workspace <dir> --run --next-command",
		parameters: ["dir"],
		useWhen: "Organize imports, then execute validation for a known workspace/package directory.",
	},
	{
		id: "affected-since-ref-run-json",
		command: "refarm agent finish --profile affected --since <ref> --run --json",
		parameters: ["ref"],
		useWhen: "Validate affected workspaces against an explicit Git ref.",
	},
	{
		id: "affected-since-ref-run-command",
		command: "refarm agent finish --profile affected --since <ref> --run --next-command",
		parameters: ["ref"],
		useWhen: "Print the next recovery command while validating against an explicit Git ref.",
	},
] as const;

const agentRuntimePlan = {
	environment: {
		packageManager: "refarm package-manager --json",
		codingProfile: "refarm config profile coding --local --json",
	},
	runtime: {
		status: `${RUNTIME_STATUS_COMMAND} --json`,
		ensure: RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
		start: `${RUNTIME_START_WAIT_COMMAND} --json`,
		doctor: `${RUNTIME_DOCTOR_NEXT_ACTION_COMMAND} --json`,
		doctorCommand: RUNTIME_DOCTOR_NEXT_COMMAND,
	},
	usage: {
		ask: `refarm ask "hello" --json`,
		session: "refarm",
		resume: "refarm resume --json",
		tidyCheck: "refarm tidy imports --check --json",
		tidyApply: "refarm tidy imports --json",
	},
	credentials: {
		configureInteractive: SOW_INTERACTIVE_COMMAND,
		configureJson: SOW_JSON_COMMAND,
		inspectCurrent: MODEL_CURRENT_JSON_COMMAND,
		inspectProviders: MODEL_PROVIDERS_JSON_COMMAND,
		openExternalLinks: OPERATOR_LINKS_CONFIG_COMMAND,
		localNoKeyModel: LOCAL_MODEL_JSON_COMMAND,
		setModel: OPENAI_MODEL_JSON_COMMAND,
		setWorkerModel: OPENAI_WORKER_MODEL_JSON_COMMAND,
		setMonitorModel: OPENAI_MONITOR_MODEL_JSON_COMMAND,
	},
	plugins: {
		list: "refarm plugin list --json",
		install: "refarm plugin install --json",
	},
	workers: {
		list: "refarm task list --json",
		resume: "refarm task resume --json",
		templates: [
			{
				id: "worker-task-run",
				command: "refarm task run <plugin> <fn> --args '{}' --json",
				parameters: ["plugin", "fn"],
				useWhen: "Dispatch a concrete plugin function as an asynchronous worker effort.",
			},
			{
				id: "worker-task-status",
				command: "refarm task status <effort-id> --json",
				parameters: ["effort-id"],
				useWhen: "Inspect a concrete worker effort after dispatch.",
			},
			{
				id: "worker-task-logs",
				command: "refarm task logs <effort-id> --json",
				parameters: ["effort-id"],
				useWhen: "Inspect logs for a concrete worker effort after dispatch.",
			},
		],
	},
	verification: {
		quick: AGENT_NEXT_ACTION_COMMAND,
		quickCommand: AGENT_NEXT_COMMAND,
		health: "refarm health --next-action --json",
		doctor: "refarm doctor --next-action --json",
		doctorCommand: "refarm doctor --next-command",
		tidyCheck: "refarm tidy imports --check --json",
		finishTemplatesJsonCommand: "refarm agent finish --templates --json",
		finishLanesJsonCommand: "refarm agent finish --lanes --json",
		finishLanesNextJsonCommand: "refarm agent finish --lanes --json --next-command",
		finishPlanJsonCommand: "refarm agent finish --json",
		finishPlanNextJsonCommand: "refarm agent finish --json --next-command",
		finishPlanCommand: "refarm agent finish --next-command",
		finishRunCommand: "refarm agent finish --run --next-command",
		finishFixPlanCommand: "refarm agent finish --fix --next-command",
		finishFixRunCommand: "refarm agent finish --fix --run --next-command",
		finishAffectedPlanJsonCommand: "refarm agent finish --profile affected --json",
		finishAffectedRunJsonCommand: "refarm agent finish --profile affected --run --json",
		finishAffectedUpstreamRunJsonCommand: "refarm agent finish --profile affected --since upstream --run --json",
		finishAffectedTestRunJsonCommand: "refarm agent finish --profile affected --include-tests --run --json",
		finishAffectedRunCommand: "refarm agent finish --profile affected --run --next-command",
		finishAffectedUpstreamRunCommand: "refarm agent finish --profile affected --since upstream --run --next-command",
		finishAffectedTestRunCommand: "refarm agent finish --profile affected --include-tests --run --next-command",
		recommended: agentFinishRecommended,
		lanes: agentFinishLanes,
		templates: agentFinishTemplates,
	},
};

function buildAgentNextHandoffEnvelope() {
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

function buildAgentFinishLanesEnvelope() {
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

function buildAgentFinishTemplatesEnvelope() {
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

interface AgentCommandDeps {
	runRefarm(args: string[]): CommandPlanStepRunResult;
	runProcess(step: CommandPlanStep): CommandPlanStepRunResult;
	finishRecorder: AgentFinishSessionRecorder;
}

type AgentFinishProfile = "quick" | "package" | "affected";
interface AgentFinishOptions {
	fix?: boolean;
	includeTests?: boolean;
	json?: boolean;
	lane?: string;
	lanes?: boolean;
	nextAction?: boolean;
	nextCommand?: boolean;
	profile?: string;
	run?: boolean;
	since?: string;
	templates?: boolean;
	workspace?: string;
}

interface AgentFinishSelection {
	fix?: boolean;
	includeTests?: boolean;
	lane?: AgentFinishLane;
	profile: AgentFinishProfile;
	since?: string;
	sinceRef?: string;
	workspace?: string;
}

interface AgentFinishSelectionMetadata {
	profile: AgentFinishProfile;
	fix: boolean;
	includeTests: boolean;
	lane: AgentFinishLane | null;
	since: string | null;
	sinceRef: string | null;
	validationScope: AgentFinishLaneValidationScope | "package" | "quick";
	workspace: string | null;
	affectedWorkspaces?: string[];
}

interface AgentFinishSelectionContext {
	affectedWorkspaces?: string[];
	sinceRef?: string;
}

function runRefarmCommand(args: string[]): CommandPlanStepRunResult {
	const result = spawnSync(process.argv[0]!, [process.argv[1]!, ...args], {
		cwd: process.cwd(),
		env: process.env,
		encoding: "utf-8",
	});
	const exitCode = result.status ?? (result.error ? 1 : 0);
	const stdout = result.stdout ?? "";
	const stderr = result.stderr ?? "";
	const payload = parseCommandJsonPayload(stdout);
	return {
		id: args.join(" "),
		command: refarmCommand(args),
		args,
		description: "Refarm command execution result.",
		ok: exitCode === 0,
		exitCode,
		stdout,
		stderr,
		...(payload !== undefined ? { payload } : {}),
	};
}

function runProcessCommand(step: CommandPlanStep): CommandPlanStepRunResult {
	if (!step.process) return runRefarmCommand(step.args);
	const result = spawnSync(step.process.command, step.process.args, {
		cwd: step.process.cwd ?? process.cwd(),
		env: process.env,
		encoding: "utf-8",
	});
	const exitCode = result.status ?? (result.error ? 1 : 0);
	return {
		...step,
		ok: exitCode === 0,
		exitCode,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

function finishStep(
	id: string,
	args: string[],
	description: string,
	effect: CommandPlanStep["effect"] = "verify",
): CommandPlanStep {
	return {
		id,
		command: refarmCommand(args),
		args,
		description,
		effect,
	};
}

function packageScriptStep(
	workspace: string,
	script: string,
	description: string,
	idPrefix = "package",
): CommandPlanStep {
	const repoRoot = findWorkspaceRoot();
	const cwd = path.resolve(repoRoot, workspace);
	const command = createPackageScriptCommand({
		cwd,
		repoRoot,
		script,
	});
	return {
		id: `${idPrefix}-${sanitizeStepId(script)}`,
		command: command.display,
		args: [command.command, ...command.args],
		description,
		effect: "verify",
		process: {
			command: command.command,
			args: command.args,
			cwd: repoRoot,
			display: command.display,
			packageManager: command.packageManager,
		},
	};
}

function findWorkspaceRoot(cwd = process.cwd()): string {
	try {
		const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
			cwd,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		if (root) return root;
	} catch {
		// Fall back to marker walking outside Git repositories.
	}
	return findWorkspaceRootFromMarkers(cwd);
}

const agentFinishSteps = [
	finishStep(
		"tidy-imports",
		["tidy", "imports", "--json"],
		"Organize imports after the editing slice.",
		"write",
	),
	finishStep(
		"tidy-imports-check",
		["tidy", "imports", "--check", "--json"],
		"Check import organization after the editing slice.",
	),
	finishStep(
		"health",
		["health", "--next-action", "--json"],
		"Audit filesystem, build alignment, and resolution health.",
		"observe",
	),
	finishStep(
		"check",
		["check", "--next-action", "--json"],
		"Run the composite readiness gate and surface recovery actions.",
	),
];

function packageScripts(workspace: string): Record<string, string> {
	const packageJsonPath = path.resolve(findWorkspaceRoot(), workspace, "package.json");
	if (!fs.existsSync(packageJsonPath)) return {};
	try {
		const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as {
			scripts?: unknown;
		};
		return parsed.scripts && typeof parsed.scripts === "object" && !Array.isArray(parsed.scripts)
			? parsed.scripts as Record<string, string>
			: {};
	} catch {
		return {};
	}
}

function packageFinishSteps(workspace: string, includeTests = false): CommandPlanStep[] {
	return packageFinishStepsForWorkspace(workspace, "package", includeTests);
}

function handoffContractStep(): CommandPlanStep {
	return packageScriptStep(
		"apps/refarm",
		"test:handoffs",
		"Run the public JSON handoff contract test.",
		"handoffs",
	);
}

function packageFinishStepsForWorkspace(
	workspace: string,
	idPrefix: string,
	includeTests = false,
): CommandPlanStep[] {
	const scripts = packageScripts(workspace);
	const candidates = [
		["type-check", "Run the package TypeScript/type validation."],
		["lint", "Run the package lint validation."],
		...(includeTests ? [["test", "Run the package test suite."]] as const : []),
		["build", "Build the package after source changes."],
	] as const;
	return candidates
		.filter(([script]) => typeof scripts[script] === "string")
		.map(([script, description]) => packageScriptStep(
			workspace,
			script,
			description,
			idPrefix,
		));
}

function affectedPackageFinishSteps(
	includeTests = false,
	workspaces = affectedWorkspacesFromGit(),
): CommandPlanStep[] {
	return workspaces.flatMap((workspace) =>
		packageFinishStepsForWorkspace(
			workspace,
			`package-${sanitizeStepId(workspace)}`,
			includeTests,
		),
	);
}

function affectedWorkspacesFromGit(options: { repoRoot?: string; since?: string } = {}): string[] {
	const repoRoot = options.repoRoot ?? findWorkspaceRoot();
	try {
		const status = execFileSync(
			"git",
			["status", "--short", "--untracked-files=all"],
			{ cwd: repoRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
		);
		if (!options.since) {
			return affectedWorkspacePackagesFromGitStatus(repoRoot, status);
		}
		const diff = execFileSync(
			"git",
			["diff", "--name-only", options.since, "--"],
			{ cwd: repoRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
		);
		return affectedWorkspacePackagesFromChangedPaths(repoRoot, [
			...changedFilePathsFromGitNameOnly(diff),
			...changedFilePathsFromGitStatus(status),
		]);
	} catch {
		if (options.since) {
			throw new Error(`Could not inspect changed workspaces since ${options.since}. Check that the ref exists.`);
		}
		return [];
	}
}

function resolveSinceRef(repoRoot: string, since: string): string {
	if (since !== "upstream") return since;
	let upstream = "";
	try {
		upstream = execFileSync(
			"git",
			["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
			{ cwd: repoRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
		).trim();
	} catch {
		throw new Error("Could not resolve upstream for the current branch. Configure a branch upstream or pass an explicit ref with --since <ref>.");
	}
	if (!upstream) {
		throw new Error("Could not resolve upstream for the current branch. Configure a branch upstream or pass an explicit ref with --since <ref>.");
	}
	return upstream;
}

function sanitizeStepId(value: string): string {
	return value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "root";
}

function parseFinishProfile(value: string | undefined): AgentFinishProfile {
	if (!value || value === "quick") return "quick";
	if (value === "package") return "package";
	if (value === "affected") return "affected";
	throw new Error(`Unknown finish profile: ${value}. Use: quick | package | affected`);
}

function parseFinishLane(value: string | undefined): AgentFinishLane | undefined {
	if (!value) return undefined;
	if (agentFinishLaneCatalog.some((lane) => lane.id === value)) return value as AgentFinishLane;
	throw new Error("Unknown finish lane: " + value + ". Use: " + AGENT_FINISH_LANE_HELP);
}

function finishSelectionFromLane(lane: AgentFinishLane): Omit<AgentFinishSelection, "fix"> {
	if (lane === "after-commit") {
		return { lane, profile: "affected", since: "HEAD~1" };
	}
	if (lane === "before-push") {
		return { lane, profile: "affected", since: "upstream" };
	}
	if (lane === "with-package-tests") {
		return { lane, includeTests: true, profile: "affected" };
	}
	if (lane === "handoffs") {
		return { lane, profile: "quick" };
	}
	return { lane, profile: "affected" };
}

function laneConflictMessage(lane: AgentFinishLane | undefined, options: AgentFinishOptions): string | null {
	if (!lane) return null;
	if (options.profile && options.profile !== "quick") {
		return "--lane cannot be combined with --profile. Use one selection style.";
	}
	if (options.since) {
		return "--lane cannot be combined with --since. Use an explicit --profile affected command for custom refs.";
	}
	if (options.includeTests) {
		return "--lane cannot be combined with --include-tests. Use --lane with-package-tests or explicit profile flags.";
	}
	return null;
}

function lanesConflictMessage(options: AgentFinishOptions): string | null {
	if (options.run === true) return "--lanes cannot be combined with --run.";
	if (typeof options.lane === "string" && options.lane.length > 0) {
		return "--lanes cannot be combined with --lane. Choose a lane after listing them.";
	}
	if (typeof options.profile === "string" && options.profile !== "quick") {
		return "--lanes cannot be combined with --profile. It lists all recommended lanes.";
	}
	if (typeof options.since === "string" && options.since.length > 0) {
		return "--lanes cannot be combined with --since. It does not select changed workspaces.";
	}
	if (options.includeTests === true) {
		return "--lanes cannot be combined with --include-tests. Inspect the with-package-tests lane instead.";
	}
	if (typeof options.workspace === "string" && options.workspace.length > 0 && options.workspace !== ".") {
		return "--lanes cannot be combined with --workspace. It is not workspace-specific.";
	}
	if (options.fix === true) return "--lanes cannot be combined with --fix. It only lists recommended commands.";
	return null;
}

function templatesConflictMessage(options: AgentFinishOptions): string | null {
	if (options.nextCommand === true) {
		return "--templates does not provide an executable next command. Use --templates --json or --templates --next-action.";
	}
	if (options.run === true) return "--templates cannot be combined with --run.";
	if (typeof options.lane === "string" && options.lane.length > 0) {
		return "--templates cannot be combined with --lane. Choose a concrete command after substituting parameters.";
	}
	if (options.lanes === true) return "--templates cannot be combined with --lanes. Choose one catalog.";
	if (typeof options.profile === "string" && options.profile !== "quick") {
		return "--templates cannot be combined with --profile. It is not profile-specific.";
	}
	if (typeof options.since === "string" && options.since.length > 0) {
		return "--templates cannot be combined with --since. Templates only describe required parameters.";
	}
	if (options.includeTests === true) {
		return "--templates cannot be combined with --include-tests. It only lists command templates.";
	}
	if (typeof options.workspace === "string" && options.workspace.length > 0 && options.workspace !== ".") {
		return "--templates cannot be combined with --workspace. Templates require placeholder substitution.";
	}
	if (options.fix === true) return "--templates cannot be combined with --fix. It only lists command templates.";
	return null;
}

function selectedFinishSteps(options: {
	fix?: boolean;
	includeTests?: boolean;
	lane?: AgentFinishLane;
	profile?: AgentFinishProfile;
	workspace?: string;
	affectedWorkspaces?: string[];
} = {}): CommandPlanStep[] {
	const steps = options.fix
		? agentFinishSteps
		: agentFinishSteps.filter((step) => step.id !== "tidy-imports");
	if (options.lane === "handoffs") {
		return [...steps, handoffContractStep()];
	}
	if (options.profile === "package") {
		return [...steps, ...packageFinishSteps(options.workspace ?? ".", options.includeTests)];
	}
	if (options.profile === "affected") {
		return [...steps, ...affectedPackageFinishSteps(
			options.includeTests,
			options.affectedWorkspaces,
		)];
	}
	return steps;
}

function plannedFinishCommands(options: {
	fix?: boolean;
	includeTests?: boolean;
	lane?: AgentFinishLane;
	profile?: AgentFinishProfile;
	workspace?: string;
} = {}): string[] {
	return commandPlanStepCommands(selectedFinishSteps(options));
}

function runAgentFinishPlan(
	deps: AgentCommandDeps,
	options: {
		fix?: boolean;
		includeTests?: boolean;
		lane?: AgentFinishLane;
		profile?: AgentFinishProfile;
		workspace?: string;
		affectedWorkspaces?: string[];
	} = {},
): CommandPlanRunResult {
	return runCommandPlan(selectedFinishSteps(options), (step) =>
		step.process ? deps.runProcess(step) : deps.runRefarm(step.args),
	);
}

function buildAgentFinishPlanEnvelope(
	selection: AgentFinishSelection & { affectedWorkspaces?: string[] },
	affectedWorkspaces?: string[],
) {
	return {
		...buildCommandPlanEnvelope({
			action: "finish",
			command: "agent",
			operation: "finish",
		}, selectedFinishSteps(selection)),
		selection: finishSelectionMetadata(selection, affectedWorkspaces),
	};
}

function finishSelectionMetadata(
	selection: AgentFinishSelection,
	affectedWorkspaces?: string[],
): AgentFinishSelectionMetadata {
	return {
		profile: selection.profile,
		fix: Boolean(selection.fix),
		includeTests: Boolean(selection.includeTests),
		lane: selection.lane ?? null,
		since: selection.profile === "affected" ? selection.since ?? null : null,
		sinceRef: selection.profile === "affected" ? selection.sinceRef ?? selection.since ?? null : null,
		validationScope: finishValidationScope(selection),
		workspace: selection.profile === "package" ? selection.workspace ?? "." : null,
		...(selection.profile === "affected"
			? { affectedWorkspaces: affectedWorkspaces ?? [] }
			: {}),
	};
}

function finishValidationScope(
	selection: AgentFinishSelection,
): AgentFinishSelectionMetadata["validationScope"] {
	if (selection.lane === "after-commit") return "lastCommit";
	if (selection.profile === "affected") {
		return selection.since ? "branchRange" : "dirtyTree";
	}
	if (selection.lane === "handoffs") return "contract";
	return selection.profile;
}

function finishRunResumeCommand(selection: AgentFinishSelectionMetadata): string {
	const args = ["agent", "finish"];
	if (selection.lane) {
		args.push("--lane", selection.lane);
	} else if (selection.profile !== "quick") {
		args.push("--profile", selection.profile);
	}
	if (selection.profile === "package" && selection.workspace) {
		args.push("--workspace", selection.workspace);
	}
	if (selection.profile === "affected" && selection.sinceRef) {
		args.push("--since", selection.sinceRef);
	}
	if (selection.includeTests) args.push("--include-tests");
	if (selection.fix) args.push("--fix");
	args.push("--run", "--json");
	return refarmCommand(args);
}

function resolveFinishSelectionContext(
	selection: AgentFinishSelection,
): AgentFinishSelectionContext {
	if (selection.profile !== "affected") return {};
	const repoRoot = findWorkspaceRoot();
	const sinceRef = selection.since ? resolveSinceRef(repoRoot, selection.since) : undefined;
	return {
		affectedWorkspaces: affectedWorkspacesFromGit({ repoRoot, since: sinceRef }),
		...(sinceRef ? { sinceRef } : {}),
	};
}

function printAgentFinishRunHuman(
	result: CommandPlanRunResult,
	selection?: AgentFinishSelectionMetadata,
): void {
	console.log("Refarm agent finish");
	if (selection) console.log(`Selection: ${formatFinishSelection(selection)}`);
	for (const step of result.steps) {
		console.log(`${step.ok ? "PASS" : "FAIL"} ${step.id}: ${step.command}`);
	}
	if (result.ok) {
		console.log("Finish checks passed.");
		return;
	}
	const nextAction = result.nextActions[0];
	const nextCommand = result.nextCommands[0];
	if (nextAction) console.log(`Next action: ${nextAction}`);
	if (nextCommand) console.log(`Next command: ${nextCommand}`);
	if (result.remainingCommands.length > 0) {
		console.log("Remaining commands:");
		for (const command of result.remainingCommands) {
			console.log(`  ${command}`);
		}
	}
}

function formatFinishSelection(selection: AgentFinishSelectionMetadata): string {
	if (selection.profile === "affected") {
		const workspaces = selection.affectedWorkspaces ?? [];
		const since = formatSinceSelection(selection);
		return workspaces.length > 0
			? `affected${since} (${workspaces.join(", ")})`
			: `affected${since} (no changed workspaces)`;
	}
	if (selection.profile === "package") {
		return `package (${selection.workspace ?? "."})`;
	}
	return selection.profile;
}

function formatSinceSelection(selection: AgentFinishSelectionMetadata): string {
	if (!selection.since) return "";
	if (selection.sinceRef && selection.sinceRef !== selection.since) {
		return ` since ${selection.since} (${selection.sinceRef})`;
	}
	return ` since ${selection.since}`;
}

function resolveFinishOptions(self: Command, actionArg: unknown): AgentFinishOptions {
	const command = actionArg && typeof actionArg === "object" && "opts" in actionArg
		? actionArg as Command
		: self;
	return {
		...command.parent?.opts<AgentFinishOptions>(),
		...command.opts<AgentFinishOptions>(),
	};
}

function reportAgentFinishOptionError(
	message: string,
	options: AgentFinishOptions,
	error = "invalid-agent-finish-options",
): void {
	const fallbackCommand = error === "invalid-agent-finish-since-ref"
		? options.run
			? "refarm agent finish --profile affected --run --json"
			: "refarm agent finish --profile affected --json"
		: "refarm agent finish --help";
	const nextActions = error === "invalid-agent-finish-since-ref"
		? [
			"Run the dirty-tree affected fallback while choosing an explicit Git ref or configuring upstream.",
			"Pass an explicit Git ref with `refarm agent finish --profile affected --since <ref> --json`.",
			"Configure the current branch upstream, then retry `refarm agent finish --profile affected --since upstream --json`.",
		]
		: ["Run `refarm agent finish --help` and choose a valid finish lane or profile."];
	if (options.json) {
		printJson(buildJsonErrorEnvelope({
			command: "agent",
			operation: "finish",
			error,
			message,
			nextAction: nextActions[0]!,
			nextActions,
			nextCommand: fallbackCommand,
			nextCommands: error === "invalid-agent-finish-since-ref"
				? [fallbackCommand, "refarm agent finish --help"]
				: [fallbackCommand],
		}));
	} else {
		console.error(message);
	}
	process.exitCode = 1;
}

export function createAgentCommand(deps?: Partial<AgentCommandDeps>): Command {
	const resolvedDeps: AgentCommandDeps = {
		runRefarm: runRefarmCommand,
		runProcess: runProcessCommand,
		finishRecorder: createAgentFinishSessionRecorder(),
		...deps,
	};
	// Agent runtime commands (status, repl, start/stop) live here.
	// Plugin lifecycle (install, update, list) is in `refarm plugin`.
	const command = new Command("agent").description(
		"Manage the refarm AI agent",
	)
		.option("--json", "Output machine-readable agent handoff plan")
		.option("--next-action", "Print the first agent handoff action")
		.option("--next-command", "Print the first executable agent handoff command")
		.addHelpText(
		"after",
		`

Runtime commands:
  $ refarm runtime status       Inspect selected runtime engine and readiness
  $ refarm runtime ensure --wait --next-command Ensure runtime readiness and print recovery
  $ refarm status               Check runtime, plugins, streams, and trust state
  $ refarm doctor --next-action Print the next blocking recovery action
  $ refarm doctor --next-command Print the next executable recovery command
  $ refarm doctor               Diagnose readiness and repair hints

Agent usage:
  $ refarm ask "hello"          Send one prompt through the configured runtime
  $ refarm                     Start or resume an interactive session
  $ refarm resume              Show runtime and worker resume hints
  $ refarm tidy imports --check Check import organization before committing
  $ refarm tidy imports         Organize imports after an editing slice
  $ refarm sow                  Configure credentials without editing files
  $ refarm sow --json           Print credential handoffs for non-interactive agents
  $ refarm model current        Inspect provider/model routing
  $ refarm model providers      Inspect provider credential requirements
  $ refarm model ${OPENAI_DEFAULT_REF} Switch the default route
  $ refarm model base-url ...   Set a self-hosted/OpenAI-compatible endpoint
  $ refarm model fallback ...   Set a retry route for provider failures

Worker efforts:
  $ refarm task list --json     Inspect queued and recent async efforts
  $ refarm task resume          Resume from the local task checkpoint
  $ refarm task run <plugin> <fn> --args '{}' --json Dispatch a worker effort
  $ refarm task status <effort-id> --json Inspect a worker effort
  $ refarm task logs <effort-id> --json Inspect effort logs and model route

Verification:
  $ refarm check --next-action --json Composite health + doctor gate
  $ refarm check --next-command      Print the next executable recovery command
  $ refarm tidy imports --check --json Check import organization
  $ refarm agent finish --json      Print an end-of-slice verification plan
  $ refarm agent finish --templates --json List parameterized finish templates
  $ refarm agent finish --lanes --json List recommended finish lanes
  $ refarm agent finish --lanes --json --next-command Print first lane as JSON
  $ refarm agent finish --lane after-edit --run --json Verify dirty-tree edits
  $ refarm agent finish --lane before-push --run --json Verify branch changes
  $ refarm agent finish --lane handoffs --run --json Verify JSON handoff contracts
  $ refarm agent finish --next-command Print the first verification command
  $ refarm agent finish --json --next-command Print first verification as JSON
  $ refarm agent finish --fix --run Organize imports, then verify
  $ refarm agent finish --profile package --workspace apps/refarm --run
  $ refarm agent finish --profile affected --run
  $ refarm agent finish --profile affected --since upstream --run
  $ refarm agent finish --profile affected --include-tests --run
  $ refarm agent finish --run       Execute end-of-slice checks and stop on failure

Plugin lifecycle:
  $ refarm plugin list          Show bundled plugin install state
  $ refarm plugin install       Install bundled plugins such as @refarm/pi-agent

Automation:
  $ refarm agent --json         Print runtime/model/plugin handoff commands
  $ refarm agent --next-command Print the first executable handoff command
  $ refarm agent --json --next-command Print the first handoff command as JSON
  $ refarm agent finish --json  Print ordered verification commands before commit
  $ refarm agent finish --run --json Execute ordered verification commands
  $ refarm agent finish --run --next-command Print the failing recovery command

Notes:
  This command is kept as the stable namespace for future agent runtime controls.
  Today, use runtime/status/doctor for the host, sow/model for credentials and
  routing, plugin for installation, and task for worker efforts.
`,
	).action(function (this: Command) {
		const options = this.opts<{ json?: boolean; nextAction?: boolean; nextCommand?: boolean }>();
		if (options.nextCommand && options.json) {
			printJson(buildAgentNextHandoffEnvelope());
			return;
		}
		if (options.nextCommand) {
			console.log(AGENT_NEXT_COMMAND);
			return;
		}
		if (options.nextAction && options.json) {
			printJson(buildAgentNextHandoffEnvelope());
			return;
		}
		if (options.nextAction) {
			console.log(AGENT_NEXT_ACTION_COMMAND);
			return;
		}
		if (options.json) {
			printJson(
				buildJsonSuccessEnvelope({
					command: "agent",
					operation: "handoff",
					nextAction: AGENT_NEXT_ACTION_COMMAND,
					nextCommand: AGENT_NEXT_COMMAND,
					nextActions: [
						AGENT_NEXT_ACTION_COMMAND,
						agentRuntimePlan.runtime.status,
						agentRuntimePlan.runtime.ensure,
						agentRuntimePlan.usage.resume,
						MODEL_CURRENT_JSON_COMMAND,
						agentRuntimePlan.environment.packageManager,
						agentRuntimePlan.environment.codingProfile,
						MODEL_PROVIDERS_JSON_COMMAND,
						"refarm plugin list --json",
						agentRuntimePlan.workers.list,
						agentRuntimePlan.workers.resume,
						agentRuntimePlan.verification.finishTemplatesJsonCommand,
						agentRuntimePlan.verification.finishLanesJsonCommand,
						agentRuntimePlan.verification.finishLanesNextJsonCommand,
						agentRuntimePlan.verification.recommended.handoffs,
						agentRuntimePlan.verification.finishPlanJsonCommand,
						agentRuntimePlan.verification.finishPlanNextJsonCommand,
						"refarm agent finish --next-command",
						"refarm agent finish --fix --next-command",
						agentRuntimePlan.verification.finishAffectedPlanJsonCommand,
						agentRuntimePlan.verification.finishAffectedRunJsonCommand,
						agentRuntimePlan.verification.finishAffectedUpstreamRunJsonCommand,
						agentRuntimePlan.verification.finishAffectedRunCommand,
						agentRuntimePlan.verification.finishAffectedUpstreamRunCommand,
						agentRuntimePlan.verification.finishAffectedTestRunCommand,
					],
					nextCommands: [
						AGENT_NEXT_COMMAND,
						agentRuntimePlan.runtime.ensure,
						agentRuntimePlan.usage.resume,
						LOCAL_MODEL_JSON_COMMAND,
						SOW_JSON_COMMAND,
						MODEL_CURRENT_JSON_COMMAND,
						agentRuntimePlan.environment.packageManager,
						agentRuntimePlan.environment.codingProfile,
						agentRuntimePlan.workers.list,
						agentRuntimePlan.workers.resume,
						agentRuntimePlan.verification.finishTemplatesJsonCommand,
						agentRuntimePlan.verification.finishLanesJsonCommand,
						agentRuntimePlan.verification.finishLanesNextJsonCommand,
						agentRuntimePlan.verification.recommended.handoffs,
						agentRuntimePlan.verification.finishPlanJsonCommand,
						agentRuntimePlan.verification.finishPlanNextJsonCommand,
						"refarm agent finish --next-command",
						"refarm agent finish --fix --next-command",
						agentRuntimePlan.verification.finishAffectedPlanJsonCommand,
						agentRuntimePlan.verification.finishAffectedRunJsonCommand,
						agentRuntimePlan.verification.finishAffectedUpstreamRunJsonCommand,
						agentRuntimePlan.verification.finishAffectedRunCommand,
						agentRuntimePlan.verification.finishAffectedUpstreamRunCommand,
						agentRuntimePlan.verification.finishAffectedTestRunCommand,
					],
					extra: {
						action: "agent",
						status: "handoff",
						...agentRuntimePlan,
					},
				}),
			);
			return;
		}
		this.outputHelp();
	});

	command
		.command("finish")
		.description("Print the end-of-slice verification plan for coding agents")
		.option("--fix", "Include import organization before verification")
		.option("--include-tests", "Include package test scripts for package or affected profiles")
		.option("--json", "Output machine-readable finish plan")
		.option("--lane <name>", `Recommended finish lane: ${AGENT_FINISH_LANE_HELP}`)
		.option("--lanes", "List recommended finish lanes and commands")
		.option("--next-action", "Print the first finish action or failing recovery action")
		.option("--next-command", "Print the first finish command or failing recovery command")
		.option("--profile <name>", "Validation profile: quick | package | affected", "quick")
		.option("--run", "Execute the finish plan and stop at the first failing step")
		.option("--since <ref>", "For --profile affected, compare changed files against a Git ref")
		.option("--templates", "List parameterized finish command templates")
		.option("--workspace <dir>", "Workspace/package directory for --profile package", ".")
		.addHelpText(
			"after",
			[
				"",
				"Examples:",
				"  $ refarm agent finish --json",
				"  $ refarm agent finish --lanes --json",
				"  $ refarm agent finish --lanes --json --next-command",
				"  $ refarm agent finish --templates --json",
				"  $ refarm agent finish --lane after-edit --run --json",
				"  $ refarm agent finish --lane before-push --run --json",
				"  $ refarm agent finish --lane handoffs --run --json",
				"  $ refarm agent finish --next-command",
				"  $ refarm agent finish --json --next-command",
				"  $ refarm agent finish --fix --next-command",
				"  $ refarm agent finish --run --json",
				"  $ refarm agent finish --fix --run --json",
				"  $ refarm agent finish --profile package --workspace apps/refarm --json",
				"  $ refarm agent finish --profile package --workspace apps/refarm --run",
				"  $ refarm agent finish --profile affected --run --json",
				"  $ refarm agent finish --profile affected --since upstream --run --json",
				"  $ refarm agent finish --profile affected --include-tests --run --json",
				"  $ refarm agent finish --run --next-command",
				"",
				"Notes:",
				"  Without --run this command only prints the commands a coding agent should run.",
				"  --profile quick is the default end-of-slice gate.",
				"  --lane selects a recommended finish command from refarm agent --json.",
				"  --lanes prints the same recommended lane catalog without the full agent handoff.",
				"  --templates prints parameterized commands that require substituting <dir> or <ref>.",
				"  --profile package adds existing package scripts: type-check, lint, build.",
				"  --profile affected adds package scripts for changed Git workspaces.",
				"  --since <ref> lets affected include committed branch changes after atomic commits.",
				"  --since upstream compares against the current branch upstream without network access.",
				"  --include-tests also adds existing package test scripts for package profiles.",
				"  --fix adds refarm tidy imports before the check-only verification steps.",
				"  --run executes selected commands, stops at the first failure, and does not commit changes.",
			].join("\n"),
		)
		.action(function (this: Command, actionArg: unknown) {
			const options = resolveFinishOptions(this, actionArg);
			if (options.lanes) {
				const conflictMessage = lanesConflictMessage(options);
				if (conflictMessage) {
					reportAgentFinishOptionError(conflictMessage, options);
					return;
				}
				const lanes = agentRuntimePlan.verification.lanes;
				const commands = lanes.map((lane) => lane.command);
				if (options.nextCommand && options.json) {
					printJson(buildAgentFinishLanesEnvelope());
					return;
				}
				if (options.nextCommand) {
					const [nextCommand] = commands;
					if (nextCommand) console.log(nextCommand);
					return;
				}
				if (options.nextAction && options.json) {
					printJson(buildAgentFinishLanesEnvelope());
					return;
				}
				if (options.nextAction) {
					const [nextAction] = commands;
					if (nextAction) console.log(nextAction);
					return;
				}
				if (options.json) {
					printJson(buildAgentFinishLanesEnvelope());
					return;
				}
				for (const lane of lanes) {
					console.log(`${lane.id}: ${lane.command}`);
					console.log(`  ${lane.description}`);
					console.log(`  Use when: ${lane.useWhen}`);
				}
				return;
			}
			if (options.templates) {
				const conflictMessage = templatesConflictMessage(options);
				if (conflictMessage) {
					reportAgentFinishOptionError(conflictMessage, options);
					return;
				}
				if (options.nextAction && options.json) {
					printJson(buildAgentFinishTemplatesEnvelope());
					return;
				}
				if (options.nextAction) {
					console.log("Substitute template parameters before executing a finish command.");
					return;
				}
				if (options.json) {
					printJson(buildAgentFinishTemplatesEnvelope());
					return;
				}
				for (const template of agentRuntimePlan.verification.templates) {
					console.log(`${template.id}: ${template.command}`);
					console.log(`  Parameters: ${template.parameters.join(", ")}`);
					console.log(`  Use when: ${template.useWhen}`);
				}
				return;
			}
			let lane: AgentFinishLane | undefined;
			try {
				lane = parseFinishLane(options.lane);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				reportAgentFinishOptionError(message, options);
				return;
			}
			const laneConflict = laneConflictMessage(lane, options);
			if (laneConflict) {
				reportAgentFinishOptionError(laneConflict, options);
				return;
			}
			let profile: AgentFinishProfile;
			try {
				profile = parseFinishProfile(options.profile);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				reportAgentFinishOptionError(message, options);
				return;
			}
			if (options.since && profile !== "affected") {
				reportAgentFinishOptionError("--since only applies to --profile affected.", options);
				return;
			}
			const selection = lane
				? {
					...finishSelectionFromLane(lane),
					fix: options.fix,
					workspace: options.workspace,
				}
				: {
					fix: options.fix,
					includeTests: options.includeTests,
					profile,
					since: options.since,
					workspace: options.workspace,
				};
			let selectionContext: AgentFinishSelectionContext;
			try {
				selectionContext = resolveFinishSelectionContext(selection);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				reportAgentFinishOptionError(message, options, "invalid-agent-finish-since-ref");
				return;
			}
			const selectionWithAffected = {
				...selection,
				...(selectionContext.sinceRef ? { sinceRef: selectionContext.sinceRef } : {}),
				...(selectionContext.affectedWorkspaces
					? { affectedWorkspaces: selectionContext.affectedWorkspaces }
					: {}),
			};
			if (options.run) {
				const result = runAgentFinishPlan(resolvedDeps, selectionWithAffected);
				const selectionMetadata = finishSelectionMetadata(
					selectionWithAffected,
					selectionContext.affectedWorkspaces,
				);
				resolvedDeps.finishRecorder.rememberRun(
					buildAgentFinishRecord({
						result,
						selection: selectionMetadata,
						command: finishRunResumeCommand(selectionMetadata),
					}),
				);
				if (options.json) {
					printJson({
						...buildCommandPlanRunEnvelope({
							action: "finish",
							command: "agent",
							operation: "finish",
						}, result),
						selection: selectionMetadata,
					});
				} else if (options.nextCommand) {
					const [nextCommand] = result.nextCommands;
					if (nextCommand) console.log(nextCommand);
				} else if (options.nextAction) {
					const [nextAction] = result.nextActions;
					if (nextAction) console.log(nextAction);
				} else {
					printAgentFinishRunHuman(
						result,
						selectionMetadata,
					);
				}
				if (!result.ok) process.exitCode = 1;
				return;
			}
			const nextCommands = plannedFinishCommands(selectionWithAffected);
			if (options.nextCommand && options.json) {
				printJson(buildAgentFinishPlanEnvelope(
					selectionWithAffected,
					selectionContext.affectedWorkspaces,
				));
				return;
			}
			if (options.nextCommand) {
				const [nextCommand] = nextCommands;
				if (nextCommand) console.log(nextCommand);
				return;
			}
			if (options.nextAction && options.json) {
				printJson(buildAgentFinishPlanEnvelope(
					selectionWithAffected,
					selectionContext.affectedWorkspaces,
				));
				return;
			}
			if (options.nextAction) {
				const [nextAction] = nextCommands;
				if (nextAction) console.log(nextAction);
				return;
			}
			if (options.json) {
				printJson(buildAgentFinishPlanEnvelope(
					selectionWithAffected,
					selectionContext.affectedWorkspaces,
				));
				return;
			}
			this.outputHelp();
		});

	return command;
}

export const agentCommand = createAgentCommand();
