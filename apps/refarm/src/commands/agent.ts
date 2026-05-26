import {
	affectedWorkspacePackagesFromChangedPaths,
	affectedWorkspacePackagesFromGitStatus,
	changedFilePathsFromGitNameOnly,
	changedFilePathsFromGitStatus,
} from "@refarm.dev/config";
import { Command } from "commander";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
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
	verification: {
		quick: "refarm check --next-action --json",
		quickCommand: "refarm check --next-command",
		health: "refarm health --next-action --json",
		doctor: "refarm doctor --next-action --json",
		doctorCommand: "refarm doctor --next-command",
		tidyCheck: "refarm tidy imports --check --json",
		finishPlanCommand: "refarm agent finish --next-command",
		finishRunCommand: "refarm agent finish --run --next-command",
		finishFixPlanCommand: "refarm agent finish --fix --next-command",
		finishFixRunCommand: "refarm agent finish --fix --run --next-command",
		finishPackagePlanCommand: "refarm agent finish --profile package --workspace <dir> --next-command",
		finishPackageRunCommand: "refarm agent finish --profile package --workspace <dir> --run --next-command",
		finishPackageFixRunCommand: "refarm agent finish --fix --profile package --workspace <dir> --run --next-command",
		finishAffectedPlanJsonCommand: "refarm agent finish --profile affected --json",
		finishAffectedRunJsonCommand: "refarm agent finish --profile affected --run --json",
		finishAffectedUpstreamRunJsonCommand: "refarm agent finish --profile affected --since upstream --run --json",
		finishAffectedSinceRunJsonCommand: "refarm agent finish --profile affected --since <ref> --run --json",
		finishAffectedTestRunJsonCommand: "refarm agent finish --profile affected --include-tests --run --json",
		finishAffectedRunCommand: "refarm agent finish --profile affected --run --next-command",
		finishAffectedUpstreamRunCommand: "refarm agent finish --profile affected --since upstream --run --next-command",
		finishAffectedSinceRunCommand: "refarm agent finish --profile affected --since <ref> --run --next-command",
		finishAffectedTestRunCommand: "refarm agent finish --profile affected --include-tests --run --next-command",
		recommended: {
			afterEdit: "refarm agent finish --lane after-edit --run --json",
			afterCommit: "refarm agent finish --lane after-commit --run --json",
			beforePush: "refarm agent finish --lane before-push --run --json",
			withPackageTests: "refarm agent finish --lane with-package-tests --run --json",
		},
	},
};

interface AgentCommandDeps {
	runRefarm(args: string[]): CommandPlanStepRunResult;
	runProcess(step: CommandPlanStep): CommandPlanStepRunResult;
}

type AgentFinishProfile = "quick" | "package" | "affected";
type AgentFinishLane = "after-commit" | "after-edit" | "before-push" | "with-package-tests";

interface AgentFinishOptions {
	fix?: boolean;
	includeTests?: boolean;
	json?: boolean;
	lane?: string;
	nextAction?: boolean;
	nextCommand?: boolean;
	profile?: string;
	run?: boolean;
	since?: string;
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
	validationScope: "branchRange" | "dirtyTree" | "package" | "quick";
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
		id: `${idPrefix}-${script}`,
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
	let current = path.resolve(cwd);
	while (true) {
		if (
			fs.existsSync(path.join(current, "pnpm-workspace.yaml")) ||
			fs.existsSync(path.join(current, ".git"))
		) {
			return current;
		}
		const parent = path.dirname(current);
		if (parent === current) return path.resolve(cwd);
		current = parent;
	}
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
	if (value === "after-commit") return "after-commit";
	if (value === "after-edit") return "after-edit";
	if (value === "before-push") return "before-push";
	if (value === "with-package-tests") return "with-package-tests";
	throw new Error("Unknown finish lane: " + value + ". Use: after-edit | after-commit | before-push | with-package-tests");
}

function finishSelectionFromLane(lane: AgentFinishLane): Omit<AgentFinishSelection, "fix"> {
	if (lane === "after-commit" || lane === "before-push") {
		return { lane, profile: "affected", since: "upstream" };
	}
	if (lane === "with-package-tests") {
		return { lane, includeTests: true, profile: "affected" };
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

function selectedFinishSteps(options: {
	fix?: boolean;
	includeTests?: boolean;
	profile?: AgentFinishProfile;
	workspace?: string;
	affectedWorkspaces?: string[];
} = {}): CommandPlanStep[] {
	const steps = options.fix
		? agentFinishSteps
		: agentFinishSteps.filter((step) => step.id !== "tidy-imports");
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
		profile?: AgentFinishProfile;
		workspace?: string;
		affectedWorkspaces?: string[];
	} = {},
): CommandPlanRunResult {
	return runCommandPlan(selectedFinishSteps(options), (step) =>
		step.process ? deps.runProcess(step) : deps.runRefarm(step.args),
	);
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
	if (selection.profile === "affected") {
		return selection.since ? "branchRange" : "dirtyTree";
	}
	return selection.profile;
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
	const nextActions = error === "invalid-agent-finish-since-ref"
		? [
			"Pass an explicit Git ref with `refarm agent finish --profile affected --since <ref> --json`.",
			"Configure the current branch upstream, then retry `refarm agent finish --profile affected --since upstream --json`.",
		]
		: ["Run `refarm agent finish --help` and choose a valid finish profile."];
	if (options.json) {
		printJson(buildJsonErrorEnvelope({
			command: "agent",
			operation: "finish",
			error,
			message,
			nextAction: nextActions[0]!,
			nextActions,
			nextCommand: "refarm agent finish --help",
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
		...deps,
	};
	// Agent runtime commands (status, repl, start/stop) live here.
	// Plugin lifecycle (install, update, list) is in `refarm plugin`.
	const command = new Command("agent").description(
		"Manage the refarm AI agent",
	).option("--json", "Output machine-readable agent handoff plan").addHelpText(
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
  $ refarm tidy imports --check Check import organization before committing
  $ refarm tidy imports         Organize imports after an editing slice
  $ refarm sow                  Configure credentials without editing files
  $ refarm sow --json           Print credential handoffs for non-interactive agents
  $ refarm model current        Inspect provider/model routing
  $ refarm model providers      Inspect provider credential requirements
  $ refarm model ${OPENAI_DEFAULT_REF} Switch the default route
  $ refarm model base-url ...   Set a self-hosted/OpenAI-compatible endpoint
  $ refarm model fallback ...   Set a retry route for provider failures

Verification:
  $ refarm check --next-action --json Composite health + doctor gate
  $ refarm check --next-command      Print the next executable recovery command
  $ refarm tidy imports --check --json Check import organization
  $ refarm agent finish --json      Print an end-of-slice verification plan
  $ refarm agent finish --lane after-edit --run --json Verify dirty-tree edits
  $ refarm agent finish --lane before-push --run --json Verify branch changes
  $ refarm agent finish --next-command Print the first verification command
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
  $ refarm agent finish --json  Print ordered verification commands before commit
  $ refarm agent finish --run --json Execute ordered verification commands
  $ refarm agent finish --run --next-command Print the failing recovery command

Notes:
  This command is kept as the stable namespace for future agent runtime controls.
  Today, use runtime/status/doctor for the host, sow/model for credentials and
  routing, and plugin for installation.
`,
	).action(function (this: Command) {
		const options = this.opts<{ json?: boolean }>();
		if (options.json) {
			printJson(
				buildJsonSuccessEnvelope({
					command: "agent",
					operation: "handoff",
					nextAction: "refarm check --next-action --json",
					nextCommand: "refarm check --next-command",
					nextActions: [
						"refarm check --next-action --json",
						agentRuntimePlan.runtime.status,
						agentRuntimePlan.runtime.ensure,
						MODEL_CURRENT_JSON_COMMAND,
						agentRuntimePlan.environment.packageManager,
						agentRuntimePlan.environment.codingProfile,
						MODEL_PROVIDERS_JSON_COMMAND,
						"refarm plugin list --json",
						"refarm agent finish --next-command",
						"refarm agent finish --fix --next-command",
						agentRuntimePlan.verification.finishPackagePlanCommand,
						agentRuntimePlan.verification.finishAffectedPlanJsonCommand,
						agentRuntimePlan.verification.finishAffectedRunJsonCommand,
						agentRuntimePlan.verification.finishAffectedUpstreamRunJsonCommand,
						agentRuntimePlan.verification.finishAffectedSinceRunJsonCommand,
						agentRuntimePlan.verification.finishAffectedRunCommand,
						agentRuntimePlan.verification.finishAffectedUpstreamRunCommand,
						agentRuntimePlan.verification.finishAffectedSinceRunCommand,
						agentRuntimePlan.verification.finishAffectedTestRunCommand,
					],
					nextCommands: [
						"refarm check --next-command",
						agentRuntimePlan.runtime.ensure,
						LOCAL_MODEL_JSON_COMMAND,
						SOW_JSON_COMMAND,
						MODEL_CURRENT_JSON_COMMAND,
						agentRuntimePlan.environment.packageManager,
						agentRuntimePlan.environment.codingProfile,
						"refarm agent finish --next-command",
						"refarm agent finish --fix --next-command",
						agentRuntimePlan.verification.finishPackageRunCommand,
						agentRuntimePlan.verification.finishAffectedPlanJsonCommand,
						agentRuntimePlan.verification.finishAffectedRunJsonCommand,
						agentRuntimePlan.verification.finishAffectedUpstreamRunJsonCommand,
						agentRuntimePlan.verification.finishAffectedSinceRunJsonCommand,
						agentRuntimePlan.verification.finishAffectedRunCommand,
						agentRuntimePlan.verification.finishAffectedUpstreamRunCommand,
						agentRuntimePlan.verification.finishAffectedSinceRunCommand,
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
		.option("--lane <name>", "Recommended finish lane: after-edit | after-commit | before-push | with-package-tests")
		.option("--next-action", "Print the first finish action or failing recovery action")
		.option("--next-command", "Print the first finish command or failing recovery command")
		.option("--profile <name>", "Validation profile: quick | package | affected", "quick")
		.option("--run", "Execute the finish plan and stop at the first failing step")
		.option("--since <ref>", "For --profile affected, compare changed files against a Git ref")
		.option("--workspace <dir>", "Workspace/package directory for --profile package", ".")
		.addHelpText(
			"after",
			[
				"",
				"Examples:",
				"  $ refarm agent finish --json",
				"  $ refarm agent finish --lane after-edit --run --json",
				"  $ refarm agent finish --lane before-push --run --json",
				"  $ refarm agent finish --next-command",
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
				if (options.json) {
					printJson({
						...buildCommandPlanRunEnvelope({
							action: "finish",
							command: "agent",
							operation: "finish",
						}, result),
						selection: finishSelectionMetadata(
							selectionWithAffected,
							selectionContext.affectedWorkspaces,
						),
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
						finishSelectionMetadata(
							selectionWithAffected,
							selectionContext.affectedWorkspaces,
						),
					);
				}
				if (!result.ok) process.exitCode = 1;
				return;
			}
			const nextCommands = plannedFinishCommands(selectionWithAffected);
			if (options.nextCommand) {
				const [nextCommand] = nextCommands;
				if (nextCommand) console.log(nextCommand);
				return;
			}
			if (options.nextAction) {
				const [nextAction] = nextCommands;
				if (nextAction) console.log(nextAction);
				return;
			}
			if (options.json) {
				printJson({
					...buildCommandPlanEnvelope({
						action: "finish",
						command: "agent",
						operation: "finish",
					}, selectedFinishSteps(selectionWithAffected)),
					selection: finishSelectionMetadata(
						selectionWithAffected,
						selectionContext.affectedWorkspaces,
					),
				});
				return;
			}
			this.outputHelp();
		});

	return command;
}

export const agentCommand = createAgentCommand();
