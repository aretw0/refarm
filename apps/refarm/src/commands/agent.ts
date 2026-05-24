import { Command } from "commander";
import { defaultProviderModelRef } from "../model-routing.js";
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

const agentFinishSteps = [
	{
		id: "tidy-imports-check",
		command: "refarm tidy imports --check --json",
		description: "Check import organization after the editing slice.",
	},
	{
		id: "health",
		command: "refarm health --next-action --json",
		description: "Audit filesystem, build alignment, and resolution health.",
	},
	{
		id: "check",
		command: "refarm check --next-action --json",
		description: "Run the composite readiness gate and surface recovery actions.",
	},
] as const;

export function createAgentCommand(): Command {
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
		.addHelpText(
			"after",
			[
				"",
				"Examples:",
				"  $ refarm agent finish --json",
				"",
				"Notes:",
				"  This command prints the checks a coding agent should run after edits.",
				"  It does not execute checks, mutate files, or commit changes.",
			].join("\n"),
		)
		.action(function (this: Command) {
			const options = {
				...this.parent?.opts<{ json?: boolean }>(),
				...this.opts<{ json?: boolean }>(),
			};
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
