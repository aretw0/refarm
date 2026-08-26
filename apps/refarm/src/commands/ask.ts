import { buildJsonErrorEnvelope, printJson } from "@refarm.dev/capabilities/envelope";
import { quoteCommandArg } from "@refarm.dev/cli/command-handoff";
import {
	declaredBase,
	declaredWorkspacesFromConfig,
	isRuntimeAgentPluginId,
	loadConfig,
	RUNTIME_AGENT_PLUGIN_ID,
} from "@refarm.dev/config";
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
import { solePayerFor } from "@refarm.dev/model-account-contract-v1";

import nodeFsForAllowance from "node:fs";
import nodePathForAllowance from "node:path";

import { fetchSidecarWithTimeout } from "@refarm.dev/sidecar-client";
import type { StreamChunk } from "@refarm.dev/stream-contract-v1";
import chalk from "chalk";
import { Command } from "commander";
import { REFARM_BINARY, REFARM_PRODUCT_NAME, refarmCommand } from "../brand.js";
import {
	allowanceForDispatch,
	boundCredentialFor,
	readSpendForAllowance,
	refreshLiveCredentialsForDispatch,
} from "./ask-allowance.js";
import { credentialStaleness } from "./ask-credential-staleness.js";

import { readBindings, readCatalog } from "../credentials/account-view-loader.js";
import { MODEL_SCOPES, parseModelScope, type ModelScope } from "../model-routing.js";
import { resolveRefarmHome } from "../utils/refarm-home.js";
import { RUNTIME_AUTOSTART_ENV_VAR } from "../utils/runtime-config.js";
import {
	buildAskErrorPayload,
	observedAskContentError,
	printAskError,
	printAskErrorJson,
	printAskSuccessJson,
	printMissingModelCredentials,
	usageLine,
	type RefusedSeat,
} from "./ask-errors.js";
import {
	currentSubscriptionRuntimeUnsupported,
	printSubscriptionRuntimeUnsupported,
} from "./ask-subscription.js";
import { MODEL_CURRENT_JSON_COMMAND, OPENAI_DEFAULT_REF } from "./credential-handoffs.js";
import {
	buildCurrentModelStatus,
	defaultModelDeps,
	resolveRuntimeModelRoute,
	routeForBoundAccount,
} from "./model.js";
import {
	PLUGIN_INSTALL_COMMAND,
	PLUGIN_INSTALL_JSON_COMMAND,
	RUNTIME_AGENT_RELOAD_JSON_COMMAND,
} from "./plugin-handoffs.js";
import { createRuntimeAgentRespondEffort } from "./runtime-agent-effort.js";
import {
	readRuntimePluginState,
	reloadRuntimePlugins,
	requestedPluginIds,
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
	reconcileStreamMetadata,
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
import { resolveWorkspaceFromPath, type DeclaredRoot } from "./workspace-from-path.js";

const SESSIONS_LIST_JSON_COMMAND = refarmCommand(["sessions", "list", "--json"]);
const WORKSPACE_LIST_JSON_COMMAND = refarmCommand(["workspace", "list", "--json"]);

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
	/** `DeclaredRoot[]` from the config catalog. Injectable so tests never read the real
	 * `.refarm/config.json` — see `declaredWorkspaceRoots` for the production default. */
	declaredWorkspaceRoots?(): DeclaredRoot[];
	/** What the Session node already carries. Injectable so tests never hit the real sidecar
	 * over the network — see `readSessionWorkspace` for the production default. */
	readSessionWorkspace?(sessionId: string): Promise<SessionWorkspaceLookup | undefined>;
	}

	interface SessionNode {
	"@id": string;
	/** Absent (not null) on a session with no workspace attribution yet. */
	workspace_id?: string;
	workspace_source?: string;
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
		new OperatorStateProvider(REFARM_BINARY),
		new DateContextProvider(),
		new GitStatusContextProvider(),
		...(request.files.length > 0 ? [new FilesContextProvider(request.files)] : []),
	];

	const registry = new ContextRegistry(providers);
	const entries = await registry.collect({
		cwd: request.cwd,
		query: request.query,
	});
	return buildSystemPrompt(entries, { productName: REFARM_PRODUCT_NAME, binary: REFARM_BINARY });
	}

	/**
 * ONE snapshot of `/sessions` per invocation, shared by every reader of it.
 *
 * ISS-061: `--session <prefix>` made two round trips — `resolveSessionIdPrefixFromSidecar` to turn
 * the prefix into a full id, then `readSessionWorkspace` to read that session's declaration. The
 * wasted fetch is the small half. The real one is that they were two reads of a MOVING list: a
 * prefix resolved against one snapshot and a declaration read from another can, in principle,
 * disagree about which sessions exist — and the second read's `undefined` ("no declaration") would
 * then be indistinguishable from "that session was not in this snapshot".
 *
 * Scoped to the process because a CLI invocation is one act with one question. `resetSessionsSnapshotForTests`
 * exists so a test can state a second, different answer without a second process.
 */
	/** PURE-ish. Runs `work` at most once and hands every caller the SAME promise. Extracted from the
 *  snapshot below so the property that matters — one execution, one shared result — is provable
 *  without a network: a test can count executions of a plain function where it cannot easily count
 *  fetches through `sidecarUrlAsync`. Exported for that test only. */
	export function onceAsync<T>(work: () => Promise<T>): { run: () => Promise<T>; reset: () => void } {
	let pending: Promise<T> | null = null;
	return {
		run: () => (pending ??= work()),
		reset: () => {
			pending = null;
		},
	};
	}

	const sessionsSnapshot = onceAsync<SessionNode[] | null>(async () => {
	try {
		const response = await fetchSidecarWithTimeout(await sidecarUrlAsync("/sessions"));
		if (!response.ok) return null;
		const body = (await response.json()) as { sessions?: SessionNode[] };
		// A body that parses but carries no `sessions` array is a failed read, not an empty answer:
		// collapsing it would let the cwd seed fire and silently re-attribute a session whose
		// declaration simply could not be read.
		return Array.isArray(body.sessions) ? body.sessions : null;
	} catch {
		return null;
	}
	});

	export function resetSessionsSnapshotForTests(): void {
	sessionsSnapshot.reset();
	}

	/** `null` means the read FAILED — never an empty list, which is a successful read of a node with no
 *  sessions. Both callers below depend on that distinction.
 *
 *  Exported for ONE test: that two callers in the same invocation produce one fetch. The callers
 *  themselves stay internal — the property worth pinning is the shared snapshot, not their
 *  signatures. */
	export async function loadSessionsSnapshot(): Promise<SessionNode[] | null> {
	return sessionsSnapshot.run();
	}

	async function resolveSessionIdPrefixFromSidecar(prefix: string): Promise<string> {
	if (isFullSessionId(prefix)) return prefix;

	const sessions = await loadSessionsSnapshot();
	if (sessions === null) throw new Error("sidecar sessions could not be read");
	return resolveSessionIdPrefix(prefix, sessions);
	}

	/** `DeclaredRoot[]` built from the config catalog — the same `id`/`absolutePath` pair
 * `refarm workspace list --json` prints, reduced to what `resolveWorkspaceFromPath` needs.
 * Uses `declaredBase()` — the node's base (SOVEREIGN_BASE, else REFARM_HOME's parent, else
 * the OS home; never cwd) — the established way this CLI finds declarations. A different
 * value, and a different job, from the interactive cwd seed below. */
	function declaredWorkspaceRoots(): DeclaredRoot[] {
	const baseDir = declaredBase();
	return declaredWorkspacesFromConfig(loadConfig(baseDir), { baseDir })
		.filter((workspace): workspace is NonNullable<typeof workspace> => workspace != null)
		.map((workspace) => ({
			id: workspace.id,
			absolutePath: workspace.absolutePath,
		}));
	}

	/**
 * What `readSessionWorkspace` found, reduced to what the ladder needs to tell apart:
 * a declaration (`{ id, source }`), or `"unknown"` — the sidecar could not be asked, so
 * NOTHING may be inferred, least of all a cwd seed standing in for a fact that might
 * already be settled. `undefined` (the third, implicit state — see below) means the
 * query succeeded and genuinely found no declaration, which is a different fact from
 * `"unknown"` and must be told apart from it: collapsing "asked and got nothing" into
 * "could not ask" is exactly the silent re-attribution this ladder exists to prevent.
 */
	export type SessionWorkspaceLookup = { id: string; source: string } | "unknown";

	/**
 * What the Session node already carries, when it carries anything — or `"unknown"` when
 * the sidecar could not be asked at all (non-2xx, a thrown network/timeout error, a
 * response body that did not parse, or a body that parsed but carried no `sessions`
 * array). None of those failure shapes is "not declared": a session that already exists
 * but whose stored declaration could not be READ must read as unknown, never as absent,
 * or a transient sidecar hiccup would silently re-attribute an already-settled session
 * to wherever the operator happens to be standing today.
 *
 * `undefined` is reserved for a genuinely successful read that found no declaration — the
 * ordinary case for a session newly minted this run, which has nothing to read yet and is
 * expected to seed from cwd. `workspace_id`/`workspace_source` being ABSENT (not null) on
 * the node is what that successful-but-empty read looks like on the wire.
 */
	async function readSessionWorkspace(
	sessionId: string,
	): Promise<SessionWorkspaceLookup | undefined> {
	// Reads the SAME snapshot the prefix was resolved against (ISS-061) — `null` is the failed read
	// this function has always reported as "unknown", now decided in one place instead of two.
	const sessions = await loadSessionsSnapshot();
	if (sessions === null) return "unknown";
	const node = sessions.find((session) => session["@id"] === sessionId);
	if (!node?.workspace_id) return undefined;
	return {
		id: node.workspace_id,
		source: typeof node.workspace_source === "string" ? node.workspace_source : "seeded-from-cwd",
	};
	}

	export interface DispatchWorkspaceInput {
	/** `--workspace <id>`, already validated. */
	flag?: string;
	/**
	 * What the Session node already carries, when it carries anything — three states, not
	 * two: `{ id, source }` (a stored declaration, inherited), `"unknown"` (the sidecar could
	 * not be asked — read failure falls through to NO attribution, never to the cwd seed),
	 * or `undefined` (successfully asked, genuinely nothing declared — the normal case for a
	 * session newly minted this run, which still seeds from cwd exactly as before).
	 */
	sessionWorkspace?: SessionWorkspaceLookup;
	/**
	 * The directory a HUMAN was standing in, supplied only by the interactive CLI entry.
	 * Undefined for every other caller — a node opening a session for a Telegram thread has
	 * no directory worth consulting, and passing `process.cwd()` there would be the
	 * daemon-inherited read the 2026-08-03 field failure was made of.
	 */
	interactiveCwd?: string;
	roots: DeclaredRoot[];
	}

	/**
 * The four degrees, in order: explicit flag, the session's own declaration, a cwd seed at
 * a session's first dispatch, then nothing. cwd is absent from degrees 1 and 2 on purpose —
 * ADR-094's D2 keeps it out of the resolution order, and it enters here only as the
 * authoring convenience H2 permits, stamped so it can never be mistaken for a declaration.
 *
 * `sessionWorkspace: "unknown"` (a read failure, not a lookup) short-circuits to NO
 * attribution — it must NEVER fall through to the cwd seed, or a transient sidecar hiccup
 * on an already-attributed session would silently re-attribute it to wherever the operator
 * happens to be standing today. Only a confirmed empty read (`undefined`) — the ordinary
 * shape of a session that has nothing stored yet — reaches degree 3.
 */
	export function resolveDispatchWorkspace(input: DispatchWorkspaceInput): {
	workspaceId?: string;
	workspaceSource?: "declared" | "seeded-from-cwd";
	} {
	const flag = input.flag?.trim();
	if (flag) return { workspaceId: flag, workspaceSource: "declared" };

	const inherited = input.sessionWorkspace;
	if (inherited === "unknown") return {};
	if (inherited?.id) {
		return {
			workspaceId: inherited.id,
			workspaceSource: inherited.source === "declared" ? "declared" : "seeded-from-cwd",
		};
	}

	if (input.interactiveCwd) {
		const seeded = resolveWorkspaceFromPath(input.interactiveCwd, input.roots);
		if (seeded) return { workspaceId: seeded, workspaceSource: "seeded-from-cwd" };
	}

	return {};
	}

	/**
 * Validate `--workspace <id>` against the DECLARED catalog before it ever reaches
 * `resolveDispatchWorkspace` — an unchecked flag lets a typo (`--workspace rcdc`) land as
 * `workspaceSource: "declared"` on a phantom id that matches nothing, which is exactly the
 * silent wrong-attribution failure mode this whole feature exists to prevent.
 *
 * Same "absent means absent, parse once and reuse" contract and syntax rules as
 * `parseWorkspaceOption` (`./dispatch-capability.ts`) — trimmed, non-empty, no whitespace
 * or colon — plus the one check that command cannot make without a resolved catalog in
 * hand: the id must actually be declared, and the error names the ones that are.
 */
	export function validateWorkspaceFlag(
	flag: string | undefined,
	roots: DeclaredRoot[],
	): { workspaceId?: string } | { error: string } {
	if (flag === undefined) return {};
	const trimmed = flag.trim();
	if (trimmed.length === 0) {
		return { error: "--workspace must not be empty" };
	}
	if (/[\s:]/.test(trimmed)) {
		return {
			error: `--workspace must not contain whitespace or a colon, got ${JSON.stringify(flag)}`,
		};
	}
	if (!roots.some((root) => root.id === trimmed)) {
		const known = roots.map((root) => root.id).sort();
		const knownList = known.length > 0 ? known.join(", ") : "(none declared)";
		return { error: `--workspace "${trimmed}" is not declared. Declared workspaces: ${knownList}` };
	}
	return { workspaceId: trimmed };
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

	// Recovery: if the daemon was already handed a known agent plugin, attempt reload.
	// Falls back to the bundled runtime agent plugin as the default installable agent.
	const requestedIds = requestedPluginIds(state);
	const reloadId = requestedIds.find(isRuntimeAgentPluginId) ?? RUNTIME_AGENT_PLUGIN_ID;
	if (requestedIds.some(isRuntimeAgentPluginId) && reloadPlugins) {
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

	const agentInstalled = requestedPluginIds(state).some(isRuntimeAgentPluginId);
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
		.option(
			"--profile <profile>",
			"Route by a named model profile (cheap|balanced|reliable) instead of the pinned provider; the agent picks a configured provider for that intent",
		)
		.option(
			"--scenario <id>",
			"Declare which work this run is, so runs of the same work group in the record even across models (the derived hash keeps two models apart on purpose)",
		)
		.option(
			"--expect <text>",
			"Declare what the answer must contain, so the record can say the run was WRONG (substring match); the effort's outcome still reports only that it completed",
		)
		.option(
			"--workspace <id>",
			"Declare which workspace this run belongs to, so its cost separates from other projects'",
		)
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
					profile?: string;
					scenario?: string;
					expect?: string;
					workspace?: string;
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

				// Resolved once, validated once, reused both for the flag check below and for
				// the ladder at dispatch time — never re-read from config mid-command.
				const declaredRoots = (resolved.declaredWorkspaceRoots ?? declaredWorkspaceRoots)();
				const workspaceValidation = validateWorkspaceFlag(opts.workspace, declaredRoots);
				if ("error" in workspaceValidation) {
					if (opts.json) {
						printJson(
							buildJsonErrorEnvelope({
								command: "ask",
								operation: "options",
								error: "invalid-workspace",
								message: workspaceValidation.error,
								nextAction: WORKSPACE_LIST_JSON_COMMAND,
								nextActions: [WORKSPACE_LIST_JSON_COMMAND],
								nextCommand: WORKSPACE_LIST_JSON_COMMAND,
								nextCommands: [WORKSPACE_LIST_JSON_COMMAND],
								extra: { action: "ask" },
							}),
						);
						process.exitCode = 1;
						return;
					}
					console.error(chalk.red(`\n✗  ${workspaceValidation.error}`));
					console.error(
						chalk.dim(`   Inspect declared workspaces: ${WORKSPACE_LIST_JSON_COMMAND}`),
					);
					process.exitCode = 1;
					return;
				}

				const askScope = modelScope ?? "default";
				const routeStatus = buildCurrentModelStatus(await defaultModelDeps().loadTokens());
				const selectedRoute = resolveRuntimeModelRoute(routeStatus, askScope);

				// ADR-012: a named routing profile is the operator's intent to route BY
				// intent (cheap/balanced/reliable) rather than a pinned provider. The
				// --profile flag wins; otherwise an ambient MODEL_PROFILE applies. When a
				// profile is active we send it to the agent and OMIT the pinned route, so
				// the guest resolves the route by profile against its configured providers
				// (instead of the CLI shadowing it with an explicit override).
				const activeProfile = (opts.profile ?? process.env.MODEL_PROFILE)?.trim() || undefined;

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

				const sessionWorkspace = await (resolved.readSessionWorkspace ?? readSessionWorkspace)(
					sessionId,
				);
				const workspace = resolveDispatchWorkspace({
					flag: opts.workspace,
					sessionWorkspace,
					// The interactive entry, and only here, knows a human chose this directory.
					interactiveCwd: process.cwd(),
					roots: declaredRoots,
				});

				// THE BINDING DRIVES THE ROUTE (ISS-131), and it can only be applied once the
				// workspace is known — which is why it lives here and not beside `selectedRoute`.
				// Without it the dispatch carried the route's provider and the binding's account id
				// in the SAME message: measured on the operator's node, `modelProvider: openai-codex`
				// beside a github-copilot `credentialId`. The record would have named an account the
				// spend never touched, which is an attribution worse than none because it reads as
				// measured.
				const boundRoute = routeForBoundAccount(
					selectedRoute,
					boundAccountFor(workspace.workspaceId),
					askScope,
				);

				// STALENESS FIRST, because it explains a failure the operator would otherwise read
				// as a provider refusal. The host was handed this credential at boot and reads it
				// from its own process env; a renewed one never reaches it without a restart.
				const staleness = credentialStaleness(
					await boundCredentialFor(
						credentialIdForWorkspace(workspace.workspaceId, boundRoute.modelProvider),
					),
					Date.now(),
				);
				if (staleness.state === "expired") {
					// RENEW IN PLACE rather than refuse. The host prefers a credential FILE it
					// re-reads per dispatch, so a renewal reaches a live runtime without a restart —
					// and restarting to pick one up kills work in flight, which on a node serving a
					// phone and a PWA includes the operator's own work from somewhere else.
					const refreshed = await refreshLiveCredentialsForDispatch();
					if (refreshed.kind === "could-not-renew") {
						console.error(chalk.yellow(`refarm ask: ${refreshed.because}`));
					}
				}

				// THE GATE. Measured 2026-08-18: every ceiling that existed bounded a single
				// dispatch, and a shared seat went from 1706 remaining to zero across a month of
				// them. This is the only check that reads what the workspace ALREADY spent.
				//
				// It permits when nothing was declared, and permits-and-says-so when the record
				// could not be read: a node that refuses work because it cannot count is unusable
				// exactly when its runtime is down.
				const allowance = allowanceForDispatch(
					workspace.workspaceId,
					readNodeConfigForAllowance(),
					await readSpendForAllowance(),
					Date.now(),
					// What the WORKSPACE announces about itself — a baseline of what working on it
					// is expected to cost. It can only tighten: the node holds the grant, which is
					// `docs/CONFIG_TIERS.md`'s rule, and a repository that could widen its own
					// allowance would spend the operator's seat by being cloned.
					readWorkspaceConfigForAllowance(),
				);
				if (allowance.state === "exceeded") {
					console.error(chalk.yellow(`refarm ask: ${allowance.because}`));
					process.exitCode = 1;
					return;
				}
				if (allowance.state === "cannot-check") {
					console.error(chalk.dim(`refarm ask: ${allowance.because}`));
				}

				// WHICH SEAT PAYS THIS ATTEMPT. Held apart from the effort so a walk can rebuild the
				// effort for the next one — REBUILD, never spread: an effort carries a fresh `id`,
				// and two dispatches sharing one would collapse into a single observation.
				let seat = credentialIdForWorkspace(workspace.workspaceId, boundRoute.modelProvider);
				const effortInput = {
					prompt: query,
					system,
					sessionId,
					source: sourceForAskScope(askScope),
					historyTurns: DEFAULT_HISTORY_TURNS,
					// A profile routes by intent: send it and leave the route unpinned so
					// the guest's profile resolver chooses. Without a profile, pin the
					// scope's resolved provider/model as before.
					modelProvider: activeProfile ? undefined : boundRoute.modelProvider,
					modelId: activeProfile ? undefined : boundRoute.modelId,
					profile: activeProfile,
					// Declared, never invented: absent when the operator names none.
					scenarioId: opts.scenario,
					// Same discipline for WHETHER the answer was right — a fact the record
					// could not state at all until now, and one `refarm.outcome` was never
					// making: `done` means the run completed, not that it was correct.
					expectation: opts.expect,
					// The four-degree ladder: explicit flag, inherited session declaration, a
					// cwd seed, or nothing — never invented, never overridden by standing
					// somewhere else once a session already has one.
					workspaceId: workspace.workspaceId,
					workspaceSource: workspace.workspaceSource,
					// WHICH ACCOUNT PAYS, declared by the side that knows. The workspace->account
					// binding already decides this (757e1ee4); until now nothing recorded which
					// one it chose, so `refarm budget by-account` reported every observation as
					// unattributed (ISS-130). Resolved from the binding rather than from the
					// route, because the route names a provider and a provider is not an account.
					//
					// Absent when the workspace binds nothing AND the provider has more than one
					// usable seat — the field is omitted all the way to the host, and `by-account`
					// counts that as `unattributed`, which is then the true answer rather than a
					// gap. With a single seat the payer is determined and is recorded.
					credentialId: seat,
				};
				const effort = createRuntimeAgentRespondEffort(effortInput);

				if (!opts.json) {
					const scopeLabel = askScope === "default" ? "" : ` (${askScope})`;
					console.log(chalk.bold.cyan(`runtime agent${scopeLabel} ▸ ${query}\n`));
				}

				// THE DECLARED ORDER, WALKED ON A FACT (ISS-157).
				//
				// A provider refusing a seat for quota is evidence; falling to the next seat the
				// operator NAMED needs no prediction about which meter a model consumes — and
				// predicting it would skip a seat whose `chat` meter is unlimited and cross his
				// personal/corporate frontier for nothing.
				//
				// Only the seat changes. `credential bind` refuses an order that mixes providers, so
				// the route resolved above still describes every seat in this list.
				const triedSeats: string[] = [];
				let attemptEffort = effort;
				let emittedAnything = false;
				for (;;) {
					try {
						const submittedAtMs = Date.now();
						const effortId = await resolved.submitEffort(attemptEffort);
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
										emittedAnything = emittedAnything || chunk.content.length > 0;
										if (!opts.json) {
											process.stdout.write(chunk.content);
										}
									}
									if (chunk.is_final) {
										if (!opts.json) {
											process.stdout.write("\n");
										}
										metadata = chunk.metadata as Record<string, unknown> | undefined;
									}
								},
								{ submittedAtMs },
							);
							metadata = await reconcileStreamMetadata(
								effortId,
								metadata,
								resolved.readEffortResult,
							);
							if (metadata && !opts.json) {
								console.log(chalk.gray(`\n${"─".repeat(41)}`));
								console.log(chalk.gray(usageLine(metadata)));
							}
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
						break;
					} catch (err) {
						const message = err instanceof Error ? err.message : String(err);
						const spent = seat;
						const nextSeat =
							// ONLY on quota. Walking on any error would spend a second seat on a bug, twice.
							buildAskErrorPayload(message).error === "model-quota-exceeded" &&
							// AND only while nothing has reached the operator. A stream that printed text
							// and then failed cannot be retried — he would read one answer twice, spliced.
							!emittedAnything &&
							spent
								? credentialIdForWorkspace(workspace.workspaceId, boundRoute.modelProvider, [
										...triedSeats,
										spent,
									])
								: undefined;
						if (nextSeat && spent) {
							triedSeats.push(spent);
							seat = nextSeat;
							attemptEffort = createRuntimeAgentRespondEffort({
								...effortInput,
								credentialId: nextSeat,
							});
							if (!opts.json) {
								console.error(
									chalk.dim(
										`refarm ask: that seat is out of quota — falling to the next one you declared.`,
									),
								);
							}
							continue;
						}
						// ONE context, BOTH renderings. Computing it inside the human branch is HOW the
						// two surfaces diverged: the JSON one could not describe a walk it never
						// received, so it fell back to a payload about the route. Sharing the value
						// removes the shape of that defect, not just this instance of it.
						const refused = refusedSeatContext(
							workspace.workspaceId,
							boundRoute.modelProvider,
							[...triedSeats, ...(spent ? [spent] : [])],
						);
						if (opts.json) {
							printAskErrorJson(message, refused);
						} else {
							printAskError(message, refused);
						}
						process.exitCode = 1;
						return;
					}
				}
			},
		);
	}

	export const askCommand = createAskCommand();

	/** PURE-ish. The account a workspace's dispatch spends, from the node's DECLARED bindings.
 *
 * Reads the binding and nothing else. It deliberately does NOT fall back to "the only account on
 * this node": a node with one account today and two tomorrow would silently change which quota an
 * unbound workspace spent, and the record would carry both under one story. Unbound stays
 * unattributed, which `refarm budget by-account` already reports honestly.
 */
	/** PURE-ish. The DESCRIPTOR a workspace is bound to, when this node actually holds it.
 *
 * The catalog holds descriptors, never secrets, so this is a cheap synchronous read. Health is not
 * gated here on purpose: a binding to an unusable account must reach the resolver, which refuses
 * rather than quietly spending a different one (ISS-131). Suppressing it here would restore exactly
 * the silent substitution that item is about.
 */
	function boundAccountFor(workspaceId: string | undefined): { provider: string } | undefined {
	if (!workspaceId) return undefined;
	try {
		const home = resolveRefarmHome();
		const binding = readBindings(home).find((b) => b.workspaceId === workspaceId);
		if (!binding) return undefined;
		return readCatalog(home).find((a) => a.credentialId === binding.credentialId);
	} catch {
		return undefined;
	}
	}

	/**
 * Which seat pays for this dispatch.
 *
 * A DECLARED binding wins — the operator naming a seat for a workspace is the whole point of
 * the binding. When nobody declared one, the seat is still knowable if the provider has
 * exactly one usable account on this node, and that case is worth recovering: measured
 * 2026-08-18, 36 of 57 observations named no payer, 34 of them on a provider this node holds
 * a single account of. They spent a real seat and the record said nobody did.
 *
 * With two seats and no binding it REFUSES. Nothing here knows which one the host chose, and
 * naming either would attribute spend to a seat that may not have paid.
 */
	/**
 * What the refusal path knows about the seats it just spent, from a LOCAL read.
 *
 * ISS-157. The dispatch lived the walk, so the seats and the walk's outcome cost nothing to
 * report; the catalog turns opaque ids into the aliases the operator declared them under. No
 * provider is asked — `credential quota` is the surface for that, and asking here would put a
 * request on a failure path.
 *
 * A CATALOG THAT CANNOT BE READ YIELDS NO SEAT, never an invented one: the refusal then carries
 * the command and nothing else, which is the same honest absence `credentialIdForWorkspace`
 * returns from the same failure.
 */
	function refusedSeatContext(
	workspaceId: string | undefined,
	provider: string | undefined,
	tried: readonly string[],
	): { provider: string | undefined; tried: RefusedSeat[]; declaredExhausted: boolean } {
	try {
		const home = resolveRefarmHome();
		const catalog = readCatalog(home);
		const aliasOf = (credentialId: string) =>
			catalog.find((entry) => entry.credentialId === credentialId)?.alias ?? credentialId;
		const declared = workspaceId
			? readBindings(home)
					.filter((b) => b.workspaceId === workspaceId)
					.map((b) => b.credentialId)
			: [];
		return {
			provider,
			tried: tried.map((credentialId) => ({ credentialId, alias: aliasOf(credentialId) })),
			// EXHAUSTED means a declaration existed and every seat in it was tried. With none
			// declared there is nothing to have run out of, and saying so would describe a choice
			// the operator never made.
			declaredExhausted: declared.length > 0 && declared.every((id) => tried.includes(id)),
		};
	} catch {
		return { provider, tried: [], declaredExhausted: false };
	}
	}

	function credentialIdForWorkspace(
	workspaceId: string | undefined,
	provider?: string,
	tried: readonly string[] = [],
	): string | undefined {
	try {
		const home = resolveRefarmHome();
		// EVERY seat this workspace declared, IN ORDER (ISS-157). With nothing tried this returns
		// the first, which is what the single `.find` here always returned — so a node that
		// declared one seat reads identically.
		const declared = workspaceId
			? readBindings(home)
					.filter((b) => b.workspaceId === workspaceId)
					.map((b) => b.credentialId)
			: [];
		const next = declared.find((id) => !tried.includes(id));
		if (next) return next;
		// A DECLARED LIST IS EXCLUSIVE. Having exhausted it, there is nothing left to spend —
		// falling through to the sole payer here would spend an account the operator never named,
		// which is the silent substitution the resolver's doctrine exists to prevent.
		if (declared.length > 0) return undefined;
		if (!provider) return undefined;
		const sole = solePayerFor(provider, readCatalog(home))?.credentialId;
		return sole && !tried.includes(sole) ? sole : undefined;
	} catch {
		// A catalog or binding that cannot be read must not stop a dispatch. The observation then
		// records no payer, which is the same honest absence an ambiguous provider produces.
		return undefined;
	}
	}

	/** The WORKSPACE's own config, where it may ANNOUNCE a baseline. Read from where the operator is
 *  standing, and never trusted to widen anything — see `effectiveAllowances`. */
	function readWorkspaceConfigForAllowance(): unknown {
	try {
		return JSON.parse(
			nodeFsForAllowance.readFileSync(
				nodePathForAllowance.join(process.cwd(), ".refarm", "config.json"),
				"utf-8",
			),
		);
	} catch {
		return {};
	}
	}

	/** The node-tier config the allowance is declared in, read without throwing: a dispatch must not
 *  die on a config typo, and an unreadable config declares no allowance, which permits. */
	function readNodeConfigForAllowance(): unknown {
	try {
		return JSON.parse(
			nodeFsForAllowance.readFileSync(
				nodePathForAllowance.join(resolveRefarmHome(), "config.json"),
				"utf-8",
			),
		);
	} catch {
		return {};
	}
	}
