import { readGitCommand } from "@refarm.dev/cli/git-command";
import {
	affectedWorkspacePackagesFromChangedPaths,
	changedFilePathsFromGitNameOnly,
	changedFilePathsFromGitStatus,
	findWorkspaceRoot as findWorkspaceRootFromMarkers,
} from "@refarm.dev/config";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import type { AgentFinishSessionRecorder } from "./agent-finish-session.js";
import {
	AGENT_FINISH_LANE_HELP,
	agentFinishCommand,
	agentFinishLaneCatalog,
	type AgentFinishLane,
	type AgentFinishLaneValidationScope,
} from "./agent-handoff-plan.js";
import { refarmCommand } from "./command-handoff.js";
import {
	buildCommandPlanEnvelope,
	commandPlanStepCommands,
	runCommandPlan,
	runCommandPlanCliStep,
	runCommandPlanProcessStep,
	type CommandPlanRunResult,
	type CommandPlanStep,
	type CommandPlanStepRunResult,
} from "./command-plan.js";
import { buildJsonErrorEnvelope, printJson } from "./json-output.js";
import { createPackageScriptCommand } from "./package-manager.js";

export interface AgentCommandDeps {
	runRefarm(args: string[]): CommandPlanStepRunResult;
	runProcess(step: CommandPlanStep): CommandPlanStepRunResult;
	finishRecorder: AgentFinishSessionRecorder;
}

export type AgentFinishProfile = "quick" | "package" | "affected";
export interface AgentFinishOptions {
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

export interface AgentFinishSelection {
	fix?: boolean;
	includeTests?: boolean;
	lane?: AgentFinishLane;
	profile: AgentFinishProfile;
	affectedScriptChecks?: string[];
	since?: string;
	sinceRef?: string;
	workspace?: string;
}

export interface AgentFinishSelectionMetadata {
	profile: AgentFinishProfile;
	fix: boolean;
	includeTests: boolean;
	lane: AgentFinishLane | null;
	since: string | null;
	sinceRef: string | null;
	validationScope: AgentFinishLaneValidationScope | "package" | "quick";
	workspace: string | null;
	affectedScriptChecks?: string[];
	affectedWorkspaces?: string[];
}

export interface AgentFinishSelectionContext {
	affectedScriptChecks?: string[];
	affectedWorkspaces?: string[];
	sinceRef?: string;
}

export function runRefarmCommand(args: string[]): CommandPlanStepRunResult {
	return runCommandPlanCliStep(args, {
		executable: process.argv[0]!,
		entrypoint: process.argv[1]!,
		command: refarmCommand(args),
		description: "Refarm command execution result.",
	});
}

export function runProcessCommand(step: CommandPlanStep): CommandPlanStepRunResult {
	if (!step.process) return runRefarmCommand(step.args);
	return runCommandPlanProcessStep(step);
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
		const root = readGitCommand(["rev-parse", "--show-toplevel"], { cwd });
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

function scriptTestStep(input: {
	id: string;
	args: string[];
	description: string;
}): CommandPlanStep {
	const repoRoot = findWorkspaceRoot();
	return {
		id: input.id,
		command: input.args.join(" "),
		args: input.args,
		description: input.description,
		effect: "verify",
		process: {
			command: input.args[0]!,
			args: input.args.slice(1),
			cwd: repoRoot,
			display: input.args.join(" "),
			packageManager: null,
		},
	};
}

function affectedScriptFinishSteps(checks: string[] = []): CommandPlanStep[] {
	return checks.map((check) => {
		if (check === "organize-imports") {
			return scriptTestStep({
				id: "script-organize-imports-test",
				args: ["node", "--test", "scripts/ci/test-organize-imports-lib.mjs"],
				description: "Run the import organizer unit tests.",
			});
		}
		if (check === "agent-e2e-mock") {
			return packageScriptStep(
				".",
				"refarm:agent:e2e:mock",
				"Run the no-token Refarm agent runtime e2e smoke.",
				"script",
			);
		}
		throw new Error(`Unknown affected script check: ${check}`);
	});
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

function affectedWorkspacesFromGit(options: {
	includeWorkingTree?: boolean;
	repoRoot?: string;
	since?: string;
} = {}): string[] {
	return affectedWorkspacePackagesFromChangedPaths(
		options.repoRoot ?? findWorkspaceRoot(),
		changedPathsFromGit(options),
	);
}

function changedPathsFromGit(options: {
	includeWorkingTree?: boolean;
	repoRoot?: string;
	since?: string;
} = {}): string[] {
	const repoRoot = options.repoRoot ?? findWorkspaceRoot();
	const includeWorkingTree = options.includeWorkingTree ?? true;
	try {
		const status = readGitCommand(
			["status", "--short", "--untracked-files=all"],
			{ cwd: repoRoot },
		);
		if (!options.since) {
			return changedFilePathsFromGitStatus(status);
		}
		const diffArgs = includeWorkingTree
			? ["diff", "--name-only", options.since, "--"]
			: ["diff", "--name-only", options.since, "HEAD", "--"];
		const diff = readGitCommand(diffArgs, { cwd: repoRoot });
		return [
			...changedFilePathsFromGitNameOnly(diff),
			...(includeWorkingTree ? changedFilePathsFromGitStatus(status) : []),
		];
	} catch {
		if (options.since) {
			throw new Error(`Could not inspect changed workspaces since ${options.since}. Check that the ref exists.`);
		}
		return [];
	}
}

function affectedScriptChecksFromChangedPaths(paths: string[]): string[] {
	const checks = new Set<string>();
	for (const file of paths) {
		if (
			file === "scripts/organize-imports-lib.mjs" ||
			file === "scripts/organize-imports.mjs" ||
			file === "scripts/ci/test-organize-imports-lib.mjs"
		) {
			checks.add("organize-imports");
		}
		if (isAgentRuntimeE2ePath(file)) {
			checks.add("agent-e2e-mock");
		}
	}
	return [...checks].sort();
}

function isAgentRuntimeE2ePath(file: string): boolean {
	return (
		file === "apps/refarm/src/commands/ask.ts" ||
		file === "apps/refarm/src/commands/pi-agent-effort.ts" ||
		file === "apps/refarm/src/commands/runtime-agent-effort.ts" ||
		file === "apps/refarm/src/commands/runtime-plugins.ts" ||
		file === "scripts/ci/smoke-refarm-agent-model-mock.mjs" ||
		file.startsWith("packages/pi-agent/") ||
		file.startsWith("packages/model-mock/") ||
		file.startsWith("packages/tractor/src/host/wasi_bridge/")
	);
}

function resolveSinceRef(repoRoot: string, since: string): string {
	if (since !== "upstream") return since;
	let upstream = "";
	try {
		upstream = readGitCommand(
			["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
			{ cwd: repoRoot },
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

export function parseFinishProfile(value: string | undefined): AgentFinishProfile {
	if (!value || value === "quick") return "quick";
	if (value === "package") return "package";
	if (value === "affected") return "affected";
	throw new Error(`Unknown finish profile: ${value}. Use: quick | package | affected`);
}

export function parseFinishLane(value: string | undefined): AgentFinishLane | undefined {
	if (!value) return undefined;
	if (agentFinishLaneCatalog.some((lane) => lane.id === value)) return value as AgentFinishLane;
	throw new Error("Unknown finish lane: " + value + ". Use: " + AGENT_FINISH_LANE_HELP);
}

export function finishSelectionFromLane(lane: AgentFinishLane): Omit<AgentFinishSelection, "fix"> {
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
	if (lane === "agent-e2e-mock") {
		return { lane, profile: "quick" };
	}
	return { lane, profile: "affected" };
}

export function laneConflictMessage(lane: AgentFinishLane | undefined, options: AgentFinishOptions): string | null {
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

export function lanesConflictMessage(options: AgentFinishOptions): string | null {
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

export function templatesConflictMessage(options: AgentFinishOptions): string | null {
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
	affectedScriptChecks?: string[];
	affectedWorkspaces?: string[];
} = {}): CommandPlanStep[] {
	const steps = options.fix
		? agentFinishSteps
		: agentFinishSteps.filter((step) => step.id !== "tidy-imports");
	if (options.lane === "handoffs") {
		return [...steps, handoffContractStep()];
	}
	if (options.lane === "agent-e2e-mock") {
		return [...steps, ...affectedScriptFinishSteps(["agent-e2e-mock"])];
	}
	if (options.profile === "package") {
		return [...steps, ...packageFinishSteps(options.workspace ?? ".", options.includeTests)];
	}
	if (options.profile === "affected") {
		return [
			...steps,
			...affectedScriptFinishSteps(options.affectedScriptChecks),
			...affectedPackageFinishSteps(
				options.includeTests,
				options.affectedWorkspaces,
			),
		];
	}
	return steps;
}

export function plannedFinishCommands(options: {
	fix?: boolean;
	includeTests?: boolean;
	lane?: AgentFinishLane;
	profile?: AgentFinishProfile;
	workspace?: string;
	affectedScriptChecks?: string[];
	affectedWorkspaces?: string[];
} = {}): string[] {
	return commandPlanStepCommands(selectedFinishSteps(options));
}

export function runAgentFinishPlan(
	deps: AgentCommandDeps,
	options: {
		fix?: boolean;
		includeTests?: boolean;
		lane?: AgentFinishLane;
		profile?: AgentFinishProfile;
		workspace?: string;
		affectedScriptChecks?: string[];
		affectedWorkspaces?: string[];
	} = {},
): CommandPlanRunResult {
	return runCommandPlan(selectedFinishSteps(options), (step) =>
		step.process ? deps.runProcess(step) : deps.runRefarm(step.args),
	);
}

export function buildAgentFinishPlanEnvelope(
	selection: AgentFinishSelection & {
		affectedScriptChecks?: string[];
		affectedWorkspaces?: string[];
	},
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

export function finishSelectionMetadata(
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
			? {
					affectedScriptChecks: selection.affectedScriptChecks ?? [],
					affectedWorkspaces: affectedWorkspaces ?? [],
				}
			: {}),
	};
}

function finishValidationScope(
	selection: AgentFinishSelection,
): AgentFinishSelectionMetadata["validationScope"] {
	if (selection.lane === "after-commit") return "lastCommit";
	if (selection.lane === "agent-e2e-mock") return "runtime";
	if (selection.profile === "affected") {
		return selection.since ? "branchRange" : "dirtyTree";
	}
	if (selection.lane === "handoffs") return "contract";
	return selection.profile;
}

export function finishRunResumeCommand(selection: AgentFinishSelectionMetadata): string {
	const args = ["agent", "finish"];
	if (selection.lane) {
		args.push("--lane", selection.lane);
	} else if (selection.profile !== "quick") {
		args.push("--profile", selection.profile);
	}
	if (selection.profile === "package" && selection.workspace) {
		args.push("--workspace", selection.workspace);
	}
	if (!selection.lane && selection.profile === "affected" && selection.sinceRef) {
		args.push("--since", selection.sinceRef);
	}
	if (selection.includeTests) args.push("--include-tests");
	if (selection.fix) args.push("--fix");
	args.push("--run", "--json");
	return refarmCommand(args);
}

export function resolveFinishSelectionContext(
	selection: AgentFinishSelection,
): AgentFinishSelectionContext {
	if (selection.profile !== "affected") return {};
	const repoRoot = findWorkspaceRoot();
	const sinceRef = selection.since ? resolveSinceRef(repoRoot, selection.since) : undefined;
	const changedPaths = changedPathsFromGit({
		includeWorkingTree: selection.lane !== "after-commit",
		repoRoot,
		since: sinceRef,
	});
	return {
		affectedScriptChecks: affectedScriptChecksFromChangedPaths(changedPaths),
		affectedWorkspaces: affectedWorkspacePackagesFromChangedPaths(repoRoot, changedPaths),
		...(sinceRef ? { sinceRef } : {}),
	};
}

export function printAgentFinishRunHuman(
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
		const scripts = selection.affectedScriptChecks ?? [];
		const since = formatSinceSelection(selection);
		const parts: string[] = [];
		if (workspaces.length > 0) parts.push(workspaces.join(", "));
		if (scripts.length > 0) parts.push(`scripts: ${scripts.join(", ")}`);
		return parts.length > 0
			? `affected${since} (${parts.join("; ")})`
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

export function resolveFinishOptions(self: Command, actionArg: unknown): AgentFinishOptions {
	const command = actionArg && typeof actionArg === "object" && "opts" in actionArg
		? actionArg as Command
		: self;
	return {
		...command.parent?.opts<AgentFinishOptions>(),
		...command.opts<AgentFinishOptions>(),
	};
}

export function reportAgentFinishOptionError(
	message: string,
	options: AgentFinishOptions,
	error = "invalid-agent-finish-options",
): void {
	const fallbackCommand = error === "invalid-agent-finish-since-ref"
		? options.run
			? agentFinishCommand(["--profile", "affected", "--run", "--json"])
			: agentFinishCommand(["--profile", "affected", "--json"])
		: agentFinishCommand(["--help"]);
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
				? [fallbackCommand, agentFinishCommand(["--help"])]
				: [fallbackCommand],
		}));
	} else {
		console.error(message);
	}
	process.exitCode = 1;
}
