import { Command } from "commander";
import { spawnSync } from "node:child_process";
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
import { buildJsonSuccessEnvelope, printJson } from "./json-output.js";
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
	},
};

interface AgentCommandDeps {
	runRefarm(args: string[]): CommandPlanStepRunResult;
}

interface AgentFinishOptions {
	fix?: boolean;
	json?: boolean;
	nextAction?: boolean;
	nextCommand?: boolean;
	run?: boolean;
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

function selectedFinishSteps(options: { fix?: boolean } = {}): CommandPlanStep[] {
	return options.fix
		? agentFinishSteps
		: agentFinishSteps.filter((step) => step.id !== "tidy-imports");
}

function plannedFinishCommands(options: { fix?: boolean } = {}): string[] {
	return commandPlanStepCommands(selectedFinishSteps(options));
}

function runAgentFinishPlan(
	deps: AgentCommandDeps,
	options: { fix?: boolean } = {},
): CommandPlanRunResult {
	return runCommandPlan(selectedFinishSteps(options), (step) =>
		deps.runRefarm(step.args),
	);
}

function printAgentFinishRunHuman(result: CommandPlanRunResult): void {
	console.log("Refarm agent finish");
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

export function createAgentCommand(deps?: Partial<AgentCommandDeps>): Command {
	const resolvedDeps: AgentCommandDeps = {
		runRefarm: runRefarmCommand,
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
  $ refarm agent finish --next-command Print the first verification command
  $ refarm agent finish --fix --run Organize imports, then verify
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
						MODEL_PROVIDERS_JSON_COMMAND,
						"refarm plugin list --json",
						"refarm agent finish --next-command",
						"refarm agent finish --fix --next-command",
					],
					nextCommands: [
						"refarm check --next-command",
						agentRuntimePlan.runtime.ensure,
						LOCAL_MODEL_JSON_COMMAND,
						SOW_JSON_COMMAND,
						MODEL_CURRENT_JSON_COMMAND,
						agentRuntimePlan.environment.packageManager,
						"refarm agent finish --next-command",
						"refarm agent finish --fix --next-command",
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
		.option("--json", "Output machine-readable finish plan")
		.option("--next-action", "Print the first finish action or failing recovery action")
		.option("--next-command", "Print the first finish command or failing recovery command")
		.option("--run", "Execute the finish plan and stop at the first failing step")
		.addHelpText(
			"after",
			[
				"",
				"Examples:",
				"  $ refarm agent finish --json",
				"  $ refarm agent finish --next-command",
				"  $ refarm agent finish --fix --next-command",
				"  $ refarm agent finish --run --json",
				"  $ refarm agent finish --fix --run --json",
				"  $ refarm agent finish --run --next-command",
				"",
				"Notes:",
				"  Without --run this command only prints the commands a coding agent should run.",
				"  --fix adds refarm tidy imports before the check-only verification steps.",
				"  --run executes selected commands, stops at the first failure, and does not commit changes.",
			].join("\n"),
		)
		.action(function (this: Command) {
			const options = {
				...this.parent?.opts<AgentFinishOptions>(),
				...this.opts<AgentFinishOptions>(),
			} satisfies AgentFinishOptions;
			if (options.run) {
				const result = runAgentFinishPlan(resolvedDeps, { fix: options.fix });
				if (options.json) {
					printJson(buildCommandPlanRunEnvelope({
						action: "finish",
						command: "agent",
						operation: "finish",
					}, result));
				} else if (options.nextCommand) {
					const [nextCommand] = result.nextCommands;
					if (nextCommand) console.log(nextCommand);
				} else if (options.nextAction) {
					const [nextAction] = result.nextActions;
					if (nextAction) console.log(nextAction);
				} else {
					printAgentFinishRunHuman(result);
				}
				if (!result.ok) process.exitCode = 1;
				return;
			}
			const nextCommands = plannedFinishCommands({ fix: options.fix });
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
				printJson(buildCommandPlanEnvelope({
					action: "finish",
					command: "agent",
					operation: "finish",
				}, selectedFinishSteps({ fix: options.fix })));
				return;
			}
			this.outputHelp();
		});

	return command;
}

export const agentCommand = createAgentCommand();
