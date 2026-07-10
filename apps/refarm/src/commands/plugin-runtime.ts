import { resolvePluginPackage } from "@refarm.dev/barn";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	printJson,
} from "@refarm.dev/capabilities/envelope";
import { quoteCommandArgIfNeeded, refarmCommand, refarmProcess } from "@refarm.dev/cli/command-handoff";
import { runProcessHandoff } from "@refarm.dev/cli/process-handoff";
import {
	isRuntimeAgentPluginId, normalizePluginId,
	RUNTIME_AGENT_PLUGIN_ID,
} from "@refarm.dev/config/plugin-identity";
import os from "node:os";
import { listExtensions } from "./extension-scaffold.js";
import {
	PLUGIN_INSTALL_COMMAND,
	PLUGIN_INSTALL_JSON_COMMAND,
	PLUGIN_STATUS_JSON_COMMAND,
} from "./plugin-handoffs.js";
import {
	BUNDLED_PLUGINS,
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
export async function buildPluginListReport(
	options: { origin?: PluginOrigin } = {},
): Promise<PluginListReport> {
	const wanted = options.origin;
	const plugins: PluginListEntry[] = [];

	// bundled — shipped with refarm, resolved from node_modules/workspace.
	if (wanted === undefined || wanted === "bundled") {
		for (const plugin of BUNDLED_PLUGINS) {
			const version = await readInstalledVersion(plugin.id);
			const resolution = resolvePluginPackage(plugin, {
				baseUrl: import.meta.url,
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
		console.log("No plugins installed. Run 'refarm plugin install' to install bundled plugins.");
		return;
	}

	const idWidth = Math.max(...results.map((r) => r.id.length), 4);
	const verWidth = Math.max(...results.map((r) => (r.version ?? "not installed").length), 7);
	const sourceWidth = Math.max(
		...results.map((r) => `${r.source}/${r.packageSource}`.length),
		6,
	);

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

export function buildRuntimePluginStatusReport(
	state: Awaited<ReturnType<typeof readRuntimePluginState>>,
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

	const known =
		state.known.length > 0 ? state.known : BUNDLED_PLUGINS.map((p) => p.id);
	const runtimeAgentInstalled = state.installed.some(isRuntimeAgentPluginId);
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
		plugins: known.map((id) => ({
			id,
			installed: state.installed.includes(id),
			loaded: state.loaded.includes(id),
			local: state.local.includes(id),
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

export async function printRuntimePluginStatus(options: { json?: boolean } = {}): Promise<void> {
	const state = await readRuntimePluginState();
	const report = buildRuntimePluginStatusReport(state);
	if (options.json) {
		printJson(report);
		if (!report.ok) process.exitCode = 1;
		return;
	}

	if (!state) {
		console.error("Refarm runtime plugin status is unavailable.");
		console.error(`Ensure runtime readiness with \`${RUNTIME_ENSURE_WAIT_NEXT_COMMAND}\`, then retry.`);
		console.error(`Fallback start command: \`${RUNTIME_START_WAIT_COMMAND}\`.`);
		console.error(`Inspect runtime readiness with \`${RUNTIME_STATUS_COMMAND}\`.`);
		console.error(`Next recovery action: \`${RUNTIME_DOCTOR_NEXT_ACTION_COMMAND}\`.`);
		console.error(`Diagnose readiness with \`${RUNTIME_DOCTOR_COMMAND}\`.`);
		process.exitCode = 1;
		return;
	}

	const known = report.plugins.map((plugin) => plugin.id);
	const idWidth = Math.max(...known.map((id) => id.length), 6);

	console.log(`  ${"PLUGIN".padEnd(idWidth)}  INSTALLED  LOADED  LOCAL`);
	for (const plugin of report.plugins) {
		const installed = plugin.installed ? "yes" : "no";
		const loaded = plugin.loaded ? "yes" : "no";
		const local = plugin.local ? "yes" : "no";
		console.log(
			`  ${plugin.id.padEnd(idWidth)}  ${installed.padEnd(9)}  ${loaded.padEnd(6)}  ${local}`,
		);
	}

	if (!report.plugins.some((plugin) => plugin.id === RUNTIME_AGENT_PLUGIN_ID && plugin.loaded)) {
		console.log("");
		console.log("Runtime agent plugin is not loaded.");
		console.log(`  Install:  ${PLUGIN_INSTALL_COMMAND}`);
		console.log(`  Reload:   ${PLUGIN_RELOAD_RUNTIME_AGENT_JSON_COMMAND}`);
		console.log("  Ask:      refarm ask hello");
		console.log(`  Diagnose: ${RUNTIME_DOCTOR_COMMAND}`);
	}
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
					nextCommands: [
						restartCommand,
						PLUGIN_STATUS_JSON_COMMAND,
						RUNTIME_DOCTOR_NEXT_COMMAND,
					],
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
			console.error(
				`  Restart if needed: ${pluginReloadRestartCommand(pluginIds)}`,
			);
		}
		process.exitCode = 1;
	}
	if (result.reloaded.length === 0 && result.skipped.length === 0) {
		console.log("  No plugins to reload.");
	}
}
