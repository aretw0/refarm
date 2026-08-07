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
// EVERY AXIS IS TAGGED, ONCE, AS ISOLATING OR NOT — `ISOLATING_AXES` is the DEFAULT
// declaration of "this axis is SUPPOSED to differ" (an operator can widen it per run — see
// "THE ESCAPE HATCH" below). Namespace is the only default `true`: it is one of the plan's
// four isolating axes (sovereign dir/graph/ports collapse to "namespace" here because the
// graph's own filename IS the namespace — `resolveTractorDbPath`, `../utils/tractor-
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
// THE TWO CRITICALS A REVIEW FOUND, both the SAME root shape: an axis reading a SHARED input
// for both "operator" and "sandbox" instead of observing each independently, which can
// MANUFACTURE agreement — precisely what this command exists to prevent.
//
// 1. ENGINE used to call `resolveTractorEngineMode({ env: { REFARM_HOME: address.refarmHome
//    }, cwd })` with the SAME `cwd` (the repo root) for both nodes. `resolveTractorEngineMode`
//    (`../utils/runtime-config.ts`) builds TWO config layers per call —
//    `[operatorConfigRoot/config.json, <cwd>/.refarm/config.json]` — and the underlying
//    resolver does not break on first match, so the LAST layer wins. That second layer,
//    `<cwd>/.refarm/config.json`, was IDENTICAL for both computations — a real file
//    (`<repo>/.refarm/config.json` exists in this checkout) that could silently overrule
//    either side's own home config and make two genuinely different engines report `same`.
//    FIX: `readTractorEngineMode` below reads EXACTLY ONE file, `<refarmHome>/config.json`,
//    per node — no second layer, and no env-var probe either (see its own doc for why an env
//    probe has the identical sharing problem, one level down).
//
// 2. MODEL-ROUTE used to call `buildCurrentModelStatus(tokens)` (`./model.ts`), which is
//    correctly fed a per-node TOKEN FILE but then hardcodes `process.env` throughout its own
//    body for every override it applies (`MODEL_PROVIDER`, `MODEL_BASE_URL`,
//    `MODEL_FALLBACK_PROVIDER`, …) — `process.env` is THIS CLI INVOCATION's ambient
//    environment, the same value regardless of which node's tokens were passed in, so an
//    override present in the shell running `refarm parity` would apply to BOTH sides
//    identically and a real per-node override difference would be invisible either way. FIX:
//    `resolveModelRouteFromTokens` below computes the route through the SAME lower-level,
//    already-per-node-parameterizable primitives `buildCurrentModelStatus` itself calls
//    (`effectiveModelRouteForScope`, `modelCredentialStatus`) but passes an EXPLICIT EMPTY
//    env to both, so neither side's "fact" can ever be contaminated by this process's own
//    environment. `model.ts` is untouched — no caller of `buildCurrentModelStatus` changes
//    behavior. This was the deliberate choice between the two options the review raised
//    (thread env through `model.ts`, or compute per-node in `parity.ts`): threading an env
//    parameter through `buildCurrentModelStatus` would touch a function with many existing
//    callers (`model current`, `check.ts`, `session-launch.ts`, …) for a change whose entire
//    value is scoped to this one command, and — more importantly — neither THIS CLI's
//    ambient env nor a reconstruction of either daemon's OWN launch env is a trustworthy
//    per-node signal anyway (this file already declined the equivalent move for `namespace`,
//    below), so there is nothing worth threading through in the first place. The honest
//    consequence, stated rather than hidden: an env-var override applied directly to a
//    daemon's own launch, without ALSO being reflected in its copied token file, is invisible
//    to this axis. See `resolveModelRouteFromTokens`'s own doc for the same point in place.
//
// Neither Critical was caught by the original 20 tests because they drove `buildParityReport`
// directly with literal snapshots — bypassing `safeEngine`/`safeModelRoute`/`resolveParityInput`
// entirely, so a shared-input bug in THOSE functions had nothing that could catch it.
// `readTractorEngineMode` and `resolveModelRouteFromTokens` are now exported specifically so a
// test can drive THEM with literals (an injectable `readFile` for the former, a stubbed
// `process.env` for the latter) and prove the sharing is gone — see `parity.test.ts`.
//
// OBSERVATION SOURCE, named per axis (`OBSERVATION_SOURCE`, and carried on every
// `ParityFinding` as `observedVia`). Only `plugin` asks either daemon anything at all (`GET
// /plugins` against its own sidecar) — `model-route` and `engine` are recomputed by this CLI
// from each side's own files, and `namespace` is DECLARED by this command from the launch
// recipe rather than read from anywhere at runtime (see below). This asymmetry is real and is
// exactly the mechanism Critical 1 exploited (a file-based axis sharing an input is a subtler
// bug than a network-based one, because there is no "unreachable" branch to fall into) — it is
// named on the output, not just in this comment, so a reader can tell which findings are a
// live daemon's own word and which are this CLI's inference from disk. Checked, not assumed:
// `packages/tractor/src/sidecar/mod.rs`'s full route table (`.route(...)`, ~`:1935-1989`) has
// no endpoint that reports a daemon's own configured model route or its engine mode —
// `/providers/liveness` only probes a CALLER-named provider's reachability, not the daemon's
// active route — so there is currently no way to move `model-route`/`engine` onto the
// "daemon" column without new host-side plumbing; recorded here rather than left unconsidered.
//
// THE ESCAPE HATCH — `--expect-divergence <axis>` (repeatable). `ISOLATING_AXES` is the
// DEFAULT, but an operator deliberately running the sandbox against a different model route
// (a common, legitimate reason to run a lab at all) would otherwise see "unhealthy" every
// time, indistinguishable from broken credential inheritance. `buildParityReport`'s second,
// optional argument accepts per-run overrides; each `ParityFinding` carries `isolatingSource:
// "default" | "override"` so the output itself says whether THIS run's tolerance was declared
// on the command line or is the file's own static default — never silently indistinguishable.
//
// NEVER A CREDENTIAL VALUE. The model-route axis compares `credential.state` (one of
// `CurrentModelStatus["credential"]["state"]`'s enum members — "silo-oauth", "missing", …)
// and never a token, an access key, or anything read out of `oauthCredentials`. See
// `resolveModelRouteFromTokens` below: it never returns anything from `tokens` except a
// `state` string and a route `ref` (a provider/model NAME, e.g. `"openai-codex/gpt-5.5"` —
// never a secret).
//
// PURE CORE, IMPURE EDGE — this file's own established shape (`context.ts`, `scope-
// doctor.ts`, `node-name-doctor.ts`). `buildParityReport`, `readTractorEngineMode` (given an
// injected `readFile`) and `resolveModelRouteFromTokens` are pure; every test drives them with
// literals. `resolveParityInput` is the only fully impure function and is exercised live, not
// unit-tested directly — the same accepted split `resolveContextInput` documents for itself.
//
// NEVER TOUCHES THE OPERATOR'S NODE. Every read here is a GET (the sidecar's `/plugins`) or a
// filesystem read (Silo identity, `config.json`) — nothing here writes, restarts, or signals
// either node. `resolveOperatorAddress` never guesses a pid to send a signal to; it only
// resolves paths and a URL, and (like `resolveSandboxAddress`) degrades to `null` rather than
// throwing if any of that resolution fails.
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

import { buildJsonErrorEnvelope, buildJsonSuccessEnvelope, printJson } from "@refarm.dev/capabilities/envelope";
import { findWorkspaceRoot, hasWorkspaceRootMarker, modelCredentialStatus, normalizePluginId } from "@refarm.dev/config";
import { RUNTIME_AGENT_PLUGIN_ID } from "@refarm.dev/config/plugin-identity";
import { fetchSidecarWithTimeout } from "@refarm.dev/sidecar-client";
import { resolveSiloHome, SiloCore } from "@refarm.dev/silo";
import chalk from "chalk";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { refarmCommand } from "../brand.js";
import { effectiveModelRouteForScope, formatModelRef } from "../model-routing.js";
import { resolveLoadedPlugin } from "../utils/loaded-plugin.js";
import { readNodeDescriptor } from "../utils/node-descriptor.js";
import { resolveRefarmHome } from "../utils/refarm-home.js";
import { parseTractorEngineMode, resolveRuntimeSidecarUrl } from "../utils/runtime-config.js";
import { resolveTractorNamespace } from "../utils/tractor-store.js";
import type { ModelTokens } from "./model.js";
import { sidecarUrl } from "./sidecar-url.js";

// ---- Vocabulary ----------------------------------------------------------------------

export const PARITY_AXES = ["model-route", "plugin", "engine", "namespace"] as const;
export type ParityAxis = (typeof PARITY_AXES)[number];

export type ParityVerdict = "same" | "different" | "unreadable";

/** How this axis's facts were obtained. `"daemon"` means a live sidecar answered (only
 *  `plugin`, today — see this file's header for why the others cannot, yet). `"config"`
 *  means a file on disk was read, per node. `"declared"` means this command computed the
 *  value itself from the launch recipe, consulting neither a file nor a live process
 *  (`namespace` only — see the header's `/proc/<pid>/environ` note). */
export type ParityObservationSource = "daemon" | "config" | "declared";

/** THE DEFAULT declaration of which axes the sandbox is SUPPOSED to isolate. `true` means
 *  "different" is the healthy verdict for this axis; everything else means "same" is. See
 *  this file's header for why only `namespace` is `true` by default, and "THE ESCAPE HATCH"
 *  for how an operator widens this per run. */
const ISOLATING_AXES: Record<ParityAxis, boolean> = {
	"model-route": false,
	plugin: false,
	engine: false,
	namespace: true,
};

const OBSERVATION_SOURCE: Record<ParityAxis, ParityObservationSource> = {
	"model-route": "config",
	plugin: "daemon",
	engine: "config",
	namespace: "declared",
};

/** Per-axis policy for one `buildParityReport` call — `isolating`'s resolved value (default
 *  or overridden) plus which one it was, so `ParityFinding.isolatingSource` can say so. */
interface AxisPolicy {
	isolating: boolean;
	isolatingSource: "default" | "override";
}

function resolveAxisPolicies(overrides: Partial<Record<ParityAxis, boolean>>): Record<ParityAxis, AxisPolicy> {
	const policies = {} as Record<ParityAxis, AxisPolicy>;
	for (const axis of PARITY_AXES) {
		const override = overrides[axis];
		policies[axis] =
			override === undefined
				? { isolating: ISOLATING_AXES[axis], isolatingSource: "default" }
				: { isolating: override, isolatingSource: "override" };
	}
	return policies;
}

export interface ParityFinding {
	axis: ParityAxis;
	/** This run's resolved value — default or overridden. Never inferred from what was
	 *  actually observed. */
	isolating: boolean;
	/** Whether `isolating` came from the static default table or from `--expect-divergence`
	 *  on this specific run. See "THE ESCAPE HATCH" in this file's header. */
	isolatingSource: "default" | "override";
	/** How this axis's facts were obtained — see `ParityObservationSource`'s own doc. */
	observedVia: ParityObservationSource;
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
	/** `null` when the tractor engine mode could not be resolved for this side. In practice
	 *  `readTractorEngineMode` never throws (an absent/malformed `config.json` resolves to
	 *  the documented default `"auto"`, matching `resolveTractorEngineMode`'s own precedent
	 *  for the same case) — this stays nullable for defensive symmetry with the other axes,
	 *  and so a literal-driven test can still exercise the `unreadable` branch. */
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
	policy: AxisPolicy,
): ParityFinding {
	const healthy =
		verdict === "unreadable" ? false : policy.isolating ? verdict === "different" : verdict === "same";
	return {
		axis,
		isolating: policy.isolating,
		isolatingSource: policy.isolatingSource,
		observedVia: OBSERVATION_SOURCE[axis],
		verdict,
		healthy,
		operator,
		sandbox,
		summary,
	};
}

function unreadable(
	axis: ParityAxis,
	operator: string | null,
	sandbox: string | null,
	reason: string,
	policy: AxisPolicy,
): ParityFinding {
	return finding(
		axis,
		"unreadable",
		operator ?? "(unknown)",
		sandbox ?? "(unknown)",
		`Could not compare ${axis} — ${reason}. Not "same", not "different": a gap in the check, ` +
			"never silently read as agreement and never as a mismatch.",
		policy,
	);
}

function checkNamespace(input: ParityInput, policy: AxisPolicy): ParityFinding {
	const { operator, sandbox } = input;
	if (operator.namespace === null || sandbox.namespace === null) {
		return unreadable(
			"namespace",
			operator.namespace,
			sandbox.namespace,
			"the sandbox's declared environment (scripts/refarm-sandbox.mjs's sandboxEnvironment()) could not be resolved from here",
			policy,
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
	return finding("namespace", verdict, operator.namespace, sandbox.namespace, summary, policy);
}

function checkEngine(input: ParityInput, policy: AxisPolicy): ParityFinding {
	const { operator, sandbox } = input;
	if (operator.engine === null || sandbox.engine === null) {
		return unreadable(
			"engine",
			operator.engine,
			sandbox.engine,
			"the tractor engine mode could not be resolved for one or both sides",
			policy,
		);
	}
	const verdict: ParityVerdict = operator.engine === sandbox.engine ? "same" : "different";
	const summary =
		verdict === "same"
			? `Both nodes resolve tractor engine mode to "${operator.engine}".`
			: `Tractor engine mode differs (operator "${operator.engine}" vs sandbox "${sandbox.engine}") — ` +
				"UNDECLARED: engine mode is not one of the sandbox's isolating axes, so this was not supposed to " +
				"differ. To close the gap deliberately, set it on the lagging side (`refarm config set " +
				"tractor.engine <value>`, run with THAT node's REFARM_HOME) so both declare the same value; if " +
				"this divergence is intentional, re-run with `--expect-divergence engine` to declare it instead.";
	return finding("engine", verdict, operator.engine, sandbox.engine, summary, policy);
}

function checkModelRoute(input: ParityInput, policy: AxisPolicy): ParityFinding {
	const { operator, sandbox } = input;
	if (!operator.modelRoute || !sandbox.modelRoute) {
		return unreadable(
			"model-route",
			operator.modelRoute?.ref ?? null,
			sandbox.modelRoute?.ref ?? null,
			"the configured model route could not be resolved for one or both sides (its credential store could not be read)",
			policy,
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
			"sandbox is supposed to inherit the SAME provider by copying credentials, so this was not supposed " +
			"to differ. Re-run `node scripts/refarm-sandbox.mjs start` to re-sync the sandbox's copied " +
			"credentials (it re-syncs on every start); if the sandbox is deliberately pointed at a different " +
			"provider, re-run with `--expect-divergence model-route` to declare it instead.";
	return finding("model-route", same ? "same" : "different", opLabel, sbLabel, summary, policy);
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
function checkPlugin(input: ParityInput, policy: AxisPolicy): ParityFinding {
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
			policy,
		);
	}

	// Both sidecars answered. Two distinct "not loaded" shapes, worded distinctly (a prior
	// review round caught this file saying the daemons "disagree" even in the case where
	// BOTH report not-loaded, which is agreement, not disagreement — the `different` verdict
	// was already correct for health, only the WORDING was wrong).
	if (!operator.plugin.loaded && !sandbox.plugin.loaded) {
		return finding(
			"plugin",
			"different",
			describePluginFact(operator.plugin),
			describePluginFact(sandbox.plugin),
			"Neither node has the agent plugin loaded (both report loaded:false from their own sidecar) — " +
				"this is not one of the isolating axes: both nodes are expected to actually serve requests.",
			policy,
		);
	}
	if (!operator.plugin.loaded || !sandbox.plugin.loaded) {
		const who = !operator.plugin.loaded ? "the operator's node" : "the sandbox";
		return finding(
			"plugin",
			"different",
			describePluginFact(operator.plugin),
			describePluginFact(sandbox.plugin),
			`The running daemons disagree on whether the agent is loaded — ${who} does not have it loaded. ` +
				"This is not one of the isolating axes: both nodes are expected to actually serve requests, and a " +
				"plugin FILE sitting in the right place is not the same claim as the daemon reporting it loaded.",
			policy,
		);
	}

	if (!operator.plugin.hash || !sandbox.plugin.hash) {
		return unreadable(
			"plugin",
			describePluginFact(operator.plugin),
			describePluginFact(sandbox.plugin),
			"both nodes report the agent plugin loaded, but its hash could not be read on one or both sides",
			policy,
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
		policy,
	);
}

export interface BuildParityReportOptions {
	/** THE ESCAPE HATCH — see this file's header. Per-axis override of `ISOLATING_AXES` for
	 *  this one call/run; an axis not named here keeps its default. */
	isolatingOverrides?: Partial<Record<ParityAxis, boolean>>;
}

/**
 * PURE. Compares an already-resolved `ParityInput` against `PARITY_AXES` and reports where
 * the two nodes agree, declared-diverge, undeclared-diverge, or could not be compared at
 * all. Every filesystem/network read happens before this is called — see
 * `resolveParityInput`.
 */
export function buildParityReport(input: ParityInput, options: BuildParityReportOptions = {}): ParityReport {
	const policies = resolveAxisPolicies(options.isolatingOverrides ?? {});
	const findings: ParityFinding[] = [
		checkModelRoute(input, policies["model-route"]),
		checkPlugin(input, policies.plugin),
		checkEngine(input, policies.engine),
		checkNamespace(input, policies.namespace),
	];
	const healthy = findings.every((f) => f.healthy);
	return { findings, healthy };
}

/**
 * PURE (given the default injected `readFile`, the only I/O this file does not itself
 * perform). Reads tractor engine mode from EXACTLY ONE file, `<refarmHome>/config.json`'s
 * `tractor.engine` — per node, never merged with a second layer. See this file's header,
 * "THE TWO CRITICALS", item 1: the previous version merged a `<cwd>/.refarm/config.json`
 * layer that was IDENTICAL for both nodes (same `cwd` passed to both calls), and the merge
 * resolver did not break on first match, so that shared file could silently overrule either
 * side's own home config.
 *
 * NO ENV-VAR PROBE, deliberately — `resolveTractorEngineMode`'s own `REFARM_TRACTOR_ENGINE`
 * env probe would have the IDENTICAL sharing problem one level down: this CLI's ambient
 * `process.env` is one value, not two, so an env override present when `refarm parity` runs
 * would apply to both sides' "facts" equally, exactly like Critical 2's `buildCurrentModelStatus`
 * bug. There is also no reliable way to read either DAEMON's own env instead (this file
 * already declines that for `namespace` — see the header's `/proc/<pid>/environ` note), so
 * this reads only what is genuinely per-node and durable: the file.
 *
 * Never throws: an absent or malformed `config.json` resolves to `"auto"`, matching
 * `resolveTractorEngineMode`'s own documented default for the same case (and `readConfig`'s
 * own established precedent of treating unreadable/malformed config as absent, not as an
 * error) — not a NEW, stricter behavior invented here.
 */
export function readTractorEngineMode(
	refarmHome: string,
	readFile: (filePath: string) => string = (p) => fs.readFileSync(p, "utf8"),
): string {
	try {
		const raw = readFile(path.join(refarmHome, "config.json"));
		const parsed = JSON.parse(raw) as { tractor?: { engine?: unknown } };
		return parseTractorEngineMode(parsed?.tractor?.engine) ?? "auto";
	} catch {
		return "auto";
	}
}

/**
 * PURE. The model route and credential STATE (never a value) that `tokens` ALONE resolves
 * to — deliberately WITHOUT consulting any environment variable. See this file's header,
 * "THE TWO CRITICALS", item 2, for why `buildCurrentModelStatus` (`./model.ts`) is not
 * reused directly: its body hardcodes `process.env`, which is this CLI invocation's own
 * ambient environment, identical for both nodes regardless of whose tokens were passed in.
 *
 * Reuses the SAME underlying primitives `buildCurrentModelStatus` itself calls
 * (`effectiveModelRouteForScope`, `modelCredentialStatus`) rather than re-deriving route
 * resolution a second time — only the `env` each is fed differs: an explicit `{}` here,
 * `process.env` there. `effectiveModelRouteForScope`'s own fallback (stored provider, else
 * `DEFAULT_MODEL_PROVIDER`) and `formatModelRef`'s own fallback (stored model id, else
 * `defaultModelForProvider`) already produce a complete, real route from `tokens` alone —
 * nothing here re-implements that.
 *
 * KNOWN LIMIT, stated rather than hidden: an env-var override applied directly to a
 * daemon's own launch (e.g. `MODEL_PROVIDER` exported into the shell that ran
 * `node scripts/refarm-sandbox.mjs start`), without ALSO being reflected in that node's
 * copied token file, is invisible to this axis — mirrors `readTractorEngineMode`'s and the
 * namespace axis's own stated limits for the identical reason.
 */
export function resolveModelRouteFromTokens(tokens: ModelTokens): { ref: string; credentialState: string } {
	const route = effectiveModelRouteForScope(tokens, "default", { env: {} });
	const ref = formatModelRef(route.provider, route.modelId);
	const credentialState = modelCredentialStatus(route.provider, tokens, {}).state;
	return { ref, credentialState };
}

/**
 * PURE. Splits `--expect-divergence` values into a validated override map and any names that
 * are not a real axis — exported so the CLI's validation is testable with literals rather
 * than only exercised by actually invoking the command.
 */
export function normalizeIsolatingOverrides(
	rawAxes: readonly string[],
): { overrides: Partial<Record<ParityAxis, boolean>>; invalid: string[] } {
	const overrides: Partial<Record<ParityAxis, boolean>> = {};
	const invalid: string[] = [];
	const known: readonly string[] = PARITY_AXES;
	for (const raw of rawAxes) {
		if (known.includes(raw)) {
			overrides[raw as ParityAxis] = true;
		} else {
			invalid.push(raw);
		}
	}
	return { overrides, invalid };
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

/** Symmetric with `resolveSandboxAddress`: degrades to `null` rather than throwing. Nothing
 *  here currently throws (plain path joins plus `resolveRuntimeSidecarUrl`'s own fs read,
 *  itself defensive), but leaving this unwrapped while its sibling is wrapped is a trap for
 *  whoever adds a throwing resolver later — a prior review round named this asymmetry. */
function resolveOperatorAddress(env: NodeJS.ProcessEnv, cwd: string): ParityNodeAddress | null {
	try {
		return {
			label: "operator",
			refarmHome: resolveRefarmHome(env),
			siloIdentityPath: path.join(resolveSiloHome(env), "identity.json"),
			namespace: resolveTractorNamespace(env),
			sidecarUrl: resolveRuntimeSidecarUrl({ env, cwd }).value,
		};
	} catch {
		return null;
	}
}

function safeEngine(address: ParityNodeAddress): string | null {
	try {
		return readTractorEngineMode(address.refarmHome);
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
		return resolveModelRouteFromTokens(tokens);
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
): Promise<NodeParitySnapshot> {
	if (!address) {
		return { label, namespace: null, engine: null, modelRoute: null, plugin: { reachable: false } };
	}
	const [engine, modelRoute, plugin] = await Promise.all([
		Promise.resolve(safeEngine(address)),
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
		gatherNodeFacts("operator", operatorAddress),
		gatherNodeFacts("sandbox", sandboxAddress),
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
		const declared = f.isolatingSource === "override" ? ", declared this run" : "";
		console.log(
			`  ${verdictColor(f)(f.verdict.padEnd(11))} [${tag}${declared}] ${f.axis}  (observed via ${f.observedVia})`,
		);
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
	expectDivergence?: string[];
}

export function createParityCommand(): Command {
	return new Command("parity")
		.description("Compare the sandbox node against the operator's node on declared axes")
		.option("--json", "Output machine-readable JSON")
		.option(
			"--expect-divergence <axis>",
			`Declare an axis as expected to diverge for THIS run (repeatable) — e.g. a deliberately ` +
				`different sandbox model route. One of: ${PARITY_AXES.join(", ")}.`,
			(value: string, previous: string[]) => [...previous, value],
			[] as string[],
		)
		.addHelpText(
			"after",
			`

Examples:
  $ refarm parity
  $ refarm parity --json
  $ refarm parity --expect-divergence model-route

Notes:
  Read-only against both nodes — never restarts, stops, or signals either one.
  Namespace is the one axis EXPECTED to differ by default (the sandbox isolates its graph by
  design); the other three (model route, plugin, engine) are expected to MATCH — the sandbox
  is meant to mirror the operator's configuration, not diverge from it. Use
  --expect-divergence to widen that default for a deliberate experiment.
  A stopped sandbox reports "unreadable" on the plugin axis, never a false match.
  Only the plugin axis asks either daemon anything directly; the others are recomputed by
  this CLI from each node's own files (see the "observed via" tag on each finding).
`,
		)
		.action(async (options: ParityCommandOptions) => {
			const { overrides, invalid } = normalizeIsolatingOverrides(options.expectDivergence ?? []);
			if (invalid.length > 0) {
				const retryCommand = refarmCommand(["parity", "--json"]);
				const message =
					`Unknown axis in --expect-divergence: ${invalid.join(", ")}. ` +
					`Valid axes: ${PARITY_AXES.join(", ")}.`;
				if (options.json) {
					printJson(
						buildJsonErrorEnvelope({
							command: "parity",
							operation: "report",
							error: "parity-invalid-axis",
							message,
							nextAction: retryCommand,
							nextCommand: retryCommand,
							nextCommands: [retryCommand],
						}),
					);
				} else {
					console.error(message);
				}
				process.exitCode = 2;
				return;
			}
			const report = buildParityReport(await resolveParityInput(), { isolatingOverrides: overrides });
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
