import { resolvePluginPackage } from "@refarm.dev/barn";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	printJson,
} from "@refarm.dev/capabilities/envelope";
import { quoteCommandArgIfNeeded } from "@refarm.dev/cli/command-handoff";
import { runProcessHandoff } from "@refarm.dev/cli/process-handoff";
import { AGENT_CORE_BUNDLE, loadConfig, readPluginDevelopment } from "@refarm.dev/config";
import {
	isRuntimeAgentPluginId,
	normalizePluginId,
	pluginIdRuntimeToken,
} from "@refarm.dev/config/plugin-identity";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { refarmCommand, refarmProcess } from "../brand.js";
import {
	PLUGIN_INSTALL_COMMAND,
	PLUGIN_INSTALL_JSON_COMMAND,
	PLUGIN_STATUS_JSON_COMMAND,
} from "./plugin-handoffs.js";
import { type InstalledPlugin, type IntegrityVerdict } from "./plugin-inventory.js";
import { listExtensions } from "./plugin-scaffold.js";
import {
	BUNDLED_PLUGINS,
	type BundledPlugin,
	PLUGIN_RELOAD_RUNTIME_AGENT_JSON_COMMAND,
	type PluginListEntry,
	type PluginListReport,
	type PluginOrigin,
	readInstalledVersion,
	type RuntimePluginRecommendation,
	type RuntimePluginStatusReport,
} from "./plugin-shared.js";
import {
	readRuntimePluginState,
	reloadRuntimePluginsAndWait,
	type RequestedPluginFact,
} from "./runtime-plugins.js";
import {
	RUNTIME_DOCTOR_COMMAND,
	RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
	RUNTIME_DOCTOR_NEXT_COMMAND,
	RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
	RUNTIME_START_WAIT_COMMAND,
	RUNTIME_STATUS_COMMAND,
} from "./runtime-recovery.js";

export function pluginReloadRestartCommand(pluginIds: string[], json = false): string {
	return refarmCommand([
		"plugin",
		"reload",
		...pluginIds.map(quoteCommandArgIfNeeded),
		"--restart-if-needed",
		"--wait",
		...(json ? ["--json"] : []),
	]);
}

function runtimeRestartProcess(wait: boolean) {
	return refarmProcess(["runtime", "restart", ...(wait ? ["--wait"] : [])]);
}

export async function restartRuntimeForPluginReload(wait: boolean): Promise<{
	ok: boolean;
	restartCommand: string;
	failedCommand?: string;
}> {
	const restart = runtimeRestartProcess(wait);
	const startResult = await runProcessHandoff(restart, { capture: false });
	return {
		ok: startResult.exitCode === 0,
		restartCommand: restart.display,
		...(startResult.exitCode === 0 ? {} : { failedCommand: restart.display }),
	};
}

/**
 * The unified plugin inventory (ADR-086): bundled plugins AND authored local
 * plugins, each tagged with its `origin`. `options.origin` filters to one
 * provenance (the `--origin` flag); an origin the resolver can't yet materialize
 * (npm/git/url) is a valid filter that simply matches nothing — the list never
 * over-claims coverage. Defaults (no filter) to every known plugin.
 */
/** This module's own directory — the anchor for resolving what shipped WITH the app. Not a cwd
 *  fallback: there is nothing to fall back from, because the question never involved the caller's
 *  directory in the first place. */
const APP_MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export async function buildPluginListReport(
	options: { origin?: PluginOrigin; bundled?: readonly BundledPlugin[] } = {},
): Promise<PluginListReport> {
	const wanted = options.origin;
	// The bundled set defaults to refarm's own; a white-label app injects its own
	// (ADR-086 white-label seam) so `--origin bundled` reflects the app's plugins.
	const bundledSet = options.bundled ?? BUNDLED_PLUGINS;
	const plugins: PluginListEntry[] = [];

	// bundled — shipped with the app, resolved from node_modules/workspace.
	if (wanted === undefined || wanted === "bundled") {
		for (const plugin of bundledSet) {
			const version = await readInstalledVersion(plugin.id);
			const resolution = resolvePluginPackage(plugin, {
				baseUrl: import.meta.url,
				// ISS-094. Where a BUNDLED plugin's package lives is a property of this
				// installation of refarm, not of the directory the operator is standing in — which
				// is exactly what `baseUrl: import.meta.url` already says for the node_modules
				// branch. The workspace branch was still walking up from `process.cwd()`, so the
				// node's own plugin read as packageSource "workspace" from this checkout and
				// "unresolved" from anywhere else, while `plugin status` stayed correctly identical.
				cwd: APP_MODULE_DIR,
			});
			plugins.push({
				id: plugin.id,
				version,
				source: "bundled",
				packageSource: resolution?.source ?? "unresolved",
				packageDir: resolution?.pkgDir ?? null,
				installed: version !== null,
			});
		}
	}

	// local — authored under .refarm/extensions/ (project + global). A local
	// plugin IS installed by virtue of existing on disk; its dir/scope ride along.
	if (wanted === undefined || wanted === "local") {
		for (const ext of listExtensions(process.cwd(), os.homedir())) {
			plugins.push({
				id: ext.id,
				version: ext.version,
				source: "local",
				packageSource: "unresolved",
				packageDir: ext.dir,
				installed: true,
				scope: ext.scope,
				dir: ext.dir,
			});
		}
	}

	// installed / npm / git / url: no resolver wires these yet (ADR-086 phases 3+6).
	// Asking for one is valid and simply yields nothing here — never a lie about
	// coverage, never a crash.

	return { plugins };
}

export async function listInstalledPlugins(options: { json?: boolean } = {}): Promise<void> {
	const report = await buildPluginListReport();

	if (options.json) {
		const missing = report.plugins.some((plugin) => !plugin.installed);
		printJson(
			buildJsonSuccessEnvelope({
				command: "plugin",
				operation: "list",
				nextCommand: missing ? PLUGIN_INSTALL_JSON_COMMAND : PLUGIN_STATUS_JSON_COMMAND,
				nextCommands: missing
					? [PLUGIN_INSTALL_JSON_COMMAND, PLUGIN_STATUS_JSON_COMMAND]
					: [PLUGIN_STATUS_JSON_COMMAND],
				extra: report,
			}),
		);
		return;
	}

	const results = report.plugins;
	if (results.length === 0) {
		console.log(
			`No plugins installed. Run '${refarmCommand(["plugin", "install"])}' to install bundled plugins.`,
		);
		return;
	}

	const idWidth = Math.max(...results.map((r) => r.id.length), 4);
	const verWidth = Math.max(...results.map((r) => (r.version ?? "not installed").length), 7);
	const sourceWidth = Math.max(...results.map((r) => `${r.source}/${r.packageSource}`.length), 6);

	console.log(
		`  ${"PLUGIN".padEnd(idWidth)}  ${"VERSION".padEnd(verWidth)}  ${"SOURCE".padEnd(sourceWidth)}  PACKAGE`,
	);
	for (const { id, version, source, packageSource, packageDir } of results) {
		const ver = version ?? "not installed";
		const sourceLabel = `${source}/${packageSource}`;
		console.log(
			`  ${id.padEnd(idWidth)}  ${ver.padEnd(verWidth)}  ${sourceLabel.padEnd(sourceWidth)}  ${packageDir ?? "-"}`,
		);
	}
}

/** One row of the plugin-status answer, after the host's and the CLI's facts are merged. Kept
 *  as an explicit interface (not `ReturnType<typeof mergePluginFacts>[number]`) because that
 *  self-reference is what it sounds like — TypeScript rejects a function's return type quoting
 *  itself before the function is fully typed. */
export interface PluginFacts {
	runtimeId: string;
	manifestId: string | null;
	/** The installed directory this row's disk facts came from — CLI-observed, `null` for a row
	 *  that exists only because the host was handed a path this scan never found on disk. */
	dir: string | null;
	requested: boolean;
	loaded: boolean;
	installed: boolean;
	integrity: IntegrityVerdict | null;
	/** Whether this plugin is DECLARED — part of the bundled/core set this node is supposed to
	 *  carry — independent of whether it is installed, requested, or loaded. Declaration-observed
	 *  (`knownPluginDescriptors`), never inferred from disk or the host. This is what tells
	 *  "declared and not installed" (a bundled plugin missing from this node) apart from "never
	 *  heard of" (a third-party or local plugin with no such claim). */
	known: boolean;
	/** Whether THIS NODE declared it is developing this plugin — the third axis
	 *  (`.refarm/config.json`'s `pluginDevelopment`, `packages/config/src/plugin-development.js`),
	 *  beside `trusted_plugins` and `approvedPermissions`. The host consults exactly this
	 *  declaration to waive an ABSENT integrity claim (never a wrong one) at load. Reported here
	 *  because `local: []` already proved a field nobody surfaces is a field nobody notices: an
	 *  operator seeing `integrity: absent` could not tell whether that tree would load at all. */
	development: boolean;
}

/** PURE. One row per installed DIRECTORY, never per id — two trees CAN share one runtime id (a
 *  pre-convergence layout left beside the live one, measured on the operator's real node:
 *  `~/.refarm/plugins/refarm_agent/` and `~/.refarm/plugins/@refarm/agent/` both name
 *  `@refarm/agent`). A row keyed by id would silently pick one tree and hide the other — the
 *  duplication IS the finding this phase exists to surface, so `readInstalledPlugins`'s rows
 *  are never deduped or merged together here either.
 *
 * `installed`/`integrity` come from the CLI's disk scan (`installed`, the second argument —
 * the daemon never scans, so it cannot answer these). `requested`/`loaded` are attached to
 * each tree by comparing the host's `requested[].path` against `<dir>/plugin.wasm`: PATH, not
 * id, is the only vocabulary that can tell two same-id trees apart, because the host was
 * handed a path and recorded which path became a channel — never which id.
 *
 * A `requested` entry that matches no installed directory still becomes its own row
 * (`installed: false`) rather than vanishing: the daemon was handed a path this scan cannot
 * see (deleted since boot, or outside the scanned base dir), and that absence must declare
 * itself as clearly as an installed tree the daemon never touched.
 */
export function mergePluginFacts(
	state: { requested: RequestedPluginFact[]; loaded: string[] },
	installed: readonly InstalledPlugin[],
	known: readonly { id: string }[] = [],
	/** Runtime ids THIS NODE declared under development (`readPluginDevelopment`, keyed the
	 *  same way `known` is). Empty by default so this stays PURE for direct unit tests; the
	 *  status builder below passes the node's real declaration. */
	developmentIds: ReadonlySet<string> = new Set(),
): PluginFacts[] {
	// The declared set, keyed by RUNTIME id (the vocabulary every row already carries) so a
	// bundled `@refarm/agent` matches an installed tree's `agent` without a second lookup path.
	const knownByRuntimeId = new Map<string, string>();
	for (const descriptor of known) {
		knownByRuntimeId.set(pluginIdRuntimeToken(descriptor.id), descriptor.id);
	}

	// The LIVE fact — the keys of `plugin_channels` right now, exactly as D2 defines `loaded`.
	// NEVER `match?.loaded` / `entry.loaded` (the frozen boot record of what `record_plugin_request`
	// wrote at startup): a teardown or a failed hot-reload changes `plugin_channels` without ever
	// updating that record, so the boot record and the live fact can and do disagree. Conflating
	// them is the defect this merge exists to not repeat — the boot record stays exactly what it
	// is (what happened at boot, still visible via `requested`), and `loaded` here answers the
	// live question and nothing else.
	//
	// Projected through `pluginIdRuntimeToken` because `state.loaded` is NOT uniformly
	// runtime-token-shaped: `readRuntimePluginState` normalizes each id via `normalizePluginId`,
	// whose alias table maps a DECLARED plugin's runtime token back to its full manifest id
	// (`"agent"` -> `"@refarm/agent"`) while leaving an undeclared (third-party) id alone. Every
	// row's own `runtimeId` (below and throughout this merge) is always the short form
	// (`pluginIdRuntimeToken(manifest.id)`), so comparing the two vocabularies unprojected would
	// silently never match a declared plugin — exactly the kind of confidently-wrong id this
	// codebase has already paid for once (see `plugin-identity.js`'s alias-table comment).
	const liveRuntimeIds = new Set(state.loaded.map(pluginIdRuntimeToken));

	const consumed = new Set<number>();
	const matchByPath = (dir: string): RequestedPluginFact | undefined => {
		const wasmPath = path.resolve(dir, "plugin.wasm");
		const index = state.requested.findIndex(
			(r, i) => !consumed.has(i) && path.resolve(r.path) === wasmPath,
		);
		if (index === -1) return undefined;
		consumed.add(index);
		return state.requested[index];
	};

	const rows: PluginFacts[] = installed.map((tree) => {
		const match = matchByPath(tree.dir);
		return {
			runtimeId: tree.runtimeId,
			manifestId: tree.manifestId,
			dir: tree.dir,
			requested: match !== undefined,
			// Gated on `match` too, not just the live id set: `plugin_channels` holds one
			// channel per id, so when two installed DIRECTORIES share a runtime id (measured on
			// a real node — a pre-convergence layout left beside the live one), the id being
			// live says only that SOME tree with this id is loaded, never which directory. Only
			// the tree the host was actually handed a path for (`match`) may claim it — a stale
			// sibling must never borrow the live tree's fact just for sharing its id.
			loaded: match !== undefined && liveRuntimeIds.has(tree.runtimeId),
			installed: true,
			integrity: tree.integrity,
			known: knownByRuntimeId.has(tree.runtimeId),
			development: developmentIds.has(tree.runtimeId),
		};
	});

	state.requested.forEach((entry, index) => {
		if (consumed.has(index)) return;
		const runtimeId = entry.id !== null ? pluginIdRuntimeToken(entry.id) : entry.path;
		rows.push({
			runtimeId,
			manifestId: entry.id,
			dir: null,
			requested: true,
			loaded: liveRuntimeIds.has(runtimeId),
			installed: false,
			integrity: null,
			known: knownByRuntimeId.has(runtimeId),
			development: developmentIds.has(runtimeId),
		});
	});

	// Declared and not installed: a known plugin no row above has touched yet still gets one —
	// `known: true, installed: false, requested: false, loaded: false` — rather than vanishing
	// (the old BUNDLED_PLUGINS fallback this replaces showed a placeholder that looked like it
	// might be installed; this row says plainly that it is not).
	const seenRuntimeIds = new Set(rows.map((r) => r.runtimeId));
	for (const [runtimeId, manifestId] of knownByRuntimeId) {
		if (seenRuntimeIds.has(runtimeId)) continue;
		rows.push({
			runtimeId,
			manifestId,
			dir: null,
			requested: false,
			loaded: false,
			installed: false,
			integrity: null,
			known: true,
			development: developmentIds.has(runtimeId),
		});
	}

	return rows.sort(
		(a, b) => a.runtimeId.localeCompare(b.runtimeId) || (a.dir ?? "").localeCompare(b.dir ?? ""),
	);
}

/** Everything this node is DECLARED to carry (D2's `known`): the app's bundled set (ADR-086
 *  white-label seam — `bundled` defaults to refarm's own `BUNDLED_PLUGINS`) plus the SDK-level
 *  agent core-plugin cut (`AGENT_CORE_BUNDLE`: the agent + the plugins that extend it, e.g.
 *  `@refarm/lsp-code-ops`) — the two static sources the spec names. Deliberately NOT
 *  `config.plugins`: that is a different, composition-layer declaration (config-plugins.ts,
 *  package activation) with no simple `{id}` shape to union here; left as a gap for a later
 *  round rather than guessed at. */
export function knownPluginDescriptors(
	bundled: readonly { id: string }[] = BUNDLED_PLUGINS,
): readonly { id: string }[] {
	return [...bundled, AGENT_CORE_BUNDLE.agent, ...AGENT_CORE_BUNDLE.corePlugins];
}

/** THIS NODE's development declarations (`.refarm/config.json`'s `pluginDevelopment`), as the
 *  runtime-id set `mergePluginFacts` compares rows against. Reads the same merged config
 *  (`loadConfig`) every other status-adjacent reader on this surface uses; `config` is
 *  injectable so callers (and tests) don't need a real config file on disk. */
export function nodePluginDevelopmentIds(config: unknown = loadConfig()): ReadonlySet<string> {
	return new Set(readPluginDevelopment(config).keys());
}

export function buildRuntimePluginStatusReport(
	state: Awaited<ReturnType<typeof readRuntimePluginState>>,
	installed: readonly InstalledPlugin[] = [],
	known: readonly { id: string }[] = knownPluginDescriptors(),
	developmentIds: ReadonlySet<string> = nodePluginDevelopmentIds(),
): RuntimePluginStatusReport {
	if (!state) {
		const recommendations = runtimePluginUnavailableRecommendations();
		return {
			command: "plugin",
			operation: "status",
			ok: false,
			available: false,
			plugins: [],
			nextAction: RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
			nextActions: [
				RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
				RUNTIME_START_WAIT_COMMAND,
				RUNTIME_DOCTOR_NEXT_COMMAND,
			],
			nextCommand: RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
			nextCommands: [
				RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
				RUNTIME_START_WAIT_COMMAND,
				RUNTIME_DOCTOR_NEXT_COMMAND,
			],
			recommendations,
			recovery: {
				ensure: RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
				start: RUNTIME_START_WAIT_COMMAND,
				status: RUNTIME_STATUS_COMMAND,
				doctorNextAction: RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
				doctor: RUNTIME_DOCTOR_COMMAND,
			},
		};
	}

	// "Installed" for the purpose of recommending reload-vs-install is the CLI's disk fact, not
	// a host guess: the daemon never scans, so `installed` (the second argument) is the only
	// side that can answer "does a tree exist to reload".
	const runtimeAgentInstalled = installed.some(
		(tree) =>
			isRuntimeAgentPluginId(tree.runtimeId) ||
			(tree.manifestId !== null && isRuntimeAgentPluginId(tree.manifestId)),
	);
	const runtimeAgentLoaded =
		typeof state.defaultResponder === "string" && state.defaultResponder.length > 0;
	const nextCommands = runtimeAgentLoaded
		? []
		: [
				...(runtimeAgentInstalled
					? [PLUGIN_RELOAD_RUNTIME_AGENT_JSON_COMMAND]
					: [PLUGIN_INSTALL_JSON_COMMAND]),
				PLUGIN_STATUS_JSON_COMMAND,
			];
	const nextAction = runtimeAgentLoaded
		? null
		: runtimeAgentInstalled
			? PLUGIN_RELOAD_RUNTIME_AGENT_JSON_COMMAND
			: PLUGIN_INSTALL_COMMAND;
	return {
		command: "plugin",
		operation: "status",
		ok: runtimeAgentLoaded,
		available: true,
		// SIX FACTS, each from whoever can observe it. `requested`/`loaded` come from the host
		// (it used to report one variable under four names); `installed`/`integrity` from the
		// CLI's scan, because the daemon receives explicit paths and does not scan; `known` from
		// the static declaration (`knownPluginDescriptors`) — a bundled plugin this node is
		// supposed to carry, independent of whether it actually is; `development` from THIS
		// NODE's own config (`nodePluginDevelopmentIds`) — the declaration that waives an absent
		// integrity claim at load, surfaced so an operator can tell WHY `integrity: absent` still
		// loads instead of guessing. Rows are keyed by installed DIRECTORY (`mergePluginFacts`),
		// not by id — two trees can share a runtime id, and collapsing them would hide exactly
		// what an operator cannot currently see.
		plugins: mergePluginFacts(state, installed, known, developmentIds).map((p) => ({
			id: p.manifestId ?? p.runtimeId,
			runtimeId: p.runtimeId,
			manifestId: p.manifestId,
			dir: p.dir,
			requested: p.requested,
			loaded: p.loaded,
			installed: p.installed,
			integrity: p.integrity,
			known: p.known,
			development: p.development,
		})),
		nextAction,
		nextActions: nextCommands,
		nextCommand: nextCommands[0] ?? null,
		nextCommands,
	};
}

export function runtimePluginUnavailableRecommendations(): RuntimePluginRecommendation[] {
	return [
		{
			diagnostic: "runtime-plugin-status-unavailable",
			severity: "failure",
			summary: "The runtime plugin status endpoint is not reachable.",
			action: "Ensure the selected runtime is running, then inspect plugin status again.",
			command: RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
		},
	];
}

export async function reloadRuntimePluginCommand(
	pluginIds: string[],
	options: { json?: boolean; restartIfNeeded?: boolean; wait?: boolean } = {},
): Promise<void> {
	const requested = pluginIds.length > 0 ? pluginIds : undefined;
	if (!options.json) {
		console.log(
			requested
				? `Reloading runtime plugins: ${requested.join(", ")}`
				: "Reloading runtime plugins...",
		);
	}

	const result = await reloadRuntimePluginsAndWait(requested, {
		onDeferred(pluginId) {
			if (!options.json) {
				console.log(`  waiting for ${pluginId} to become idle...`);
			}
		},
	});

	if (!result) {
		if (options.restartIfNeeded) {
			const restart = await restartRuntimeForPluginReload(options.wait === true);
			if (restart.ok) {
				const skipped = (requested ?? []).map(normalizePluginId);
				if (options.json) {
					printJson(
						buildJsonSuccessEnvelope({
							command: "plugin",
							operation: "reload",
							nextCommand: PLUGIN_STATUS_JSON_COMMAND,
							nextCommands: [PLUGIN_STATUS_JSON_COMMAND],
							extra: {
								requested: pluginIds,
								reloaded: [],
								skipped,
								restarted: true,
								restart,
							},
						}),
					);
				} else {
					console.log(`  ✓ runtime restarted (${restart.restartCommand})`);
				}
				return;
			}
			if (options.json) {
				printJson(
					buildJsonErrorEnvelope({
						command: "plugin",
						operation: "reload",
						error: "runtime-plugin-restart-failed",
						message: "Runtime restart failed after plugin reload endpoint was unavailable.",
						nextAction: restart.failedCommand ?? RUNTIME_START_WAIT_COMMAND,
						nextCommand: restart.failedCommand ?? RUNTIME_START_WAIT_COMMAND,
						nextCommands: [
							restart.failedCommand ?? RUNTIME_START_WAIT_COMMAND,
							PLUGIN_STATUS_JSON_COMMAND,
							RUNTIME_DOCTOR_NEXT_COMMAND,
						],
						extra: {
							requested: pluginIds,
							reloaded: [],
							skipped: (requested ?? []).map(normalizePluginId),
							restarted: false,
							restart,
						},
					}),
				);
				process.exitCode = 1;
				return;
			}
			console.error(`  ✗ runtime restart failed: ${restart.failedCommand}`);
			process.exitCode = 1;
			return;
		}
		if (options.json) {
			printJson(
				buildJsonErrorEnvelope({
					command: "plugin",
					operation: "reload",
					error: "runtime-plugin-reload-unavailable",
					message: "Refarm runtime plugin reload is unavailable.",
					nextAction: RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
					nextCommand: RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
					nextCommands: [
						RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
						RUNTIME_START_WAIT_COMMAND,
						RUNTIME_DOCTOR_NEXT_COMMAND,
					],
					extra: {
						requested: pluginIds,
						recommendations: runtimePluginUnavailableRecommendations(),
					},
				}),
			);
		} else {
			console.error("Runtime plugin reload is unavailable.");
			console.error(`  Ensure runtime: ${RUNTIME_ENSURE_WAIT_NEXT_COMMAND}`);
			console.error(`  Start fallback:  ${RUNTIME_START_WAIT_COMMAND}`);
			console.error(`  Diagnose:      ${RUNTIME_DOCTOR_COMMAND}`);
		}
		process.exitCode = 1;
		return;
	}

	if (options.json) {
		if (result.skipped.length > 0) {
			const restartCommand = pluginReloadRestartCommand(pluginIds, true);
			const timedOutMessage = result.timedOut
				? "timed out before completing (consider retry or increase timeout)"
				: "require runtime restart to reload";
			if (options.restartIfNeeded) {
				const restart = await restartRuntimeForPluginReload(options.wait === true);
				if (!restart.ok) {
					printJson(
						buildJsonErrorEnvelope({
							command: "plugin",
							operation: "reload",
							error: "runtime-plugin-restart-failed",
							message: `Runtime restart failed after one or more plugins ${result.timedOut ? "timed out" : "required restart"} before reload completion.`,
							nextAction: restart.failedCommand ?? RUNTIME_START_WAIT_COMMAND,
							nextCommand: restart.failedCommand ?? RUNTIME_START_WAIT_COMMAND,
							nextCommands: [
								restart.failedCommand ?? RUNTIME_START_WAIT_COMMAND,
								PLUGIN_STATUS_JSON_COMMAND,
								RUNTIME_DOCTOR_NEXT_COMMAND,
							],
							extra: {
								requested: pluginIds,
								reloaded: result.reloaded,
								skipped: result.skipped,
								restarted: false,
								restart,
								timedOut: result.timedOut,
							},
						}),
					);
					process.exitCode = 1;
					return;
				}
				printJson(
					buildJsonSuccessEnvelope({
						command: "plugin",
						operation: "reload",
						nextCommand: PLUGIN_STATUS_JSON_COMMAND,
						nextCommands: [PLUGIN_STATUS_JSON_COMMAND],
						extra: {
							requested: pluginIds,
							reloaded: result.reloaded,
							skipped: result.skipped,
							timedOut: result.timedOut,
							restarted: true,
							restart,
						},
					}),
				);
				return;
			}
			printJson(
				buildJsonErrorEnvelope({
					command: "plugin",
					operation: "reload",
					error: "runtime-plugin-reload-partial",
					message: `One or more runtime plugins ${timedOutMessage}.`,
					nextAction: restartCommand,
					nextCommand: restartCommand,
					nextCommands: [restartCommand, PLUGIN_STATUS_JSON_COMMAND, RUNTIME_DOCTOR_NEXT_COMMAND],
					extra: {
						requested: pluginIds,
						reloaded: result.reloaded,
						skipped: result.skipped,
						timedOut: result.timedOut,
					},
				}),
			);
			process.exitCode = 1;
			return;
		}
		printJson(
			buildJsonSuccessEnvelope({
				command: "plugin",
				operation: "reload",
				nextCommand: PLUGIN_STATUS_JSON_COMMAND,
				nextCommands: [PLUGIN_STATUS_JSON_COMMAND],
				extra: {
					requested: pluginIds,
					reloaded: result.reloaded,
					skipped: result.skipped,
					timedOut: result.timedOut,
				},
			}),
		);
		return;
	}

	for (const pluginId of result.reloaded) {
		console.log(`  ✓ ${pluginId} reloaded`);
	}
	for (const pluginId of result.skipped) {
		const status = result.timedOut
			? "timed out before reload completion"
			: "requires runtime restart to reload";
		console.error(`  ✗ ${pluginId} ${status}`);
	}
	if (result.skipped.length > 0) {
		if (options.restartIfNeeded) {
			const restart = await restartRuntimeForPluginReload(options.wait === true);
			if (restart.ok) {
				console.log(`  ✓ runtime restarted (${restart.restartCommand})`);
				return;
			}
			console.error(`  ✗ runtime restart failed: ${restart.failedCommand}`);
		} else {
			console.error(`  Restart if needed: ${pluginReloadRestartCommand(pluginIds)}`);
		}
		process.exitCode = 1;
	}
	if (result.reloaded.length === 0 && result.skipped.length === 0) {
		console.log("  No plugins to reload.");
	}
}
