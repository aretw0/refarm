// `refarm context` — the whole resolved sovereign state, in one place.
//
// This exists because of a measured failure on 2026-08-05: three agents and a controller
// each formed a wrong picture of which artifact the running node was actually serving,
// because nothing in Refarm would say. Four locations held the agent plugin, three
// distinct binaries among them, and `refarm doctor` answered ok with zero findings the
// whole time. Task 1 built the witness (read the running process's own `--plugin` and
// hash it — `../utils/loaded-plugin.ts`) and Task 2 repaired the freshness check that had
// been comparing against a reconstructed path instead. This command is the cockpit: it
// reads what those two already know, plus what `../utils/context-metadata.ts` already
// computes about mode/home/credential alignment, and reports it as one shape.
//
// DOES NOT INVENT A SECOND VOCABULARY. `resolveNodeContextMetadata` already answers "what
// mode is this node in" (`mode: "node" | "workspace"`) and "how was the home chosen"
// (`binding.origin: "explicit" | "default"`) — those values are carried here verbatim
// under `metadata`, not renamed or re-derived. Only what it does NOT carry is added: the
// running node's own identity, the loaded plugin and its hash, the plugin a fresh build
// would produce, the storage namespace (`resolveTractorNamespace`), the runtime endpoint
// (`resolveRuntimeSidecarUrl`), and other sovereign directories sitting unloaded on disk.
//
// THREE STATES, never two, for BOTH halves of the plugin comparison — a review round
// found the builder applied this correctly to the loaded side (`sha256 === null` →
// `plugin-hash-unknown`) but silently dropped the comparison whenever the BUILT side could
// not be resolved (`input.builtPluginSha &&` guard), which is the same two-states-where-
// three-belong mistake this whole plan exists to undo, just on the other side of the
// comparison. An unresolvable or unreadable built plugin is `built-plugin-unknown` — never
// silence, never counted as a match. A node that is not running at all is
// `node-not-running` and yields NO plugin verdict — not a false "clean" from comparing two
// nulls into silence.
//
// NEVER FABRICATES A PATH. `findWorkspaceRoot` (`@refarm.dev/config`) falls back to `cwd`
// when it climbs to the filesystem root without finding a real monorepo marker — for a
// `mode: node` install, standing outside the repository is the NORMAL case, so that
// fallback fires on every ordinary operator machine. `resolveBuiltPluginPath` below checks
// for a real marker before trusting that root; without one, `builtPluginPath` is `null`,
// not a path assembled under a directory that was never actually the monorepo.
//
// NEVER RESTARTS, NEVER WRITES. This command reads and reports; restarting a node so it
// picks up a different plugin is the operator's decision, exactly as `runtime-freshness-
// doctor.ts` says of the freshness check it renders. No divergence here carries an
// `action` that performs anything.
//
// ONE NAME PER FACT. The sovereign home disagreeing with the credential home is the exact
// same predicate `context-doctor.ts` already reports as `context:home-divergence` — this
// module derives its divergence kind from that exported constant rather than keeping the
// second name (`credential-home-divergence`) an earlier draft invented for the identical
// check. The report-vs-diagnostic split stays legitimate (doctor's finding carries
// `action`/`command`; this one carries neither), only the NAME is now shared.
//
// PURE CORE, IMPURE EDGE — the established shape of every doctor finding in this
// codebase (`scope-doctor.ts`, `node-name-doctor.ts`, `runtime-freshness-doctor.ts`):
// `buildContextReport` is pure and every test drives it with literals; the filesystem and
// process reads live in `resolveContextInput` below, exercised only by running the command.
//
// THE `base:`/`namespace:` DEFECT (a second, later plan — 2026-08-06, "the node answers
// for itself"): reproduced live — `refarm context` invoked from `~/git/rcdc5` printed a
// `base:` line sitting directly above the `node:` line, reading as the RUNNING NODE's, but
// it was this CLI INVOCATION's own `declaredBase()` result the whole time. Same idiom as the
// plugin-hash fix above, one level up: `resolveNodeEnvironment` (`../utils/node-environment
// .ts`) reads the node's OWN `/proc/<pid>/environ` instead of reconstructing a value from
// this CLI's `process.env`, and the report's `base`/`namespace` lines now show what THAT
// reads, not `cliBase`/`cliNamespace` — which stay in the report as a second, clearly
// labelled fact, never presented as the node's. Same three-states discipline as the plugin
// comparison: a running node whose environ could not be read is `node-environment-unknown`,
// never silently collapsed into comparing the CLI's own values against themselves and
// reporting agreement, and never a `base-divergence` (nothing is actually known to differ).

import { buildJsonSuccessEnvelope, printJson } from "@refarm.dev/capabilities/envelope";
import {
	declaredBase,
	findWorkspaceRoot,
	hasWorkspaceRootMarker,
	SOVEREIGN_BASE_KEY,
} from "@refarm.dev/config";
import chalk from "chalk";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";

import type { NodeContextMetadata } from "../utils/context-metadata.js";
import { resolveNodeContextMetadata } from "../utils/context-metadata.js";
import { defaultHashFile, resolveLoadedPlugin, type LoadedPlugin } from "../utils/loaded-plugin.js";
import { readNodeDescriptor } from "../utils/node-descriptor.js";
import { resolveNodeEnvironment, type NodeEnvironment } from "../utils/node-environment.js";
import { resolveRefarmHome } from "../utils/refarm-home.js";
import { resolveRuntimeSidecarUrl } from "../utils/runtime-config.js";
import { resolveTractorNamespace } from "../utils/tractor-store.js";
import { CONTEXT_HOME_DIVERGENCE_DIAGNOSTIC } from "./context-doctor.js";

/** The running node's own identity, as `node.json` states it — a narrow projection of
 *  `NodeDescriptor` (`../utils/node-descriptor.ts`), kept small so a test can express "a
 *  node is running" with a literal rather than the full descriptor shape. `null` means no
 *  running node was found (absent descriptor, dead pid, unreadable file) — see
 *  `readNodeDescriptor`'s own contract for what collapses to that. */
export interface ContextNode {
	name?: string;
	id?: string;
	pid: number;
	startedAt: string;
}

export type DivergenceKind =
	| "plugin-hash-mismatch"
	| "plugin-hash-unknown"
	| "built-plugin-unknown"
	| "unloaded-sovereign-dir"
	| "node-not-running"
	// The defect this task closes: `base:`/`namespace:` used to report the CLI's OWN
	// resolved values as if they were the running node's. These three name what a direct
	// comparison against the node's own witness (`resolveNodeEnvironment`, Task 1) can now
	// find: the node's declared (or fallen-back) base disagreeing with the CLI's, the same
	// for namespace, and the node being up but its environ unreadable — a GAP in the
	// checking, never silently read as either agreement or a base divergence (see
	// `buildContextReport`'s node-environment block).
	| "base-divergence"
	| "namespace-divergence"
	| "node-environment-unknown"
	| typeof CONTEXT_HOME_DIVERGENCE_DIAGNOSTIC;

export interface Divergence {
	kind: DivergenceKind;
	/** Names both sides with their hashes/paths where there are two sides to name.
	 *  Never an `action` — this command never restarts and never writes. */
	summary: string;
}

/** What the impure edge resolved, before any comparison happens. */
export interface ContextInput {
	/** Reused verbatim from `resolveNodeContextMetadata` — mode, how the home was chosen,
	 *  the sovereign/credential homes, and whether they align. Not re-derived here. */
	metadata: NodeContextMetadata;
	/** What `declaredBase()` (`@refarm.dev/config`) resolves for THIS CLI INVOCATION — where
	 *  declarations are read against, independent of where credentials/plugins live. This is
	 *  NOT the running node's own base; it is kept as a clearly labelled second fact,
	 *  precisely because it used to be reported as if it were the node's (the defect this
	 *  task closes — see `nodeEnvironment.base` and `base-divergence` below). */
	cliBase: string;
	/** Whether `cliBase` came from the explicit `SOVEREIGN_BASE` env var this CLI process
	 *  sees, or fell back to this CLI's own cwd. Same CLI/node split as `cliBase` itself. */
	cliBaseOrigin: "SOVEREIGN_BASE" | "cwd";
	/** The storage namespace THIS CLI INVOCATION resolves — `resolveTractorNamespace`
	 *  (`../utils/tractor-store.ts`): `REFARM_NAMESPACE` else `"default"`. Surfaced here as a
	 *  clearly labelled CLI-side fact; `nodeEnvironment.namespace` is what the running node
	 *  itself declares, and the two disagreeing is `namespace-divergence` below. Previously
	 *  this was the only namespace value this command had a witness for at all — Task 1's
	 *  `resolveNodeEnvironment` is what makes the daemon's own value reachable now. */
	cliNamespace: string;
	/** The runtime sidecar URL this CLI would reach for this node —
	 *  `resolveRuntimeSidecarUrl` (`../utils/runtime-config.ts`). Cheap, real, and part of
	 *  "which state is active"; optional in spirit, included because it costs nothing. */
	runtimeEndpoint: string;
	/** `null` when no running node was found — see `ContextNode`'s doc. */
	node: ContextNode | null;
	/** What the RUNNING node itself declares, read from its own `/proc/<pid>/environ` —
	 *  Task 1's witness (`resolveNodeEnvironment`, `../utils/node-environment.ts`), reused
	 *  verbatim (not renamed/re-derived — same rule this file already applies to `metadata`
	 *  and `loadedPlugin`). Two DIFFERENT things collapse to `null` here, and only `node`
	 *  above tells them apart: no running node at all (then this is trivially `null` too and
	 *  `node-not-running` already covers it), versus a running node whose environ could not
	 *  be read (`node-environment-unknown` — a gap in the checking, never agreement and
	 *  never a base/namespace divergence, since nothing was actually compared). */
	nodeEnvironment: NodeEnvironment | null;
	/** The plugin the running node's own argv names, hashed — Task 1's witness.
	 *  `null` only when there is no running node, or it names none; see
	 *  `resolveLoadedPlugin`'s contract for the null/unreadable distinction. */
	loadedPlugin: LoadedPlugin | null;
	/** Where a fresh build of the agent plugin would land, for comparison. `null` when it
	 *  could not be located — either no running-node witness to compare against, or (see
	 *  `resolveBuiltPluginPath`) this process is not standing inside a real monorepo
	 *  checkout. Never a fabricated path under a directory that was never verified. */
	builtPluginPath: string | null;
	/** The hash a fresh build currently produces. `null` when it could not be read — either
	 *  `builtPluginPath` is `null`, or the file at that path could not be hashed. */
	builtPluginSha: string | null;
	/** Sovereign directories that exist on disk but are not `metadata.sovereignHome` —
	 *  candidates nothing currently loads. Checked on BOTH sides of the mode split (the
	 *  workspace-scoped `<cwd>/.refarm` and the node-global default home) so a `workspace`
	 *  node does not go blind to an abandoned node-global home, or vice versa. */
	otherSovereignDirs: string[];
}

/** `ContextInput` plus the divergences found by comparing its parts. */
export interface ContextReport extends ContextInput {
	divergences: Divergence[];
}

function shortHash(sha: string): string {
	return sha.slice(0, 8);
}

/**
 * Compare an already-resolved `ContextInput` and report where the pieces disagree. PURE —
 * every filesystem or process read happens before this is called (see
 * `resolveContextInput`). The vocabulary above is the whole vocabulary; nothing here
 * invents another kind without a test that demands it.
 */
export function buildContextReport(input: ContextInput): ContextReport {
	const divergences: Divergence[] = [];

	if (!input.node) {
		divergences.push({
			kind: "node-not-running",
			summary: "No running node was found, so the loaded plugin cannot be compared to anything.",
		});
	} else if (!input.loadedPlugin) {
		divergences.push({
			kind: "plugin-hash-unknown",
			summary:
				`The running node (pid ${input.node.pid}) does not say which plugin it loaded — ` +
				"neither a match nor a mismatch can be claimed.",
		});
	} else if (input.loadedPlugin.sha256 === null) {
		divergences.push({
			kind: "plugin-hash-unknown",
			summary:
				`Loaded plugin ${input.loadedPlugin.path} could not be hashed ` +
				`(${input.loadedPlugin.unreadableReason ?? "unknown reason"}) — ` +
				"neither a match nor a mismatch can be claimed.",
		});
	} else if (input.builtPluginSha === null) {
		// The mirror of the arm above: the loaded side is known, but there is nothing to
		// compare it TO. Silence here would read as "matches", which is exactly the false
		// clean a reviewer reproduced live against this same daemon from outside the repo.
		divergences.push({
			kind: "built-plugin-unknown",
			summary: input.builtPluginPath
				? `The built plugin ${input.builtPluginPath} could not be hashed — the loaded plugin ` +
					`(${shortHash(input.loadedPlugin.sha256)}) cannot be verified against a fresh build.`
				: "No monorepo build of the agent plugin could be located from here — the loaded " +
					`plugin (${shortHash(input.loadedPlugin.sha256)}) cannot be verified against a fresh build.`,
		});
	} else if (input.loadedPlugin.sha256 !== input.builtPluginSha) {
		divergences.push({
			kind: "plugin-hash-mismatch",
			summary:
				`Loaded plugin ${input.loadedPlugin.path} (${shortHash(input.loadedPlugin.sha256)}) ` +
				`does not match the built plugin ${input.builtPluginPath ?? "?"} ` +
				`(${shortHash(input.builtPluginSha)}).`,
		});
	}

	// The defect this task closes: `base:`/`namespace:` used to be the CLI's own resolved
	// values, reported where the NODE's belonged. This block is deliberately a SEPARATE,
	// independent chain from the plugin comparison above rather than another branch fused
	// into it — `node-not-running` must stay the whole story when there is no node (the
	// brief's fifth case), not doubled up with a second finding about environment.
	//
	// THREE STATES, never two, same posture as every other comparison in this file: a running
	// node whose environ could not be read is `node-environment-unknown` — a GAP in the
	// checking. Falling through to compare `input.cliBase`/`cliNamespace` against themselves
	// here would silently manufacture "agreement" out of a comparison that never happened —
	// the exact failure shape this task exists to prevent, one level up from where
	// `built-plugin-unknown` already prevents it for the plugin hash.
	if (input.node) {
		if (!input.nodeEnvironment) {
			divergences.push({
				kind: "node-environment-unknown",
				summary:
					`The running node (pid ${input.node.pid}) is up, but its own environment ` +
					`(/proc/${input.node.pid}/environ) could not be read — its declared base and ` +
					"namespace cannot be compared to this CLI's at all. This is a gap in the " +
					"checking, not agreement.",
			});
		} else {
			// The node's EFFECTIVE base: what it declared, or — when it declared nothing — the
			// cwd it fell back to (Task 1's contract: a null `base` field means "fell back",
			// itself worth reporting, and `/proc/<pid>/cwd` is what it fell back TO).
			const nodeBase = input.nodeEnvironment.base ?? input.nodeEnvironment.cwd;
			if (nodeBase !== null && nodeBase !== input.cliBase) {
				divergences.push({
					kind: "base-divergence",
					summary: input.nodeEnvironment.base
						? `The node declares SOVEREIGN_BASE=${input.nodeEnvironment.base}, but this CLI ` +
							`resolves base to ${input.cliBase} (from ${input.cliBaseOrigin}) — they disagree.`
						: `The node declares no SOVEREIGN_BASE — not declared, it fell back to its own ` +
							`working directory (${input.nodeEnvironment.cwd}) — which disagrees with this ` +
							`CLI's base ${input.cliBase} (from ${input.cliBaseOrigin}).`,
				});
			}

			// Same shape for namespace: the node's effective value is what it declared, or the
			// "default" `resolveTractorNamespace` itself falls back to when undeclared.
			const nodeNamespace = input.nodeEnvironment.namespace ?? "default";
			if (nodeNamespace !== input.cliNamespace) {
				divergences.push({
					kind: "namespace-divergence",
					summary: input.nodeEnvironment.namespace
						? `The node declares REFARM_NAMESPACE=${input.nodeEnvironment.namespace}, but this ` +
							`CLI resolves namespace to ${input.cliNamespace} — they disagree.`
						: `The node declares no REFARM_NAMESPACE — not declared, it fell back to ` +
							`"default" — which disagrees with this CLI's namespace ${input.cliNamespace}.`,
				});
			}
		}
	}

	for (const dir of input.otherSovereignDirs) {
		divergences.push({
			kind: "unloaded-sovereign-dir",
			summary:
				`${dir} is a sovereign directory that exists on disk but is not the active home ` +
				`(${input.metadata.sovereignHome}) — nothing loads it.`,
		});
	}

	if (!input.metadata.homesAligned) {
		divergences.push({
			kind: CONTEXT_HOME_DIVERGENCE_DIAGNOSTIC,
			summary:
				`Sovereign home (${input.metadata.sovereignHome}) and credential store home ` +
				`(${input.metadata.credentialStoreHome}) resolve to different directories — ` +
				"credentials and runtime state can diverge.",
		});
	}

	return { ...input, divergences };
}

// ---- Impure edge: every filesystem and process read the pure builder above is fed. ----

/** Where a fresh build of the agent plugin lands, relative to the monorepo root —
 *  `packages/agent/dist/agent.wasm` (confirmed on disk; see `packages/agent/dist/`). */
const BUILT_AGENT_PLUGIN_RELATIVE_PATH = ["packages", "agent", "dist", "agent.wasm"];

/**
 * Where a fresh build of the agent plugin would land, given what `findWorkspaceRoot`
 * returned — `null` when that root is not a real monorepo checkout.
 *
 * `findWorkspaceRoot` (`@refarm.dev/config`) falls back to returning `cwd` UNCHANGED when it
 * climbs to the filesystem root without ever finding `.git` / `pnpm-workspace.yaml` / a
 * `package.json` declaring workspaces. For a `mode: node` install — the NORMAL case for an
 * operator who only uses Refarm and never clones it — that fallback fires on every run.
 * Trusting it unconditionally fabricates a path like `<cwd>/packages/agent/dist/agent.wasm`
 * that never existed, which then hashes to `null` and the caller's `&&` guard used to read
 * that as "nothing to compare, so say nothing" — the exact silent false-clean this command
 * exists to end. Checking for a real marker FIRST is what makes `null` here mean "this
 * process is not standing inside the monorepo", not "the file happens to be missing".
 */
export function resolveBuiltPluginPath(
	repoRoot: string,
	hasMonorepoMarker: (dir: string) => boolean = hasWorkspaceRootMarker,
): string | null {
	return hasMonorepoMarker(repoRoot)
		? path.join(repoRoot, ...BUILT_AGENT_PLUGIN_RELATIVE_PATH)
		: null;
}

/**
 * Which of `candidates` are real, unloaded sovereign directories: on disk, and not the
 * active `sovereignHome`. Injectable `exists` so this is testable without touching a real
 * filesystem. Order-preserving, de-duplicated by resolved path.
 */
export function resolveOtherSovereignDirs(
	sovereignHome: string,
	candidates: string[],
	exists: (candidate: string) => boolean = fs.existsSync,
): string[] {
	const active = path.resolve(sovereignHome);
	const seen = new Set<string>();
	const result: string[] = [];
	for (const candidate of candidates) {
		const resolved = path.resolve(candidate);
		if (resolved === active || seen.has(resolved)) continue;
		seen.add(resolved);
		if (exists(candidate)) result.push(candidate);
	}
	return result;
}

export function resolveContextInput(env = process.env, cwd = process.cwd()): ContextInput {
	const metadata = resolveNodeContextMetadata(env, cwd);
	const nodeHome = path.resolve(metadata.sovereignHome);

	const descriptor = readNodeDescriptor(nodeHome);
	const node: ContextNode | null = descriptor
		? {
				pid: descriptor.pid,
				startedAt: descriptor.startedAt,
				...(descriptor.nodeName ? { name: descriptor.nodeName } : {}),
				...(descriptor.nodeId ? { id: descriptor.nodeId } : {}),
			}
		: null;
	const loadedPlugin = descriptor ? resolveLoadedPlugin(descriptor.pid) : null;
	// Task 1's witness, read fresh here rather than reconstructed from this CLI's own
	// `process.env` — the whole point (see `NodeEnvironment`'s doc and this file's header on
	// the CLI/node split). `null` when no descriptor exists at all; when one does,
	// `resolveNodeEnvironment` itself distinguishes "the node declares nothing" (a field is
	// `null`) from "the node's environ could not be read at all" (the function returns
	// `null`) — `buildContextReport` relies on that distinction surviving to here unflattened.
	const nodeEnvironment = descriptor ? resolveNodeEnvironment(descriptor.pid) : null;

	const repoRoot = findWorkspaceRoot(cwd);
	const builtPluginPath = resolveBuiltPluginPath(repoRoot);
	const builtPluginSha = builtPluginPath ? defaultHashFile(builtPluginPath) : null;

	const explicitBase = env[SOVEREIGN_BASE_KEY]?.trim();

	// Both sides of the mode split (see `ContextInput.otherSovereignDirs`'s doc): the
	// workspace-scoped home — the exact formula `context-metadata.ts` itself joins,
	// duplicated rather than imported because that module does not export it standalone —
	// and the node-global default, resolved through the REAL adapter (`resolveRefarmHome`,
	// with no env override) rather than a hand-reconstructed guess at the OS home
	// directory's physical default, which is the class of drift this whole plan exists to
	// remove.
	const otherSovereignDirs = resolveOtherSovereignDirs(metadata.sovereignHome, [
		path.join(cwd, ".refarm"),
		resolveRefarmHome({}),
	]);

	return {
		metadata,
		cliBase: declaredBase(env, cwd),
		cliBaseOrigin: explicitBase ? "SOVEREIGN_BASE" : "cwd",
		cliNamespace: resolveTractorNamespace(env),
		runtimeEndpoint: resolveRuntimeSidecarUrl({ cwd, env }).value,
		node,
		nodeEnvironment,
		loadedPlugin,
		builtPluginPath,
		builtPluginSha,
		otherSovereignDirs,
	};
}

function pluginLine(label: string, path_: string | null, sha: string | null): string {
	if (!path_) return `  ${label}: (none)`;
	const hash = sha ? shortHash(sha) : "unknown";
	return `  ${label}: ${path_}  (${hash})`;
}

/** What the report shows as the node's own base — declared, honestly phrased as a fallback
 *  when undeclared, or plainly unknown when the node's environ could not be read at all.
 *  This is the fix itself: the `base:` line used to be the CLI's value; this is the NODE's. */
function nodeBaseLine(report: ContextReport): string {
	if (!report.node) return "  node base: (node not running)";
	if (!report.nodeEnvironment) return "  node base: (unknown — the node's environment could not be read)";
	if (report.nodeEnvironment.base) return `  node base: ${report.nodeEnvironment.base}`;
	return report.nodeEnvironment.cwd
		? `  node base: (not declared; the node fell back to its own working directory: ${report.nodeEnvironment.cwd})`
		: "  node base: (not declared; the node's own working directory could not be read either)";
}

/** Same idea as `nodeBaseLine`, for namespace — the fallback here is the literal `"default"`
 *  `resolveTractorNamespace` itself falls back to, not a read value. */
function nodeNamespaceLine(report: ContextReport): string {
	if (!report.node) return "  node namespace: (node not running)";
	if (!report.nodeEnvironment) return "  node namespace: (unknown — the node's environment could not be read)";
	if (report.nodeEnvironment.namespace) return `  node namespace: ${report.nodeEnvironment.namespace}`;
	return '  node namespace: (not declared; the node fell back to "default")';
}

function printContextHuman(report: ContextReport): void {
	console.log(chalk.bold("\n  Refarm context\n"));
	console.log(
		`  mode: ${report.metadata.mode}   home chosen: ${report.metadata.binding.origin}\n` +
			`  sovereign home: ${report.metadata.sovereignHome}\n` +
			`  credential home: ${report.metadata.credentialStoreHome}` +
			(report.metadata.homesAligned ? "" : chalk.yellow("  (diverged from sovereign home)")) +
			"\n" +
			`${nodeBaseLine(report)}\n` +
			`  cli base: ${report.cliBase}  (from ${report.cliBaseOrigin})\n` +
			`${nodeNamespaceLine(report)}\n` +
			`  cli namespace: ${report.cliNamespace}\n` +
			`  runtime endpoint: ${report.runtimeEndpoint}\n`,
	);
	if (report.node) {
		const label = report.node.name ?? "(unnamed)";
		const idSlice = report.node.id ? ` [${report.node.id.slice(0, 8)}]` : "";
		console.log(
			`  node: ${label}${idSlice}  pid ${report.node.pid}  started ${report.node.startedAt}\n`,
		);
	} else {
		console.log("  node: (not running)\n");
	}
	console.log(pluginLine("loaded plugin", report.loadedPlugin?.path ?? null, report.loadedPlugin?.sha256 ?? null));
	console.log(pluginLine("built plugin ", report.builtPluginPath, report.builtPluginSha));

	console.log();
	if (report.divergences.length === 0) {
		console.log(chalk.green("  No divergences — the node and this CLI agree on everything checked.\n"));
		return;
	}
	console.log(chalk.yellow(`  ${report.divergences.length} divergence(s):\n`));
	for (const d of report.divergences) {
		console.log(`  - [${d.kind}] ${d.summary}`);
	}
	console.log();
}

interface ContextCommandOptions {
	json?: boolean;
}

export function createContextCommand(): Command {
	return new Command("context")
		.description("Report the whole resolved sovereign state: mode, home, node, and loaded plugin")
		.option("--json", "Output machine-readable JSON")
		.addHelpText(
			"after",
			`

Examples:
  $ refarm context
  $ refarm context --json

Notes:
  Read-only — this command never restarts a node and never writes anything.
  A path alone is never proof: the loaded and built plugin are both reported with a hash.
  An unhashable or unresolvable plugin (loaded OR built) is reported as *-unknown — never a
  false match, and never silently dropped from the comparison.
`,
		)
		.action((options: ContextCommandOptions) => {
			const report = buildContextReport(resolveContextInput());
			if (options.json) {
				printJson(
					buildJsonSuccessEnvelope({
						command: "context",
						operation: "report",
						extra: { context: report },
					}),
				);
				return;
			}
			printContextHuman(report);
		});
}

export const contextCommand = createContextCommand();
