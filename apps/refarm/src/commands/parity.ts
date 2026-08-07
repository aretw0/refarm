// `refarm parity` — does the sandbox still look like the node it is supposed to mirror?
//
// The sandbox (`docs/superpowers/plans/2026-08-06-the-sandbox-node.md`) exists to isolate
// FOUR axes from the operator's real node: the sovereign dir, the graph, and the two ports.
// Isolating those four on purpose is not drift — reporting a fifth thing that silently
// diverged (a stale credential, a rebuilt-but-not-reinstalled plugin, a different model
// route) IS drift, and it is exactly the kind an isolated lab makes easy to miss, because
// nothing is watching the two nodes at once. "Isolation without parity trades one silent
// drift for another" (the plan's own words) — this command is the watching.
//
// DECLARED AXES, not free-form. `PARITY_AXES` below names exactly four things this command
// checks — configured model route, loaded plugin (with its hash), tractor engine mode,
// namespace — because those are what the brief names, and a growing ad-hoc list of "things
// that happened to differ today" is a worse instrument than a fixed, small one that a human
// can read in full.
//
// EVERY AXIS IS TAGGED, ONCE, AS ISOLATING OR NOT — `ISOLATING_AXES` is the ONE place that
// declares "this axis is SUPPOSED to differ". Namespace is the only `true`: it is one of the
// plan's four isolating axes (sovereign dir/graph/ports collapse to "namespace" here because
// the graph's own filename IS the namespace — `resolveTractorDbPath`, `../utils/tractor-
// store.ts`). The other three axes are configuration the sandbox is supposed to MIRROR, not
// isolate — Task 2 copied credentials specifically so the sandbox would resolve the SAME
// model route, and the sandbox is meant to run the SAME plugin build (or drift is worth
// knowing about immediately, not discovered mid-experiment). Because this table is static
// and lives in the pure core, a human never re-declares "namespace is allowed to differ" on
// every run — the declaration is made ONCE, here, and every comparison reads it.
//
// THIS IS THE FIRST INSTRUMENT IN THIS PLAN WHERE "DIFFERENT" CAN BE THE HEALTHY ANSWER. A
// `ParityFinding`'s `healthy` flag is computed FROM `isolating` and `verdict` together:
// healthy means "same" for a mirrored axis, "different" for an isolating one — NEVER just
// "verdict === same". This is deliberate and is what lets this command catch a bug the
// opposite instrument (`refarm context`) cannot: if the sandbox's namespace ever stopped
// diverging from the operator's (a regression in `sandboxEnvironment()`, say), THAT would be
// a `namespace` finding with `verdict: "same"` — and it is reported UNHEALTHY, not silently
// passed, because sharing a namespace means the graphs are not actually isolated.
//
// UNREADABLE IS NEVER HEALTHY, on any axis, regardless of `isolating`. A stopped sandbox
// (this file's own second required proof) must never present as "same" (nothing was
// compared) OR as "different" (nothing was compared, so no divergence was found either) —
// see `checkPlugin` below, which is where this matters most.
//
// THE TWO FAILURE SHAPES THIS SESSION FOUND THE HARD WAY, both on the plugin axis:
//
// 1. A plugin FILE present but not LOADED. Task 4's first attempt spent three code reviews
//    with `packages/agent/dist/plugin.json` sitting in the sandbox's plugin path — the
//    daemon refused it at boot (`missing field 'entry'`, a field only `refarm plugin
//    install` writes) and the sandbox could not serve a single request, while nothing that
//    only checked "does a file exist at the expected path" would have noticed. So `checkPlugin`
//    below never reads a file path or a manifest — it reads what the RUNNING daemon's own
//    sidecar reports loaded (`GET /plugins`, via `REFARM_SIDECAR_URL`), the same live signal
//    Task 4's re-run used to prove the fix (`plugin status --json` → `loaded: true`).
//
// 2. A record that cannot be attributed. The sandbox's graph carries no `SovereignConfig`
//    node, so its `BudgetObservation`s lack `host.name`/`refarm.workspace.id` (Task 4's
//    findings, `task-4-report.md` Step 5). That gap is judged OUT OF SCOPE for this command:
//    parity compares CONFIGURATION the two nodes are running with, not graph CONTENT they
//    have accumulated — a `BudgetObservation`'s shape is not one of "configured providers
//    and routes, installed plugins with their hashes, engine, namespace", the brief's actual
//    axis list. Recorded here, explicitly, rather than left for a reader to wonder whether it
//    was missed.
//
// NEVER A CREDENTIAL VALUE. The model-route axis compares `credential.state` (one of
// `CurrentModelStatus["credential"]["state"]`'s enum members — "silo-oauth", "missing", …)
// and never a token, an access key, or anything read out of `oauthCredentials`. See
// `safeModelRoute` below: it never returns anything from `tokens` except a `state` string and
// a route `ref` (a provider/model NAME, e.g. `"openai-codex/gpt-5.5"` — never a secret).
//
// PURE CORE, IMPURE EDGE — this file's own established shape (`context.ts`, `scope-
// doctor.ts`, `node-name-doctor.ts`). `buildParityReport` is pure; every test drives it with
// literal `ParityInput` fixtures. `resolveParityInput` is the only impure function and is
// exercised live, not unit-tested directly — the same accepted split `resolveContextInput`
// documents for itself.
//
// NEVER TOUCHES THE OPERATOR'S NODE. Every read here is a GET (the sidecar's `/plugins`) or a
// filesystem read (Silo identity, `config.json`) — nothing here writes, restarts, or signals
// either node. `resolveOperatorAddress` never guesses a pid to send a signal to; it only
// resolves paths and a URL.
//
// THE SANDBOX'S OWN RECIPE IS THE SOURCE OF TRUTH FOR HOW TO REACH IT. `sandboxEnvironment()`
// (`scripts/refarm-sandbox.mjs`) is documented there as "the canonical recipe for reaching
// the sandbox: any later script that needs to talk to it ... should import this rather than
// re-deriving the paths" — `resolveSandboxAddress` below does exactly that (a dynamic
// `import()`, since `scripts/` sits outside this package's own dependency graph), rather than
// re-typing SOVEREIGN_BASE/REFARM_HOME/ports as a second, driftable copy.
//
// NAMESPACE DOES NOT READ `/proc/<pid>/environ`. `refarm context` has a known, UNFIXED bug
// (recorded in this plan's own Task 4/5 briefs): the sandbox's `--namespace` is a CLI arg to
// `tractor`, never a `REFARM_NAMESPACE` env var, so a witness that reads the daemon's environ
// reports "not declared" and falls back to describing it as `"default"` — a false namespace
// match. This file sidesteps that bug entirely rather than repeating it: `resolveOperatorAddress`
// and `resolveSandboxAddress` each independently DECLARE their own side's namespace from what
// WE construct to reach that node (`resolveTractorNamespace` over an env object we built, or
// `sandboxEnvironment()`'s own returned `namespace`) — never a value read back off the
// daemon's own process state.

import { buildJsonSuccessEnvelope, printJson } from "@refarm.dev/capabilities/envelope";
import { findWorkspaceRoot, hasWorkspaceRootMarker, normalizePluginId } from "@refarm.dev/config";
import { RUNTIME_AGENT_PLUGIN_ID } from "@refarm.dev/config/plugin-identity";
import { fetchSidecarWithTimeout } from "@refarm.dev/sidecar-client";
import { resolveSiloHome, SiloCore } from "@refarm.dev/silo";
import chalk from "chalk";
import { Command } from "commander";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { resolveLoadedPlugin } from "../utils/loaded-plugin.js";
import { readNodeDescriptor } from "../utils/node-descriptor.js";
import { resolveRefarmHome } from "../utils/refarm-home.js";
import { resolveRuntimeSidecarUrl, resolveTractorEngineMode } from "../utils/runtime-config.js";
import { resolveTractorNamespace } from "../utils/tractor-store.js";
import { buildCurrentModelStatus, type ModelTokens } from "./model.js";
import { sidecarUrl } from "./sidecar-url.js";

// ---- Vocabulary ----------------------------------------------------------------------

export const PARITY_AXES = ["model-route", "plugin", "engine", "namespace"] as const;
export type ParityAxis = (typeof PARITY_AXES)[number];

export type ParityVerdict = "same" | "different" | "unreadable";

/** THE one static declaration of which axes the sandbox is SUPPOSED to isolate. `true`
 *  means "different" is the healthy verdict for this axis; everything else means "same" is.
 *  See this file's header for why only `namespace` is `true`. */
const ISOLATING_AXES: Record<ParityAxis, boolean> = {
	"model-route": false,
	plugin: false,
	engine: false,
	namespace: true,
};

export interface ParityFinding {
	axis: ParityAxis;
	/** Static, from `ISOLATING_AXES` — never inferred from what was actually observed. */
	isolating: boolean;
	verdict: ParityVerdict;
	/** The one field a caller who only wants the bottom line needs: "same" for a mirrored
	 *  axis, "different" for an isolating one, and NEVER true for "unreadable" — an axis
	 *  that could not be checked is never reported as fine. */
	healthy: boolean;
	/** Human-readable value/state for each side. Never a credential value — see this file's
	 *  header ("NEVER A CREDENTIAL VALUE"). */
	operator: string;
	sandbox: string;
	summary: string;
}

export interface ParityReport {
	findings: ParityFinding[];
	/** True only when every finding is healthy — one unreadable or undeclared-divergent
	 *  axis is enough to fail this, even if the other three are perfect. */
	healthy: boolean;
}

// ---- Per-node facts (what the impure edge gathers, and what the pure core compares) ---

/** What the RUNNING daemon's own sidecar says about the runtime agent plugin —
 *  `reachable: false` when the sidecar did not answer at all (the node may be stopped, or
 *  unreachable for any other reason) — a GAP in the check, not a "not loaded" finding. */
export type PluginRuntimeFact =
	| { reachable: false }
	| { reachable: true; loaded: boolean; /** `null` when the loaded plugin's bytes could not be hashed. */ hash: string | null };

export interface NodeParitySnapshot {
	label: "operator" | "sandbox";
	/** `null` only when this side's address could not be resolved at all (e.g. the sandbox's
	 *  own environment recipe, `scripts/refarm-sandbox.mjs`, could not be imported from
	 *  here) — never a guess standing in for "not declared". */
	namespace: string | null;
	/** `null` when the tractor engine mode could not be resolved for this side. */
	engine: string | null;
	/** `null` when the configured model route could not be resolved for this side (its
	 *  credential store could not be read). `credentialState` is one of
	 *  `CurrentModelStatus["credential"]["state"]`'s members — never a token. */
	modelRoute: { ref: string; credentialState: string } | null;
	plugin: PluginRuntimeFact;
}

export interface ParityInput {
	operator: NodeParitySnapshot;
	sandbox: NodeParitySnapshot;
}

// ---- Pure core -------------------------------------------------------------------------

function shortHash(sha: string): string {
	return sha.slice(0, 8);
}

function finding(
	axis: ParityAxis,
	verdict: ParityVerdict,
	operator: string,
	sandbox: string,
	summary: string,
): ParityFinding {
	const isolating = ISOLATING_AXES[axis];
	const healthy = verdict === "unreadable" ? false : isolating ? verdict === "different" : verdict === "same";
	return { axis, isolating, verdict, healthy, operator, sandbox, summary };
}

function unreadable(axis: ParityAxis, operator: string | null, sandbox: string | null, reason: string): ParityFinding {
	return finding(
		axis,
		"unreadable",
		operator ?? "(unknown)",
		sandbox ?? "(unknown)",
		`Could not compare ${axis} — ${reason}. Not "same", not "different": a gap in the check, ` +
			"never silently read as agreement and never as a mismatch.",
	);
}

function checkNamespace(input: ParityInput): ParityFinding {
	const { operator, sandbox } = input;
	if (operator.namespace === null || sandbox.namespace === null) {
		return unreadable(
			"namespace",
			operator.namespace,
			sandbox.namespace,
			"the sandbox's declared environment (scripts/refarm-sandbox.mjs's sandboxEnvironment()) could not be resolved from here",
		);
	}
	const verdict: ParityVerdict = operator.namespace === sandbox.namespace ? "same" : "different";
	const summary =
		verdict === "different"
			? `Namespace differs (operator "${operator.namespace}" vs sandbox "${sandbox.namespace}") — EXPECTED: ` +
				"namespace is one of the four axes the sandbox exists to isolate its graph on " +
				"(docs/superpowers/plans/2026-08-06-the-sandbox-node.md)."
			: `Both nodes declare namespace "${operator.namespace}" — UNEXPECTED and worth investigating: the sandbox ` +
				"is supposed to isolate its graph under a namespace of its own, and sharing one means that " +
				"isolation did not hold.";
	return finding("namespace", verdict, operator.namespace, sandbox.namespace, summary);
}

function checkEngine(input: ParityInput): ParityFinding {
	const { operator, sandbox } = input;
	if (operator.engine === null || sandbox.engine === null) {
		return unreadable(
			"engine",
			operator.engine,
			sandbox.engine,
			"the tractor engine mode could not be resolved for one or both sides",
		);
	}
	const verdict: ParityVerdict = operator.engine === sandbox.engine ? "same" : "different";
	const summary =
		verdict === "same"
			? `Both nodes resolve tractor engine mode to "${operator.engine}".`
			: `Tractor engine mode differs (operator "${operator.engine}" vs sandbox "${sandbox.engine}") — ` +
				"UNDECLARED: engine mode is not one of the sandbox's isolating axes, so this was not supposed to differ.";
	return finding("engine", verdict, operator.engine, sandbox.engine, summary);
}

function checkModelRoute(input: ParityInput): ParityFinding {
	const { operator, sandbox } = input;
	if (!operator.modelRoute || !sandbox.modelRoute) {
		return unreadable(
			"model-route",
			operator.modelRoute?.ref ?? null,
			sandbox.modelRoute?.ref ?? null,
			"the configured model route could not be resolved for one or both sides (its credential store could not be read)",
		);
	}
	const same =
		operator.modelRoute.ref === sandbox.modelRoute.ref &&
		operator.modelRoute.credentialState === sandbox.modelRoute.credentialState;
	const opLabel = `${operator.modelRoute.ref} (${operator.modelRoute.credentialState})`;
	const sbLabel = `${sandbox.modelRoute.ref} (${sandbox.modelRoute.credentialState})`;
	const summary = same
		? `Both nodes resolve the same model route (${operator.modelRoute.ref}) with the same credential ` +
			"state — the sandbox is inheriting the operator's credentials as designed (Task 2)."
		: `Configured model route differs (operator ${opLabel} vs sandbox ${sbLabel}) — UNDECLARED: the ` +
			"sandbox is supposed to inherit the SAME provider by copying credentials, so this was not supposed to differ.";
	return finding("model-route", same ? "same" : "different", opLabel, sbLabel, summary);
}

function describePluginFact(fact: Extract<PluginRuntimeFact, { reachable: true }>): string {
	if (!fact.loaded) return "not loaded";
	return fact.hash ? `loaded (${shortHash(fact.hash)})` : "loaded (hash unknown)";
}

/**
 * The plugin axis — see this file's header, "THE TWO FAILURE SHAPES". Order matters: an
 * unreachable sidecar is checked FIRST and wins outright (never let a downstream branch
 * quietly treat "could not ask" as "asked and got false"); then whether the RUNTIME actually
 * reports the agent loaded (failure shape 1); only once both sides confirm `loaded: true`
 * does this fall through to comparing bytes.
 */
function checkPlugin(input: ParityInput): ParityFinding {
	const { operator, sandbox } = input;

	if (!operator.plugin.reachable || !sandbox.plugin.reachable) {
		const who =
			!operator.plugin.reachable && !sandbox.plugin.reachable
				? "neither node's sidecar answered"
				: !operator.plugin.reachable
					? "the operator's sidecar did not answer"
					: "the sandbox's sidecar did not answer";
		return unreadable(
			"plugin",
			operator.plugin.reachable ? describePluginFact(operator.plugin) : null,
			sandbox.plugin.reachable ? describePluginFact(sandbox.plugin) : null,
			`${who} — a stopped node's plugin FILE proves nothing about what the daemon actually loaded`,
		);
	}

	if (!operator.plugin.loaded || !sandbox.plugin.loaded) {
		const who =
			!operator.plugin.loaded && !sandbox.plugin.loaded
				? "NEITHER node has it loaded"
				: !operator.plugin.loaded
					? "the operator's node does not have it loaded"
					: "the sandbox does not have it loaded";
		return finding(
			"plugin",
			"different",
			describePluginFact(operator.plugin),
			describePluginFact(sandbox.plugin),
			`The running daemon's own plugin status disagrees on whether the agent is actually loaded — ${who}. ` +
				"This is not one of the isolating axes: both nodes are expected to actually serve requests, and a " +
				"plugin FILE sitting in the right place is not the same claim as the daemon reporting it loaded.",
		);
	}

	if (!operator.plugin.hash || !sandbox.plugin.hash) {
		return unreadable(
			"plugin",
			describePluginFact(operator.plugin),
			describePluginFact(sandbox.plugin),
			"both nodes report the agent plugin loaded, but its hash could not be read on one or both sides",
		);
	}

	const same = operator.plugin.hash === sandbox.plugin.hash;
	const summary = same
		? `Both nodes have the agent plugin loaded with the same hash (${shortHash(operator.plugin.hash)}).`
		: `Both nodes have the agent plugin loaded, but the bytes differ (operator ${shortHash(operator.plugin.hash)} ` +
			`vs sandbox ${shortHash(sandbox.plugin.hash)}) — UNDECLARED: the sandbox is supposed to run the same ` +
			"build (Task 2's decision — the working tree's build), so this is worth reinstalling for.";
	return finding(
		"plugin",
		same ? "same" : "different",
		describePluginFact(operator.plugin),
		describePluginFact(sandbox.plugin),
		summary,
	);
}

/**
 * PURE. Compares an already-resolved `ParityInput` against `PARITY_AXES` and reports where
 * the two nodes agree, declared-diverge, undeclared-diverge, or could not be compared at
 * all. Every filesystem/network read happens before this is called — see
 * `resolveParityInput`.
 */
export function buildParityReport(input: ParityInput): ParityReport {
	const findings: ParityFinding[] = [
		checkModelRoute(input),
		checkPlugin(input),
		checkEngine(input),
		checkNamespace(input),
	];
	const healthy = findings.every((f) => f.healthy);
	return { findings, healthy };
}

// ---- Impure edge: every filesystem/network read the pure core above is fed. ------------

const PARITY_SIDECAR_TIMEOUT_MS = 3_000;

interface ParityNodeAddress {
	label: "operator" | "sandbox";
	refarmHome: string;
	siloIdentityPath: string;
	namespace: string;
	sidecarUrl: string;
}

interface SandboxEnvironmentResult {
	env: Record<string, string>;
	port: number;
	httpPort: number;
	namespace: string;
}

interface SandboxScriptModule {
	sandboxEnvironment(repoRoot: string): SandboxEnvironmentResult;
}

/**
 * `scripts/refarm-sandbox.mjs`'s own doc calls `sandboxEnvironment()` "the canonical recipe
 * for reaching the sandbox: any later script that needs to talk to it ... should import this
 * rather than re-deriving the paths" and names `refarm parity` explicitly. A dynamic
 * `import()` (not a static one) because `scripts/` sits outside this package's own `src/`
 * tree and dependency graph — `apps/refarm` is a publishable package, and this command only
 * makes sense run from inside this monorepo checkout in the first place (there is no sandbox
 * to compare against otherwise), the same posture `resolveBuiltPluginPath` in `context.ts`
 * already takes for the built-plugin path. Never throws: any failure here (no such file, a
 * script that fails to load) means "the sandbox's address is unknown", not a crashed command.
 */
async function importSandboxScript(repoRoot: string): Promise<SandboxScriptModule | null> {
	try {
		const scriptPath = path.join(repoRoot, "scripts", "refarm-sandbox.mjs");
		const mod = (await import(pathToFileURL(scriptPath).href)) as Partial<SandboxScriptModule>;
		return typeof mod.sandboxEnvironment === "function" ? (mod as SandboxScriptModule) : null;
	} catch {
		return null;
	}
}

async function resolveSandboxAddress(cwd: string): Promise<ParityNodeAddress | null> {
	const repoRoot = findWorkspaceRoot(cwd);
	if (!hasWorkspaceRootMarker(repoRoot)) return null;
	const mod = await importSandboxScript(repoRoot);
	if (!mod) return null;
	let result: SandboxEnvironmentResult;
	try {
		result = mod.sandboxEnvironment(repoRoot);
	} catch {
		return null;
	}
	const refarmHome = result.env.REFARM_HOME;
	const siloHome = result.env.SILO_HOME;
	if (!refarmHome || !siloHome) return null;
	return {
		label: "sandbox",
		refarmHome,
		siloIdentityPath: path.join(siloHome, "identity.json"),
		namespace: result.namespace,
		sidecarUrl: `http://127.0.0.1:${result.httpPort}`,
	};
}

function resolveOperatorAddress(env: NodeJS.ProcessEnv, cwd: string): ParityNodeAddress {
	return {
		label: "operator",
		refarmHome: resolveRefarmHome(env),
		siloIdentityPath: path.join(resolveSiloHome(env), "identity.json"),
		namespace: resolveTractorNamespace(env),
		sidecarUrl: resolveRuntimeSidecarUrl({ env, cwd }).value,
	};
}

function safeEngine(address: ParityNodeAddress, cwd: string): string | null {
	try {
		return resolveTractorEngineMode({ env: { REFARM_HOME: address.refarmHome }, cwd }).value;
	} catch {
		return null;
	}
}

async function safeModelRoute(
	address: ParityNodeAddress,
): Promise<{ ref: string; credentialState: string } | null> {
	try {
		const silo = new SiloCore({ storagePath: address.siloIdentityPath });
		const tokens = (await silo.loadTokens()) as ModelTokens;
		const status = buildCurrentModelStatus(tokens);
		return { ref: status.current.ref, credentialState: status.credential.state };
	} catch {
		return null;
	}
}

async function safePluginFact(address: ParityNodeAddress): Promise<PluginRuntimeFact> {
	try {
		const url = sidecarUrl("/plugins", { REFARM_SIDECAR_URL: address.sidecarUrl });
		const response = await fetchSidecarWithTimeout(url, {}, { timeoutMs: PARITY_SIDECAR_TIMEOUT_MS });
		if (!response.ok) return { reachable: false };
		const payload = (await response.json()) as { loaded?: unknown };
		const loadedIds = Array.isArray(payload.loaded)
			? payload.loaded.filter((id): id is string => typeof id === "string").map(normalizePluginId)
			: [];
		const loaded = loadedIds.includes(RUNTIME_AGENT_PLUGIN_ID);
		const descriptor = readNodeDescriptor(address.refarmHome);
		const hash = descriptor ? (resolveLoadedPlugin(descriptor.pid)?.sha256 ?? null) : null;
		return { reachable: true, loaded, hash };
	} catch {
		return { reachable: false };
	}
}

async function gatherNodeFacts(
	label: "operator" | "sandbox",
	address: ParityNodeAddress | null,
	cwd: string,
): Promise<NodeParitySnapshot> {
	if (!address) {
		return { label, namespace: null, engine: null, modelRoute: null, plugin: { reachable: false } };
	}
	const [engine, modelRoute, plugin] = await Promise.all([
		Promise.resolve(safeEngine(address, cwd)),
		safeModelRoute(address),
		safePluginFact(address),
	]);
	return { label, namespace: address.namespace, engine, modelRoute, plugin };
}

export async function resolveParityInput(
	cwd: string = process.cwd(),
	env: NodeJS.ProcessEnv = process.env,
): Promise<ParityInput> {
	const operatorAddress = resolveOperatorAddress(env, cwd);
	const sandboxAddress = await resolveSandboxAddress(cwd);
	const [operator, sandbox] = await Promise.all([
		gatherNodeFacts("operator", operatorAddress, cwd),
		gatherNodeFacts("sandbox", sandboxAddress, cwd),
	]);
	return { operator, sandbox };
}

// ---- Output --------------------------------------------------------------------------

function verdictColor(f: ParityFinding): (s: string) => string {
	if (!f.healthy) return chalk.red;
	return f.verdict === "different" ? chalk.cyan : chalk.green;
}

function printParityHuman(report: ParityReport): void {
	console.log(chalk.bold("\n  Refarm parity — sandbox vs operator\n"));
	for (const f of report.findings) {
		const tag = f.isolating ? "isolating" : "mirrored";
		console.log(`  ${verdictColor(f)(f.verdict.padEnd(11))} [${tag.padEnd(9)}] ${f.axis}`);
		console.log(`    operator: ${f.operator}`);
		console.log(`    sandbox : ${f.sandbox}`);
		console.log(`    ${f.summary}`);
		console.log();
	}
	if (report.healthy) {
		console.log(chalk.green("  Healthy — every mirrored axis matches, and namespace isolates as designed.\n"));
	} else {
		console.log(
			chalk.yellow(
				"  NOT healthy — see the finding(s) above marked unreadable or an undeclared divergence.\n",
			),
		);
	}
}

interface ParityCommandOptions {
	json?: boolean;
}

export function createParityCommand(): Command {
	return new Command("parity")
		.description("Compare the sandbox node against the operator's node on declared axes")
		.option("--json", "Output machine-readable JSON")
		.addHelpText(
			"after",
			`

Examples:
  $ refarm parity
  $ refarm parity --json

Notes:
  Read-only against both nodes — never restarts, stops, or signals either one.
  Namespace is the one axis EXPECTED to differ (the sandbox isolates its graph by design);
  the other three (model route, plugin, engine) are expected to MATCH — the sandbox is
  meant to mirror the operator's configuration, not diverge from it.
  A stopped sandbox reports "unreadable" on the plugin axis, never a false match.
`,
		)
		.action(async (options: ParityCommandOptions) => {
			const report = buildParityReport(await resolveParityInput());
			if (options.json) {
				printJson(
					buildJsonSuccessEnvelope({
						command: "parity",
						operation: "report",
						extra: { parity: report },
					}),
				);
				if (!report.healthy) process.exitCode = 1;
				return;
			}
			printParityHuman(report);
			if (!report.healthy) process.exitCode = 1;
		});
}

export const parityCommand = createParityCommand();
