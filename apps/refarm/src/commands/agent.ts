import { Command } from "commander";
import { defaultProviderModelRef } from "../model-routing.js";
import { printJson } from "./json-output.js";

const OPENAI_DEFAULT_REF = defaultProviderModelRef("openai");

const agentRuntimePlan = {
	action: "agent",
	ok: true,
	status: "handoff",
	runtime: {
		status: "refarm runtime status --json",
		start: "refarm runtime start --json",
		doctor: "refarm doctor --next-action --json",
	},
	usage: {
		ask: `refarm ask "hello" --json`,
		session: "refarm",
		tidy: "refarm tidy imports --check --json",
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
	nextAction: "refarm doctor --next-action --json",
	nextActions: [
		"refarm runtime status --json",
		"refarm doctor --next-action --json",
		"refarm model current --json",
		"refarm plugin list --json",
	],
};

// Agent runtime commands (status, repl, start/stop) live here.
// Plugin lifecycle (install, update, list) is in `refarm plugin`.
export const agentCommand = new Command("agent").description(
	"Manage the refarm AI agent",
).option("--json", "Output machine-readable agent handoff plan").addHelpText(
	"after",
	`

Runtime commands:
  $ refarm runtime status       Inspect selected runtime engine and readiness
  $ refarm status               Check runtime, plugins, streams, and trust state
  $ refarm doctor --next-action Print the next blocking recovery action
  $ refarm doctor               Diagnose readiness and repair hints

Agent usage:
  $ refarm ask "hello"          Send one prompt through the configured runtime
  $ refarm                     Start or resume an interactive session
  $ refarm tidy imports --check Check import organization before committing
  $ refarm sow                  Configure credentials without editing files
  $ refarm model current        Inspect provider/model routing
  $ refarm model ${OPENAI_DEFAULT_REF} Switch the default route
  $ refarm model base-url ...   Set a self-hosted/OpenAI-compatible endpoint
  $ refarm model fallback ...   Set a retry route for provider failures

Plugin lifecycle:
  $ refarm plugin list          Show bundled plugin install state
  $ refarm plugin install       Install bundled plugins such as @refarm/pi-agent

Automation:
  $ refarm agent --json         Print runtime/model/plugin handoff commands

Notes:
  This command is kept as the stable namespace for future agent runtime controls.
  Today, use runtime/status/doctor for the host, sow/model for credentials and
  routing, and plugin for installation.
`,
).action(function (this: Command, options: { json?: boolean }) {
	if (options.json) {
		printJson(agentRuntimePlan);
		return;
	}
	this.outputHelp();
});
