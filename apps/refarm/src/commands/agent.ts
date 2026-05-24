import { Command } from "commander";
import { spawnSync } from "node:child_process";
import { defaultProviderModelRef } from "../model-routing.js";
import { refarmCommand } from "./command-handoff.js";
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

interface AgentFinishStep {
	id: string;
	command: string;
	args: string[];
	description: string;
}

interface AgentFinishStepRunResult extends AgentFinishStep {
	ok: boolean;
	exitCode: number;
	stdout: string;
	stderr: string;
	payload?: unknown;
}

interface AgentCommandDeps {
	runRefarm(args: string[]): AgentFinishStepRunResult;
}

function runRefarmCommand(args: string[]): AgentFinishStepRunResult {
	const result = spawnSync(process.argv[0]!, [process.argv[1]!, ...args], {
		cwd: process.cwd(),
		env: process.env,
		encoding: "utf-8",
	});
	const exitCode = result.status ?? (result.error ? 1 : 0);
	const stdout = result.stdout ?? "";
	const stderr = result.stderr ?? "";
	return {
		id: args.join(" "),
		command: refarmCommand(args),
		args,
		description: "Refarm command execution result.",
		ok: exitCode === 0,
		exitCode,
		stdout,
		stderr,
		...(parseJsonPayload(stdout) !== undefined
			? { payload: parseJsonPayload(stdout) }
			: {}),
	};
}

function parseJsonPayload(stdout: string): unknown {
	const trimmed = stdout.trim();
	if (!trimmed) return undefined;
	try {
		return JSON.parse(trimmed);
	} catch {
		return undefined;
	}
}

function finishStep(
	id: string,
	args: string[],
	description: string,
): AgentFinishStep {
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

function runAgentFinishPlan(
	deps: AgentCommandDeps,
): {
	ok: boolean;
	status: "passed" | "failed";
	steps: AgentFinishStepRunResult[];
	nextActions: string[];
	nextCommands: string[];
} {
	const steps: AgentFinishStepRunResult[] = [];
	for (const step of agentFinishSteps) {
		const result = {
			...deps.runRefarm(step.args),
			id: step.id,
			command: step.command,
			args: step.args,
			description: step.description,
		};
		const payloadOk = payloadOkValue(result.payload);
		const ok = result.exitCode === 0 && payloadOk !== false;
		const normalized = { ...result, ok };
		steps.push(normalized);
		if (!ok) {
			return {
				ok: false,
				status: "failed",
				steps,
				nextActions: payloadNextActions(result.payload) ??
					payloadNextCommands(result.payload) ?? [step.command],
				nextCommands: payloadNextCommands(result.payload) ?? [step.command],
			};
		}
	}
	return {
		ok: true,
		status: "passed",
		steps,
		nextActions: [],
		nextCommands: [],
	};
}

function payloadOkValue(payload: unknown): boolean | undefined {
	if (!payload || typeof payload !== "object" || !("ok" in payload)) {
		return undefined;
	}
	const value = (payload as { ok?: unknown }).ok;
	return typeof value === "boolean" ? value : undefined;
}

function payloadNextCommands(payload: unknown): string[] | undefined {
	if (!payload || typeof payload !== "object") return undefined;
	const value = (payload as { nextCommands?: unknown }).nextCommands;
	if (!Array.isArray(value)) return undefined;
	const commands = value.filter((item): item is string => typeof item === "string");
	return commands.length > 0 ? commands : undefined;
}

function payloadNextActions(payload: unknown): string[] | undefined {
	if (!payload || typeof payload !== "object") return undefined;
	const value = (payload as { nextActions?: unknown }).nextActions;
	if (!Array.isArray(value)) return undefined;
	const actions = value.filter((item): item is string => typeof item === "string");
	return actions.length > 0 ? actions : undefined;
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

Plugin lifecycle:
  $ refarm plugin list          Show bundled plugin install state
  $ refarm plugin install       Install bundled plugins such as @refarm/pi-agent

Automation:
  $ refarm agent --json         Print runtime/model/plugin handoff commands
  $ refarm agent finish --json  Print ordered verification commands before commit

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
		.option("--run", "Execute the finish plan and stop at the first failing step")
		.addHelpText(
			"after",
			[
				"",
				"Examples:",
				"  $ refarm agent finish --json",
				"  $ refarm agent finish --run --json",
				"",
				"Notes:",
				"  Without --run this command only prints the checks a coding agent should run.",
				"  --run executes check-only commands, stops at the first failure, and does not commit changes.",
			].join("\n"),
		)
		.action(function (this: Command) {
			const options = {
				...this.parent?.opts<{ json?: boolean; run?: boolean }>(),
				...this.opts<{ json?: boolean; run?: boolean }>(),
			};
			if (options.run) {
				const result = runAgentFinishPlan(resolvedDeps);
				printJson({
					action: "finish",
					status: result.status,
					steps: result.steps,
					command: "agent",
					operation: "finish",
					ok: result.ok,
					nextAction: result.nextActions[0] ?? result.nextCommands[0] ?? null,
					nextActions: result.nextActions,
					nextCommand: result.nextCommands[0] ?? null,
					nextCommands: result.nextCommands,
				});
				if (!result.ok) process.exitCode = 1;
				return;
			}
			if (options.json) {
				const nextCommands = agentFinishSteps.map((step) => step.command);
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
