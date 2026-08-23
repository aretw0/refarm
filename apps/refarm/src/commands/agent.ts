import { buildJsonSuccessEnvelope, printJson } from "@refarm.dev/capabilities/envelope";
import { buildCommandPlanRunEnvelope } from "@refarm.dev/cli/command-plan";
import { Command } from "commander";
import {
	buildAgentFinishPlanEnvelope,
	finishCacheObservations,
	finishRunResumeCommand,
	finishSelectionFromLane,
	finishSelectionMetadata,
	laneConflictMessage,
	lanesConflictMessage,
	parseFinishLane,
	parseFinishProfile,
	plannedFinishCommands,
	printAgentFinishRunHuman,
	reportAgentFinishOptionError,
	resolveFinishOptions,
	resolveFinishSelectionContext,
	runAgentFinishPlan,
	runProcessCommand,
	runRefarmCommand,
	templatesConflictMessage,
	type AgentCommandDeps,
	type AgentFinishProfile,
	type AgentFinishSelectionContext,
} from "./agent-finish-plan.js";
import {
	buildAgentFinishRecord,
	createAgentFinishSessionRecorder,
} from "./agent-finish-session.js";
import {
	AGENT_FINISH_LANE_HELP,
	AGENT_NEXT_ACTION_COMMAND,
	AGENT_NEXT_COMMAND,
	agentRuntimePlan,
	buildAgentFinishLanesEnvelope,
	buildAgentFinishTemplatesEnvelope,
	buildAgentNextHandoffEnvelope,
	type AgentFinishLane,
} from "./agent-handoff-plan.js";
import {
	LOCAL_MODEL_JSON_COMMAND,
	MODEL_CURRENT_JSON_COMMAND,
	MODEL_DOCTOR_JSON_COMMAND,
	MODEL_PROVIDERS_JSON_COMMAND,
	OPENAI_DEFAULT_REF,
	RESUME_JSON_COMMAND,
	SOW_JSON_COMMAND,
} from "./credential-handoffs.js";

export function createAgentCommand(deps?: Partial<AgentCommandDeps>): Command {
	const resolvedDeps: AgentCommandDeps = {
		runRefarm: runRefarmCommand,
		runProcess: runProcessCommand,
		finishRecorder: createAgentFinishSessionRecorder(),
		...deps,
	};
	if (deps?.runRefarm && !deps.runProcess) {
		resolvedDeps.runProcess = (step) => deps.runRefarm!(step.args);
	}
	// Agent runtime commands (status, repl, start/stop) live here.
	// Plugin lifecycle (install, update, list) is in `refarm plugin`.
	const command = new Command("agent")
		.description("Manage the refarm AI agent")
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
  $ refarm workspace execution  Inspect workspace executor/cache readiness
  $ refarm workspace execution --all Inspect declared workspace/bridge readiness
  $ refarm sow                  Configure credentials without editing files
  $ refarm sow --json           Print credential handoffs for non-interactive agents
  $ refarm model current        Inspect provider/model routing
  $ refarm model providers      Inspect provider credential requirements
  $ refarm model ${OPENAI_DEFAULT_REF} Switch the default route
  $ refarm model base-url ...   Set a self-hosted/OpenAI-compatible endpoint
  $ refarm model fallback ...   Set a retry route for provider failures

Worker efforts:
  $ refarm task resume --json   Resume from the local task checkpoint
  $ refarm task list --json     Inspect queued and recent async efforts
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
  $ refarm agent finish --lane agent-e2e-mock --run --json Verify no-token agent runtime e2e
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
  $ refarm plugin install       Install bundled plugins such as the runtime agent

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
		)
		.action(function (this: Command) {
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
							MODEL_DOCTOR_JSON_COMMAND,
							agentRuntimePlan.environment.packageManager,
							agentRuntimePlan.environment.workspaceExecution,
							agentRuntimePlan.environment.workspaceSweep,
							agentRuntimePlan.environment.codingProfile,
							MODEL_PROVIDERS_JSON_COMMAND,
							agentRuntimePlan.plugins.list,
							agentRuntimePlan.workers.resume,
							agentRuntimePlan.workers.list,
							agentRuntimePlan.verification.finishTemplatesJsonCommand,
							agentRuntimePlan.verification.finishLanesJsonCommand,
							agentRuntimePlan.verification.finishLanesNextJsonCommand,
							agentRuntimePlan.verification.recommended.handoffs,
							agentRuntimePlan.verification.recommended.agentE2eMock,
							agentRuntimePlan.verification.finishPlanJsonCommand,
							agentRuntimePlan.verification.finishPlanNextJsonCommand,
							agentRuntimePlan.verification.finishPlanCommand,
							agentRuntimePlan.verification.finishFixPlanCommand,
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
							MODEL_DOCTOR_JSON_COMMAND,
							MODEL_PROVIDERS_JSON_COMMAND,
							agentRuntimePlan.environment.packageManager,
							agentRuntimePlan.environment.workspaceExecution,
							agentRuntimePlan.environment.workspaceSweep,
							agentRuntimePlan.environment.codingProfile,
							agentRuntimePlan.plugins.list,
							agentRuntimePlan.workers.resume,
							agentRuntimePlan.workers.list,
							agentRuntimePlan.verification.finishTemplatesJsonCommand,
							agentRuntimePlan.verification.finishLanesJsonCommand,
							agentRuntimePlan.verification.finishLanesNextJsonCommand,
							agentRuntimePlan.verification.recommended.handoffs,
							agentRuntimePlan.verification.recommended.agentE2eMock,
							agentRuntimePlan.verification.finishPlanJsonCommand,
							agentRuntimePlan.verification.finishPlanNextJsonCommand,
							agentRuntimePlan.verification.finishPlanCommand,
							agentRuntimePlan.verification.finishFixPlanCommand,
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
				"  $ refarm agent finish --lane agent-e2e-mock --run --json",
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
					if ("cwdParameter" in template) {
						console.log(`  CWD parameter: ${template.cwdParameter}`);
					}
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
				...(selectionContext.affectedScriptChecks
					? { affectedScriptChecks: selectionContext.affectedScriptChecks }
					: {}),
				...(selectionContext.affectedWorkspaces
					? { affectedWorkspaces: selectionContext.affectedWorkspaces }
					: {}),
				// The changed files themselves, so the plan can ask the script-suite runner which
				// of the ~90 `node --test` registrations this edit could have broken (ISS-106).
				...(selectionContext.changedPaths ? { changedPaths: selectionContext.changedPaths } : {}),
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
					const envelope = buildCommandPlanRunEnvelope(
						{
							action: "finish",
							command: "agent",
							operation: "finish",
						},
						result,
					);
					const cacheObservations = finishCacheObservations(result);
					printJson({
						...envelope,
						...(result.ok
							? {
									nextCommand: RESUME_JSON_COMMAND,
									nextCommands: [RESUME_JSON_COMMAND],
								}
							: {}),
						...(cacheObservations.length > 0 ? { cache: { steps: cacheObservations } } : {}),
						selection: selectionMetadata,
					});
				} else if (options.nextCommand) {
					const [nextCommand] = result.nextCommands;
					if (nextCommand) console.log(nextCommand);
				} else if (options.nextAction) {
					const [nextAction] = result.nextActions;
					if (nextAction) console.log(nextAction);
				} else {
					printAgentFinishRunHuman(result, selectionMetadata);
				}
				if (!result.ok) process.exitCode = 1;
				return;
			}
			const nextCommands = plannedFinishCommands(selectionWithAffected);
			if (options.nextCommand && options.json) {
				printJson(
					buildAgentFinishPlanEnvelope(selectionWithAffected, selectionContext.affectedWorkspaces),
				);
				return;
			}
			if (options.nextCommand) {
				const [nextCommand] = nextCommands;
				if (nextCommand) console.log(nextCommand);
				return;
			}
			if (options.nextAction && options.json) {
				printJson(
					buildAgentFinishPlanEnvelope(selectionWithAffected, selectionContext.affectedWorkspaces),
				);
				return;
			}
			if (options.nextAction) {
				const [nextAction] = nextCommands;
				if (nextAction) console.log(nextAction);
				return;
			}
			if (options.json) {
				printJson(
					buildAgentFinishPlanEnvelope(selectionWithAffected, selectionContext.affectedWorkspaces),
				);
				return;
			}
			this.outputHelp();
		});

	// `agent probe` — the end-to-end liveness check the other diagnostics miss: it submits a
	// real minimal respond and reports whether the agent COMPLETES it. `doctor`/`model doctor`
	// pass while the agent is a zombie (dispatch received, nothing executed); this doesn't.
	//
	// NAMED `probe`, NOT `doctor` (ISS-104, decided 2026-08-23). Both readings of the old name were
	// defensible and the choice is which one this command IS: a cheap read here would say nothing
	// `refarm check`, `refarm doctor` and `refarm model doctor` do not already say, so the dispatch
	// is its only reason to exist. That settles it — the dispatch stays, and the WORD moves, because
	// every other `doctor` in this CLI is a read and one that spends teaches an operator to distrust
	// the whole family. `doctor` still works, deprecated, below.
	command
		.command("probe")
		.description(
			"Probe whether the agent actually completes a respond (detects a zombie agent) — DISPATCHES a real prompt",
		)
		.option("--json", "Output machine-readable result")
		.option("--timeout <ms>", "How long to wait for the probe respond (ms)")
		.addHelpText(
			"after",
			`
THIS COMMAND SPENDS. It is not a read.

Detecting a zombie agent means watching one COMPLETE a respond, so this submits a
real minimal prompt through whichever route is configured and waits for the
answer. On a paid route that costs quota, and the run leaves a full effort trail
behind — a graph record, an audit entry, a response stream and a task result.
Measured on a real node: five files written, ~2.1s against ~0.4s for every other
diagnostic (ISS-104).

The name reads like the safest thing in the CLI, and an operator debugging a
broken node runs it repeatedly. So it says this here rather than leaving it to be
discovered in a bill.

For the cheap questions — is the runtime up, is a model configured, is a
credential present — use \`refarm check\`, \`refarm doctor\` or
\`refarm model doctor\`. None of them dispatches.
`,
		)
		.action(async function (this: Command) {
			const opts = this.opts<{ json?: boolean; timeout?: string }>();
			// The parent `agent` command also declares --json; commander may bind a trailing
			// `--json` to the parent, so honor it from either place.
			const parentJson = (this.parent?.opts() as { json?: boolean } | undefined)?.json === true;
			const json = opts.json === true || parentJson;
			const { probeAgentLiveness } = await import("./agent-liveness.js");
			const timeoutMs = opts.timeout ? Number(opts.timeout) : undefined;
			// SAID BEFORE IT HAPPENS, which is the only moment it can still be stopped. The help
			// text explains it to whoever goes looking; this reaches the operator who did not
			// (ISS-104). Human path only, and on stderr, so a `--json` consumer's stdout stays a
			// single parseable document.
			if (!json) {
				process.stderr.write(
					"agent probe dispatches a real prompt through the configured route — this spends " +
						"quota and writes an effort trail. `refarm check` and `refarm model doctor` do not.\n",
				);
			}
			const result = await probeAgentLiveness({ timeoutMs });
			if (json) {
				// `ok` says the PROBE ran, not that the agent is alive.
				//
				// It used to be `status === "responsive"`, so a zombie agent produced
				// `ok:false` with exit 0 — an envelope and an exit code that disagreed. The fix
				// is not to make it exit non-zero: `agent doctor`'s own outcome vocabulary
				// (`AgentLivenessStatus`) treats unresponsive, no-agent and runtime-unreachable
				// as VERDICTS it reaches, not as failures to reach one. The probe always
				// completes and always classifies, so it always did its job, and the verdict
				// lives in `status` where a consumer must read it deliberately.
				//
				// The narrow, scriptable "is the agent alive" gate is
				// `status === "responsive"` — one field, and nothing else changes meaning with
				// it. See `docs/NAMING_REGISTRY.md` § "`ok` semantics".
				printJson(
					buildJsonSuccessEnvelope({
						command: "agent",
						operation: "probe",
						nextAction: result.nextAction,
						extra: {
							status: result.status,
							responsive: result.status === "responsive",
							message: result.message,
							elapsedMs: result.elapsedMs,
							// STATED IN THE ENVELOPE, not only in the help text. A consumer that
							// schedules this — and the probe instrument that runs every command four
							// times per pass nearly did — must be able to read that the run had a
							// cost without knowing this command's history (ISS-104).
							dispatched: true,
						},
					}),
				);
				return;
			}
			const mark = result.status === "responsive" ? "✅" : "✗";
			console.log("Agent probe");
			console.log(`  ${mark} ${result.message}`);
			console.log(`  → ${result.nextAction}`);
		});

	// THE OLD NAME, KEPT WORKING. Nothing in this repository invokes `agent doctor` — measured —
	// but an operator's finger and a machine outside this tree are not searchable, and a rename
	// that silently stops answering is a worse trade than a word that lingers with a notice.
	//
	// A SEPARATE COMMAND rather than `.alias("doctor")`, because an alias cannot tell which name
	// was typed, and the notice is the entire point: the word `doctor` in this CLI means a read,
	// and whoever still types it here has to learn that this one does not.
	command
		.command("doctor", { hidden: true })
		.description("Deprecated alias for `agent probe` — DISPATCHES a real prompt")
		.option("--json", "Output machine-readable result")
		.option("--timeout <ms>", "How long to wait for the probe respond (ms)")
		.action(async function (this: Command) {
			const opts = this.opts<{ json?: boolean; timeout?: string }>();
			process.stderr.write(
				"`agent doctor` is now `agent probe`. Every other `doctor` in this CLI is a read; " +
					"this one dispatches, so it took a name that says so (ISS-104).\n",
			);
			// REBUILT FROM THE PARSED OPTIONS, not forwarded as `this.args`. Commander consumes a
			// declared option and its VALUE out of the remaining argv, so `--timeout 1234` reached
			// the shim and never left it — measured by the test next door, which is the whole
			// reason a compatibility shim gets one: an option silently dropped changes behaviour,
			// and that is the single thing this shim exists not to do.
			const argv: string[] = [];
			if (opts.json) argv.push("--json");
			if (opts.timeout) argv.push("--timeout", opts.timeout);
			const probe = command.commands.find((sub) => sub.name() === "probe");
			await probe?.parseAsync(argv, { from: "user" });
		});

	return command;
}

export const agentCommand = createAgentCommand();
