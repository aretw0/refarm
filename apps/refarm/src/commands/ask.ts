import { buildJsonErrorEnvelope, printJson } from "@refarm.dev/capabilities/envelope";
import { quoteCommandArg } from "@refarm.dev/cli/command-handoff";
import { isRuntimeAgentPluginId, RUNTIME_AGENT_PLUGIN_ID } from "@refarm.dev/config";
import {
	buildSystemPrompt,
	ContextRegistry,
	CwdContextProvider,
	DateContextProvider,
	FilesContextProvider,
	GitStatusContextProvider,
	OperatorStateProvider,
	PolicyFilesContextProvider,
	SessionDigestContextProvider,
	type ContextProvider,
} from "@refarm.dev/context-provider-v1";
import type { Effort } from "@refarm.dev/effort-contract-v1";
import { fetchSidecarWithTimeout } from "@refarm.dev/sidecar-client";
import type { StreamChunk } from "@refarm.dev/stream-contract-v1";
import chalk from "chalk";
import { Command } from "commander";
import { refarmCommand } from "../brand.js";
import { MODEL_SCOPES, parseModelScope, type ModelScope } from "../model-routing.js";
import { RUNTIME_AUTOSTART_ENV_VAR } from "../utils/runtime-config.js";
import {
	observedAskContentError,
	printAskError,
	printAskErrorJson,
	printAskSuccessJson,
	printMissingModelCredentials,
	usageLine,
} from "./ask-errors.js";
import {
	currentSubscriptionRuntimeUnsupported,
	printSubscriptionRuntimeUnsupported,
} from "./ask-subscription.js";
import { MODEL_CURRENT_JSON_COMMAND, OPENAI_DEFAULT_REF } from "./credential-handoffs.js";
import { buildCurrentModelStatus, defaultModelDeps, resolveRuntimeModelRoute } from "./model.js";
import {
	PLUGIN_INSTALL_COMMAND,
	PLUGIN_INSTALL_JSON_COMMAND,
	RUNTIME_AGENT_RELOAD_JSON_COMMAND,
} from "./plugin-handoffs.js";
import { createRuntimeAgentRespondEffort } from "./runtime-agent-effort.js";
import {
	readRuntimePluginState,
	reloadRuntimePlugins,
	type RuntimePluginReloadResult,
	type RuntimePluginState,
} from "./runtime-plugins.js";
import {
	RUNTIME_AUTOSTART_ALWAYS_COMMAND,
	RUNTIME_AUTOSTART_NEVER_COMMAND,
	RUNTIME_DOCTOR_COMMAND,
	RUNTIME_DOCTOR_NEXT_COMMAND,
	RUNTIME_ENGINE_AUTO_COMMAND,
	RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
	RUNTIME_START_COMMAND,
	RUNTIME_START_WAIT_COMMAND,
} from "./runtime-recovery.js";
import {
	followStreamFile,
	readEffortAndSessionFallback,
	readEffortResultFile,
	readLatestAgentEntryFromSession,
	resolveRuntimeStreamsDir,
	resolveRuntimeTaskResultsDir,
} from "./runtime-stream.js";
import { isFullSessionId, resolveSessionIdPrefix } from "./session-ids.js";
import {
	autoStartFarmhand,
	checkSessionReadiness,
	defaultLaunchDeps,
	findRepoRoot,
	isRuntimeRunning,
	type LaunchDeps,
} from "./session-launch.js";
import {
	clearActiveSessionId,
	readActiveSessionId,
	writeActiveSessionIdAndVerify,
} from "./session-lock.js";
import { resolveSidecarUrlAsync, sidecarUrlAsync } from "./sidecar-url.js";

const SESSIONS_LIST_JSON_COMMAND = refarmCommand(["sessions", "list", "--json"]);

export {
	followStreamFile,
	readEffortResultFile,
	readLatestAgentEntryFromSession,
	resolveRuntimeStreamsDir,
	resolveRuntimeTaskResultsDir,
};

export interface AskDeps {
	submitEffort(effort: Effort): Promise<string>;
	followStream(
		effortId: string,
		onChunk: (chunk: StreamChunk) => void,
		options?: { timeoutMs?: number; submittedAtMs?: number },
	): Promise<void>;
	readEffortResult?(effortId: string): Promise<{
		status: "ok" | "error";
		content?: string;
		metadata?: Record<string, unknown>;
		error?: string;
	} | null>;
	readSessionFallback?(sessionId: string): Promise<{
		status: "ok";
		content: string;
		metadata?: Record<string, unknown>;
	} | null>;
	resolveSessionIdPrefix?(prefix: string): Promise<string>;
	readActiveSessionId?(): string | null;
	clearActiveSessionId?(): boolean;
	persistActiveSessionId?(id: string): void;
	readPluginState?(): Promise<RuntimePluginState | null>;
	reloadPlugins?(pluginIds: string[]): Promise<RuntimePluginReloadResult | null>;
	collectSystemPrompt?(request: { cwd: string; query: string; files: string[] }): Promise<string>;
}

interface SessionNode {
	"@id": string;
}

export interface AskJsonResult {
	effortId: string;
	sessionId: string;
	content: string;
	metadata?: Record<string, unknown>;
}

async function submitViaHttp(effort: Effort): Promise<string> {
	const response = await fetchSidecarWithTimeout(await sidecarUrlAsync("/efforts"), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(effort),
	});
	if (!response.ok) {
		throw new Error(`Runtime HTTP ${response.status}`);
	}
	const payload = (await response.json()) as { effortId: string };
	return payload.effortId;
}

function newSessionId(): string {
	return `urn:sovereign:session:v1:${crypto.randomUUID().replace(/-/g, "")}`;
}

function sourceForAskScope(
	scope: ModelScope,
): "refarm-ask" | "refarm-ask:worker" | "refarm-ask:monitor" {
	switch (scope) {
		case "default":
			return "refarm-ask";
		case "worker":
			return "refarm-ask:worker";
		case "monitor":
			return "refarm-ask:monitor";
	}
}

async function collectDefaultSystemPrompt(request: {
	cwd: string;
	query: string;
	files: string[];
}): Promise<string> {
	const providers: ContextProvider[] = [
		// Feed the resolved sidecar URL (env REFARM_SIDECAR_URL → home/cwd .refarm
		// config → replicated config graph node → default) instead of the provider's
		// hardcoded 42001, which ignored the env override and the config entirely.
		new SessionDigestContextProvider({
			sidecarUrl: await resolveSidecarUrlAsync(),
		}),
		new CwdContextProvider(),
		new PolicyFilesContextProvider(),
		new OperatorStateProvider(),
		new DateContextProvider(),
		new GitStatusContextProvider(),
		...(request.files.length > 0 ? [new FilesContextProvider(request.files)] : []),
	];

	const registry = new ContextRegistry(providers);
	const entries = await registry.collect({
		cwd: request.cwd,
		query: request.query,
	});
	return buildSystemPrompt(entries);
}

async function resolveSessionIdPrefixFromSidecar(prefix: string): Promise<string> {
	if (isFullSessionId(prefix)) return prefix;

	const response = await fetchSidecarWithTimeout(await sidecarUrlAsync("/sessions"));
	if (!response.ok) {
		throw new Error(`sidecar HTTP ${response.status}`);
	}
	const body = (await response.json()) as { sessions?: SessionNode[] };
	return resolveSessionIdPrefix(prefix, body.sessions ?? []);
}

function defaultDeps(): AskDeps {
	const streamsDir = resolveRuntimeStreamsDir();
	const resultsDir = resolveRuntimeTaskResultsDir();
	return {
		submitEffort: submitViaHttp,
		resolveSessionIdPrefix: resolveSessionIdPrefixFromSidecar,
		followStream: (effortId, onChunk, options) =>
			followStreamFile(
				streamsDir,
				effortId,
				onChunk,
				() => readEffortResultFile(resultsDir, effortId),
				options,
			),
		readEffortResult: (effortId) => readEffortResultFile(resultsDir, effortId),
		readSessionFallback: readLatestAgentEntryFromSession,
		readActiveSessionId,
		clearActiveSessionId,
		persistActiveSessionId: writeActiveSessionIdAndVerify,
		readPluginState: readRuntimePluginState,
		reloadPlugins: reloadRuntimePlugins,
	};
}

const DEFAULT_HISTORY_TURNS = 10;
const MODEL_SCOPE_HELP = MODEL_SCOPES.join(", ");

async function ensureAskRuntimeReady(launch: LaunchDeps, json = false): Promise<boolean> {
	let readiness = await checkSessionReadiness();

	const canPrompt = Boolean(process.stdin.isTTY && process.stdout.isTTY);
	if (!readiness.providerConfigured && canPrompt && launch.recoverProvider) {
		const recovered = await launch.recoverProvider();
		if (recovered) readiness = { ...readiness, providerConfigured: true };
	}

	if (!readiness.providerConfigured) {
		printMissingModelCredentials(json);
		return false;
	}

	if (!isRuntimeRunning(readiness)) {
		return autoStartFarmhand(findRepoRoot(), launch);
	}

	return true;
}

async function ensureAgentReady(
	readPluginState: (() => Promise<RuntimePluginState | null>) | undefined,
	reloadPlugins: ((pluginIds: string[]) => Promise<RuntimePluginReloadResult | null>) | undefined,
	json = false,
): Promise<boolean> {
	if (!readPluginState) return true;
	const state = await readPluginState();
	if (!state) return true;

	// Primary check: sidecar exposes the active agent by capability.
	if (typeof state.defaultResponder === "string" && state.defaultResponder.length > 0) return true;

	// Recovery: if a known agent plugin is installed, attempt reload.
	// Falls back to the bundled runtime agent plugin as the default installable agent.
	const reloadId = state.installed.find(isRuntimeAgentPluginId) ?? RUNTIME_AGENT_PLUGIN_ID;
	if (state.installed.some(isRuntimeAgentPluginId) && reloadPlugins) {
		const reload = await reloadPlugins([reloadId]);
		if (reload?.reloaded.length) return true;
		const refreshed = await readPluginState();
		if (typeof refreshed?.defaultResponder === "string" && refreshed.defaultResponder.length > 0)
			return true;
		if (json && reload?.skipped.length) {
			printJson(
				buildJsonErrorEnvelope({
					command: "ask",
					operation: "plugin-readiness",
					error: "agent-reload-failed",
					message: "Agent reload was requested but the runtime skipped it.",
					nextAction: RUNTIME_AGENT_RELOAD_JSON_COMMAND,
					nextActions: [
						RUNTIME_AGENT_RELOAD_JSON_COMMAND,
						RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
						RUNTIME_START_COMMAND,
						RUNTIME_DOCTOR_COMMAND,
					],
					nextCommand: RUNTIME_AGENT_RELOAD_JSON_COMMAND,
					nextCommands: [
						RUNTIME_AGENT_RELOAD_JSON_COMMAND,
						RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
						RUNTIME_DOCTOR_NEXT_COMMAND,
					],
					extra: {
						action: "ask",
						installed: true,
						reloaded: reload.reloaded,
						skipped: reload.skipped,
						deferred: reload.deferred,
						recommendations: [
							{
								diagnostic: "agent-reload-failed",
								severity: "failure",
								summary: "The runtime did not reload the agent.",
								action: "Inspect plugin status and retry agent reload.",
								command: RUNTIME_AGENT_RELOAD_JSON_COMMAND,
							},
						],
					},
				}),
			);
			return false;
		}
	}

	const agentInstalled = state.installed.some(isRuntimeAgentPluginId);
	if (json) {
		printJson(
			buildJsonErrorEnvelope({
				command: "ask",
				operation: "plugin-readiness",
				error: "agent-not-loaded",
				message: "No agent is loaded in the Refarm runtime.",
				nextAction: agentInstalled ? RUNTIME_AGENT_RELOAD_JSON_COMMAND : PLUGIN_INSTALL_COMMAND,
				nextActions: [
					...(agentInstalled ? [RUNTIME_AGENT_RELOAD_JSON_COMMAND] : [PLUGIN_INSTALL_COMMAND]),
					RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
					RUNTIME_START_COMMAND,
					RUNTIME_DOCTOR_COMMAND,
				],
				nextCommand: agentInstalled
					? RUNTIME_AGENT_RELOAD_JSON_COMMAND
					: PLUGIN_INSTALL_JSON_COMMAND,
				nextCommands: [
					...(agentInstalled ? [RUNTIME_AGENT_RELOAD_JSON_COMMAND] : [PLUGIN_INSTALL_JSON_COMMAND]),
					RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
					RUNTIME_START_WAIT_COMMAND,
					RUNTIME_DOCTOR_NEXT_COMMAND,
				],
				extra: {
					action: "ask",
					installed: agentInstalled,
					recommendations: [
						{
							diagnostic: "agent-not-loaded",
							severity: "failure",
							summary: "No agent plugin is loaded in the runtime.",
							action: "Install or reload an agent plugin, then ensure the runtime is ready.",
							command: agentInstalled
								? RUNTIME_AGENT_RELOAD_JSON_COMMAND
								: PLUGIN_INSTALL_JSON_COMMAND,
						},
					],
				},
			}),
		);
		return false;
	}
	console.error(chalk.red("\n✗  No agent is loaded in the Refarm runtime."));
	if (!agentInstalled) {
		console.error(chalk.dim("   Install bundled plugins:  refarm plugin install"));
	}
	console.error(
		chalk.dim(
			agentInstalled
				? "   Reload runtime plugins:   /reload agent (or /r agent)"
				: "   Reload runtime plugins:   /reload (or /r)",
		),
	);
	console.error(chalk.dim(`   Diagnose:                 ${RUNTIME_DOCTOR_COMMAND}`));
	return false;
}

export function createAskCommand(deps?: AskDeps, launchDeps?: LaunchDeps): Command {
	const resolved = deps ?? defaultDeps();
	const readActiveSession = resolved.readActiveSessionId ?? readActiveSessionId;
	const clearActiveSession = resolved.clearActiveSessionId ?? clearActiveSessionId;
	const persistActiveSession = resolved.persistActiveSessionId ?? writeActiveSessionIdAndVerify;

	return new Command("ask")
		.description("Ask the runtime agent with automatic project context")
		.argument("<query>", "Question or instruction for the runtime agent")
		.option("--files <files>", "Comma-separated file paths to include")
		.option("--new", "Start a fresh session, discarding conversation history")
		.option("--session <id>", "Use a specific session ID or unique prefix")
		.option("--scope <scope>", `Model route scope to use (${MODEL_SCOPE_HELP})`)
		.option("--json", "Output machine-readable ask result")
		.addHelpText(
			"after",
			`

	Examples:
  $ refarm ask "hello"
  $ refarm ask "hello" --json
  $ refarm ask "hello" --scope worker
  $ refarm ask "explain this package" --files README.md,package.json
  $ refarm ask "start fresh" --new

	Runtime:
  refarm ask uses the Refarm runtime. If credentials are configured and the
  runtime is stopped, refarm can start it before submitting the question.

  Configure credentials:  refarm sow
  Inspect model route:    refarm model current
  List model defaults:    refarm model providers
  Use worker route:       refarm ask "hello" --scope worker
  Switch default model:   refarm model ${OPENAI_DEFAULT_REF}
  Diagnose runtime:       ${RUNTIME_DOCTOR_COMMAND}
  Always autostart:       ${RUNTIME_AUTOSTART_ALWAYS_COMMAND}
  Disable autostart:      ${RUNTIME_AUTOSTART_NEVER_COMMAND}
  Select runtime engine:  ${RUNTIME_ENGINE_AUTO_COMMAND}
  One-shot override:      ${RUNTIME_AUTOSTART_ENV_VAR}=always refarm ask "hello"
	`,
		)
		.action(
			async (
				query: string,
				opts: {
					files?: string;
					new?: boolean;
					session?: string;
					scope?: string;
					json?: boolean;
				},
			) => {
				if (!deps || launchDeps) {
					const subscriptionUnsupported = await currentSubscriptionRuntimeUnsupported();
					if (subscriptionUnsupported) {
						printSubscriptionRuntimeUnsupported(subscriptionUnsupported, Boolean(opts.json));
						process.exitCode = 1;
						return;
					}
					const ready = await ensureAskRuntimeReady(
						launchDeps ?? defaultLaunchDeps(),
						Boolean(opts.json),
					);
					if (!ready) {
						process.exitCode = 1;
						return;
					}
					if (
						!(await ensureAgentReady(
							resolved.readPluginState,
							resolved.reloadPlugins,
							Boolean(opts.json),
						))
					) {
						process.exitCode = 1;
						return;
					}
				}

				if (opts.new && opts.session) {
					if (opts.json) {
						const recoveryCommand = refarmCommand([
							"ask",
							quoteCommandArg(query),
							"--new",
							"--json",
						]);
						printJson(
							buildJsonErrorEnvelope({
								command: "ask",
								operation: "options",
								error: "invalid-options",
								message: "--new and --session cannot be used together.",
								nextAction: recoveryCommand,
								nextActions: [recoveryCommand],
								nextCommand: recoveryCommand,
								nextCommands: [recoveryCommand],
								extra: { action: "ask" },
							}),
						);
						process.exitCode = 1;
						return;
					}
					console.error(chalk.red("\n✗  --new and --session cannot be used together."));
					process.exitCode = 1;
					return;
				}

				const modelScope = parseModelScope(opts.scope) ?? null;
				if (opts.scope && !modelScope) {
					const recoveryCommand = refarmCommand([
						"ask",
						quoteCommandArg(query),
						"--scope",
						"worker",
						...(opts.json ? ["--json"] : []),
					]);
					if (opts.json) {
						printJson(
							buildJsonErrorEnvelope({
								command: "ask",
								operation: "options",
								error: "invalid-model-scope",
								message: `Invalid model scope "${opts.scope}". Use: ${MODEL_SCOPE_HELP}.`,
								nextAction: recoveryCommand,
								nextActions: [recoveryCommand, MODEL_CURRENT_JSON_COMMAND],
								nextCommand: recoveryCommand,
								nextCommands: [recoveryCommand, MODEL_CURRENT_JSON_COMMAND],
								extra: {
									action: "ask",
									allowedScopes: MODEL_SCOPES,
								},
							}),
						);
						process.exitCode = 1;
						return;
					}
					console.error(
						chalk.red(`\n✗  Invalid model scope "${opts.scope}". Use: ${MODEL_SCOPE_HELP}.`),
					);
					console.error(chalk.dim(`   Inspect routes: ${MODEL_CURRENT_JSON_COMMAND}`));
					process.exitCode = 1;
					return;
				}
				const askScope = modelScope ?? "default";
				const routeStatus = buildCurrentModelStatus(await defaultModelDeps().loadTokens());
				const selectedRoute = resolveRuntimeModelRoute(routeStatus, askScope);

				if (opts.new) {
					clearActiveSession();
				}

				const explicitSession = opts.session?.trim();
				let sessionId = opts.new ? newSessionId() : (readActiveSession() ?? newSessionId());
				if (explicitSession && explicitSession.length > 0) {
					if (resolved.resolveSessionIdPrefix) {
						try {
							sessionId = await resolved.resolveSessionIdPrefix(explicitSession);
						} catch (error) {
							const message = error instanceof Error ? error.message : String(error);
							if (
								message.includes("No session matching") ||
								message.includes("Ambiguous session prefix")
							) {
								if (opts.json) {
									printJson(
										buildJsonErrorEnvelope({
											command: "ask",
											operation: "session-resolve",
											error: message.includes("Ambiguous session prefix")
												? "ambiguous-session-prefix"
												: "session-not-found",
											message,
											nextAction: SESSIONS_LIST_JSON_COMMAND,
											nextActions: [SESSIONS_LIST_JSON_COMMAND],
											nextCommand: SESSIONS_LIST_JSON_COMMAND,
											nextCommands: [SESSIONS_LIST_JSON_COMMAND],
											extra: { action: "ask" },
										}),
									);
									process.exitCode = 1;
									return;
								}
								console.error(chalk.red(`\n✗  ${message}`));
								console.error(chalk.dim("   Use: refarm sessions list  to inspect available IDs."));
							} else {
								printAskError(message);
							}
							process.exitCode = 1;
							return;
						}
					} else {
						sessionId = explicitSession;
					}
				}

				const files = opts.files
					? opts.files
							.split(",")
							.map((file) => file.trim())
							.filter(Boolean)
					: [];

				const system = await (resolved.collectSystemPrompt ?? collectDefaultSystemPrompt)({
					cwd: process.cwd(),
					query,
					files,
				});

				const effort = createRuntimeAgentRespondEffort({
					prompt: query,
					system,
					sessionId,
					source: sourceForAskScope(askScope),
					historyTurns: DEFAULT_HISTORY_TURNS,
					modelProvider: selectedRoute.modelProvider,
					modelId: selectedRoute.modelId,
				});

				if (!opts.json) {
					const scopeLabel = askScope === "default" ? "" : ` (${askScope})`;
					console.log(chalk.bold.cyan(`runtime agent${scopeLabel} ▸ ${query}\n`));
				}

				try {
					const submittedAtMs = Date.now();
					const effortId = await resolved.submitEffort(effort);
					let content = "";
					let metadata: Record<string, unknown> | undefined;

					try {
						await resolved.followStream(
							effortId,
							(chunk) => {
								// A chunk may be metadata/status-only (no `content`); only append + print
								// actual text. Writing `undefined` to stdout throws (ERR_INVALID_ARG_TYPE)
								// and `+= undefined` would inject the literal "undefined" into the answer.
								if (typeof chunk.content === "string") {
									content += chunk.content;
									if (!opts.json) {
										process.stdout.write(chunk.content);
									}
								}
								if (chunk.is_final) {
									if (!opts.json) {
										process.stdout.write("\n");
									}
									metadata = chunk.metadata as Record<string, unknown> | undefined;
									if (metadata && !opts.json) {
										console.log(chalk.gray(`\n${"─".repeat(41)}`));
										console.log(chalk.gray(usageLine(metadata)));
									}
								}
							},
							{ submittedAtMs },
						);
					} catch (streamError) {
						const fallback = await readEffortAndSessionFallback(effortId, sessionId, {
							readEffortResult: resolved.readEffortResult,
							readSessionFallback: resolved.readSessionFallback,
						});
						if (fallback?.status === "ok" && typeof fallback.content === "string") {
							content = fallback.content;
							metadata = fallback.metadata;
							const contentError = observedAskContentError(content);
							if (contentError) {
								throw new Error(contentError);
							}
							if (!opts.json) {
								process.stdout.write(`${fallback.content}\n`);
							}
							if (fallback.metadata && !opts.json) {
								console.log(chalk.gray(`\n${"─".repeat(41)}`));
								console.log(chalk.gray(usageLine(fallback.metadata)));
							}
							persistActiveSession(sessionId);
							if (opts.json) {
								const result: AskJsonResult = {
									effortId,
									sessionId,
									content,
									...(metadata ? { metadata } : {}),
								};
								printAskSuccessJson(result);
							}
							return;
						}

						if (fallback?.status === "error") {
							throw new Error(fallback.error ?? "Effort failed without details");
						}

						throw streamError;
					}

					const contentError = observedAskContentError(content);
					if (contentError) {
						throw new Error(contentError);
					}
					persistActiveSession(sessionId);
					if (opts.json) {
						const result: AskJsonResult = {
							effortId,
							sessionId,
							content,
							...(metadata ? { metadata } : {}),
						};
						printAskSuccessJson(result);
					}
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					if (opts.json) {
						printAskErrorJson(message);
					} else {
						printAskError(message);
					}
					process.exitCode = 1;
					return;
				}
			},
		);
}

export const askCommand = createAskCommand();
