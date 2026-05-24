import { Command } from "commander";
import { spawnSync } from "node:child_process";
import { defaultProviderModelRef } from "../model-routing.js";
import { refarmCommand } from "./command-handoff.js";
import {
	runCommandPlan,
	type CommandPlanRunResult,
	type CommandPlanStep,
	type CommandPlanStepRunResult,
} from "./command-plan.js";
import {
	parseCommandJsonPayload,
} from "./command-result.js";
import { buildJsonSuccessEnvelope, printJson } from "./json-output.js";

const OPENAI_DEFAULT_REF = defaultProviderModelRef("openai");

const agentRuntimePlan = {
	runtime: {
		status: "refarm runtime status --json",
		start: "refarm runtime start --json",
		doctor: "refarm doctor --next-action --json",
		doctorCommand: "refarm doctor --next-command",
	},
	usage: {
		ask: `refarm ask "hello" --json`,
		session: "refarm",
		tidyCheck: "refarm tidy imports --check --json",
		tidyApply: "refarm tidy imports --json",
	},
	credentials: {
		configure: "refarm sow",
		status: "refarm model current --json",
		setModel: `refarm model ${OPENAI_DEFAULT_REF} --json`,
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
	},
};

interface AgentCommandDeps {
	runRefarm(args: string[]): CommandPlanStepRunResult;
}

interface AgentFinishOptions {
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
): CommandPlanStep {
	return {
		id,
		command: refarmCommand(args),
		args,
		description,
	};
}

const agentFinishSteps = [
	finishStep(
		"tidy-imports-check",
		["tidy", "imports", "--check", "--json"],
		"Check import organization after the editing slice.",
	),
	finishStep(
		"health",
		["health", "--next-action", "--json"],
		"Audit filesystem, build alignment, and resolution health.",
	),
	finishStep(
		"check",
		["check", "--next-action", "--json"],
		"Run the composite readiness gate and surface recovery actions.",
	),
];

function plannedFinishCommands(): string[] {
	return agentFinishSteps.map((step) => step.command);
}

function runAgentFinishPlan(
	deps: AgentCommandDeps,
): CommandPlanRunResult {
	return runCommandPlan(agentFinishSteps, (step) => deps.runRefarm(step.args));
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
  $ refarm model current        Inspect provider/model routing
  $ refarm model ${OPENAI_DEFAULT_REF} Switch the default route
  $ refarm model base-url ...   Set a self-hosted/OpenAI-compatible endpoint
  $ refarm model fallback ...   Set a retry route for provider failures

Verification:
  $ refarm check --next-action --json Composite health + doctor gate
  $ refarm check --next-command      Print the next executable recovery command
  $ refarm tidy imports --check --json Check import organization
  $ refarm agent finish --json      Print an end-of-slice verification plan
  $ refarm agent finish --next-command Print the first verification command
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
						"refarm runtime status --json",
						"refarm model current --json",
						"refarm plugin list --json",
					],
					nextCommands: ["refarm check --next-command"],
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
				"  $ refarm agent finish --run --json",
				"  $ refarm agent finish --run --next-command",
				"",
				"Notes:",
				"  Without --run this command only prints the checks a coding agent should run.",
				"  --run executes check-only commands, stops at the first failure, and does not commit changes.",
			].join("\n"),
		)
		.action(function (this: Command) {
			const options = {
				...this.parent?.opts<AgentFinishOptions>(),
				...this.opts<AgentFinishOptions>(),
			} satisfies AgentFinishOptions;
			if (options.run) {
				const result = runAgentFinishPlan(resolvedDeps);
				if (options.json) {
					printJson({
						action: "finish",
						status: result.status,
						steps: result.steps,
						command: "agent",
						operation: "finish",
						ok: result.ok,
						nextAction:
							result.nextActions[0] ?? result.nextCommands[0] ?? null,
						nextActions: result.nextActions,
						nextCommand: result.nextCommands[0] ?? null,
						nextCommands: result.nextCommands,
					});
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
			const nextCommands = plannedFinishCommands();
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
				printJson(
					buildJsonSuccessEnvelope({
						command: "agent",
						operation: "finish",
						nextAction: nextCommands[0] ?? null,
						nextActions: nextCommands,
						nextCommand: nextCommands[0] ?? null,
						nextCommands,
						extra: {
							action: "finish",
							status: "plan",
							steps: agentFinishSteps,
						},
					}),
				);
				return;
			}
			this.outputHelp();
		});

	return command;
}

export const agentCommand = createAgentCommand();
