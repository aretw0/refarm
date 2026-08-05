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
// would produce, and other sovereign directories sitting unloaded on disk.
//
// THREE STATES, never two, for the plugin comparison — the same rule `../utils/
// runtime-freshness.ts` and `../utils/loaded-plugin.ts` already state: an unhashable
// loaded plugin is `plugin-hash-unknown`, never folded into a match or a mismatch. A node
// that is not running at all is `node-not-running` and yields NO plugin verdict — not a
// false "clean" produced by comparing two nulls into silence.
//
// NEVER RESTARTS, NEVER WRITES. This command reads and reports; restarting a node so it
// picks up a different plugin is the operator's decision, exactly as `runtime-freshness-
// doctor.ts` says of the freshness check it renders. No divergence here carries an
// `action` that performs anything.
//
// PURE CORE, IMPURE EDGE — the established shape of every doctor finding in this
// codebase (`scope-doctor.ts`, `node-name-doctor.ts`, `runtime-freshness-doctor.ts`):
// `buildContextReport` is pure and every test drives it with literals; the filesystem and
// process reads live in `resolveContextInput` below, exercised only by running the command.

import { buildJsonSuccessEnvelope, printJson } from "@refarm.dev/capabilities/envelope";
import {
	declaredBase,
	findWorkspaceRoot,
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
	| "unloaded-sovereign-dir"
	| "node-not-running"
	| "credential-home-divergence";

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
	/** What `declaredBase()` (`@refarm.dev/config`) resolves — where declarations are read
	 *  against, independent of where credentials/plugins live. */
	base: string;
	/** Whether `base` came from the explicit `SOVEREIGN_BASE` env var or fell back to cwd. */
	baseOrigin: "SOVEREIGN_BASE" | "cwd";
	/** `null` when no running node was found — see `ContextNode`'s doc. */
	node: ContextNode | null;
	/** The plugin the running node's own argv names, hashed — Task 1's witness.
	 *  `null` only when there is no running node, or it names none; see
	 *  `resolveLoadedPlugin`'s contract for the null/unreadable distinction. */
	loadedPlugin: LoadedPlugin | null;
	/** Where a fresh build of the agent plugin would land, for comparison. `null` when it
	 *  could not be located (not running inside the monorepo). */
	builtPluginPath: string | null;
	/** The hash a fresh build currently produces. `null` when it could not be read — a
	 *  missing dist artifact is a build that has not happened yet, not a finding this
	 *  command invents a divergence for. */
	builtPluginSha: string | null;
	/** Sovereign directories that exist on disk but are not `metadata.sovereignHome` —
	 *  candidates nothing currently loads. */
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
 * `resolveContextInput`). The five kinds above are the whole vocabulary; nothing here
 * invents a sixth without a test that demands it.
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
	} else if (input.builtPluginSha && input.loadedPlugin.sha256 !== input.builtPluginSha) {
		divergences.push({
			kind: "plugin-hash-mismatch",
			summary:
				`Loaded plugin ${input.loadedPlugin.path} (${shortHash(input.loadedPlugin.sha256)}) ` +
				`does not match the built plugin ${input.builtPluginPath ?? "?"} ` +
				`(${shortHash(input.builtPluginSha)}).`,
		});
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
			kind: "credential-home-divergence",
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

function resolveOtherSovereignDirs(repoRoot: string, sovereignHome: string): string[] {
	const candidate = path.join(repoRoot, ".refarm");
	if (path.resolve(candidate) === path.resolve(sovereignHome)) return [];
	return fs.existsSync(candidate) ? [candidate] : [];
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

	const repoRoot = findWorkspaceRoot(cwd);
	const builtPluginPath = path.join(repoRoot, ...BUILT_AGENT_PLUGIN_RELATIVE_PATH);
	const builtPluginSha = defaultHashFile(builtPluginPath);

	const explicitBase = env[SOVEREIGN_BASE_KEY]?.trim();

	return {
		metadata,
		base: declaredBase(env, cwd),
		baseOrigin: explicitBase ? "SOVEREIGN_BASE" : "cwd",
		node,
		loadedPlugin,
		builtPluginPath,
		builtPluginSha,
		otherSovereignDirs: resolveOtherSovereignDirs(repoRoot, metadata.sovereignHome),
	};
}

function pluginLine(label: string, path_: string | null, sha: string | null): string {
	if (!path_) return `  ${label}: (none)`;
	const hash = sha ? shortHash(sha) : "unknown";
	return `  ${label}: ${path_}  (${hash})`;
}

function printContextHuman(report: ContextReport): void {
	console.log(chalk.bold("\n  Refarm context\n"));
	console.log(
		`  mode: ${report.metadata.mode}   home chosen: ${report.metadata.binding.origin}\n` +
			`  sovereign home: ${report.metadata.sovereignHome}\n` +
			`  credential home: ${report.metadata.credentialStoreHome}` +
			(report.metadata.homesAligned ? "" : chalk.yellow("  (diverged from sovereign home)")) +
			"\n" +
			`  base: ${report.base}  (from ${report.baseOrigin})\n`,
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
		console.log(chalk.green("  No divergences — the loaded plugin matches what a fresh build produces.\n"));
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
  An unhashable loaded plugin is reported as plugin-hash-unknown — never a false match.
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
