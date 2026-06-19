import { Command } from "commander";
import {
	buildAgentFinishPlanEnvelope,
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
	buildCommandPlanRunEnvelope,
} from "./command-plan.js";
import {
	LOCAL_MODEL_JSON_COMMAND,
	MODEL_CURRENT_JSON_COMMAND,
	MODEL_DOCTOR_JSON_COMMAND,
	MODEL_PROVIDERS_JSON_COMMAND,
	OPENAI_DEFAULT_REF,
	RESUME_JSON_COMMAND,
	SOW_JSON_COMMAND,
} from "./credential-handoffs.js";
import { buildJsonSuccessEnvelope, printJson } from "./json-output.js";

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
					const envelope = buildCommandPlanRunEnvelope({
						action: "finish",
						command: "agent",
						operation: "finish",
					}, result);
					printJson({
						...envelope,
						...(result.ok ? {
							nextCommand: RESUME_JSON_COMMAND,
							nextCommands: [RESUME_JSON_COMMAND],
						} : {}),
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
