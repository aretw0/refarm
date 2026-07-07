import type {
	CapabilityDescriptor,
	CapabilityEnvelope,
	CapabilityGroup,
} from "@refarm.dev/cli/capabilities";
import type { CapabilitySurfaceHooks } from "./capability-commander.js";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
} from "@refarm.dev/cli/json-output";
import {
	describePermission,
	unknownPermissions,
} from "@refarm.dev/plugin-manifest";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
	PLUGIN_INSTALL_JSON_COMMAND,
	PLUGIN_STATUS_JSON_COMMAND,
} from "./plugin-handoffs.js";
import { normalizePluginId } from "@refarm.dev/config/plugin-identity";
import { buildBundleReport, type RunBundleProcess } from "./plugin-bundle.js";
import { buildInstallReport } from "./plugin-install.js";
import {
	buildPluginListReport,
	buildRuntimePluginStatusReport,
	pluginReloadRestartCommand,
	restartRuntimeForPluginReload,
	runtimePluginUnavailableRecommendations,
} from "./plugin-runtime.js";
import {
	readRuntimePluginState,
	reloadRuntimePluginsAndWait,
} from "./runtime-plugins.js";
import {
	RUNTIME_DOCTOR_NEXT_COMMAND,
	RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
	RUNTIME_START_WAIT_COMMAND,
} from "./runtime-recovery.js";
import {
	formatBundleFromEnvelope,
	formatInstallFromEnvelope,
	formatListFromEnvelope,
	formatReloadFromEnvelope,
	formatStatusFromEnvelope,
} from "./plugin-render.js";
import { pluginsBaseDir } from "../utils/refarm-home.js";
import { runProcessHandoff } from "@refarm.dev/cli/process-handoff";

/** OperatorChannel-style progress sink — run() emits progress here instead of
 *  console.log; headless/HTTP inject a no-op, the CLI injects a stderr writer. */
export type OperatorProgress = (line: string) => void;
const NOOP_PROGRESS: OperatorProgress = () => {};

/**
 * The `plugin` command as a tri-surface CapabilityGroup — the migration of the
 * legacy commander-only `pluginCommand` (plugin.ts) into the one declaration that
 * projects to CLI + REPL + HTTP + TUI, plus the NEW read-only `permissions <id>`
 * verb that finally consumes the (until now orphaned) permission vocabulary.
 *
 * Multi-surface is a first-class invariant (bigger than any one deliverable): a
 * persona manages plugins wherever they operate — a laptop on the web, a worker
 * over CLI/TUI, a baked PWA across devices. So `plugin` is declared ONCE here and
 * every surface derives from it; nothing is wired per surface by hand.
 *
 * `run()` stays pure and host-agnostic (returns an envelope, never prints);
 * side-effectful verbs inject their effects via `PluginCommandDeps` so status /
 * reload / bundle are headless-testable and the same envelope drives every
 * surface. The operator-loop handoff strings (`plugin install --json`, etc.) are
 * reprojected byte-identically because the group is named `plugin` with the same
 * sub-verb names — see plugin-handoffs.ts.
 */
export interface PluginCommandDeps {
	/** Build the installed-plugin inventory. Defaults to the bundled scan. */
	buildListReport: typeof buildPluginListReport;
	/** Read a plugin's manifest JSON by id (defaults to <plugins>/<id>/plugin.json). */
	readManifest: (id: string) => Promise<unknown>;
	/** Read runtime plugin state from the sidecar (null when unreachable). */
	readRuntimePluginState: typeof readRuntimePluginState;
	/** Install the bundled plugins; returns the byte-stable install envelope. */
	buildInstallReport: typeof buildInstallReport;
	/** Spawn the jco transpiler (the only side effect `bundle` had). */
	runBundle: RunBundleProcess;
	// ── reload ────────────────────────────────────────────────────────────────
	/** Progress sink; no-op headless/HTTP, CLI injects a writer. */
	onProgress: OperatorProgress;
	/** POST /plugins/reload + poll deferred (null when the endpoint is unavailable). */
	reloadAndWait: typeof reloadRuntimePluginsAndWait;
	/** Spawn `runtime restart [--wait]`. Injected so an HTTP handler can GATE it. */
	restartRuntime: typeof restartRuntimeForPluginReload;
}

export function defaultPluginDeps(): PluginCommandDeps {
	return {
		buildListReport: buildPluginListReport,
		readManifest: async (id) => {
			const manifestPath = path.join(pluginsBaseDir(), id, "plugin.json");
			return JSON.parse(await readFile(manifestPath, "utf-8")) as unknown;
		},
		readRuntimePluginState,
		buildInstallReport,
		runBundle: (spec) => runProcessHandoff(spec, { capture: true }),
		onProgress: NOOP_PROGRESS,
		reloadAndWait: reloadRuntimePluginsAndWait,
		restartRuntime: restartRuntimeForPluginReload,
	};
}

export function createPluginCapabilityGroup(
	deps: PluginCommandDeps = defaultPluginDeps(),
): CapabilityGroup {
	// ── list ─────────────────────────────────────────────────────────────────
	// Lifts the pure `buildPluginListReport` AS-IS; the missing→nextCommand logic
	// (previously inside listInstalledPlugins' --json branch) moves into run() so
	// the envelope is byte-identical to what the legacy command printed.
	const list: CapabilityDescriptor = {
		name: "list",
		summary: "List installed plugins and their versions",
		async run() {
			const report = await deps.buildListReport();
			const missing = report.plugins.some((plugin) => !plugin.installed);
			return buildJsonSuccessEnvelope({
				command: "plugin",
				operation: "list",
				nextCommand: missing
					? PLUGIN_INSTALL_JSON_COMMAND
					: PLUGIN_STATUS_JSON_COMMAND,
				nextCommands: missing
					? [PLUGIN_INSTALL_JSON_COMMAND, PLUGIN_STATUS_JSON_COMMAND]
					: [PLUGIN_STATUS_JSON_COMMAND],
				extra: report,
			});
		},
	};

	// ── permissions <id> ──────────────────────────────────────────────────────
	// The persona loop's first step: SEE what a plugin can do. Read-only — reads
	// the plugin's manifest, maps declared permissions through the canonical vocab
	// (describePermission, mirrored from the Rust enum) into {id,label,risk}, and
	// surfaces any permission outside the vocabulary. No approval, no write, no
	// enforcement change: purely "what this plugin requests", on every surface.
	const permissions: CapabilityDescriptor = {
		name: "permissions",
		summary: "Show the host-effect permissions a plugin declares",
		args: [{ name: "id", required: true }],
		async run(input) {
			const id = input.args.id as string;
			let manifest: { permissions?: unknown };
			try {
				manifest = (await deps.readManifest(id)) as { permissions?: unknown };
			} catch {
				return buildJsonErrorEnvelope({
					command: "plugin",
					operation: "permissions",
					error: "plugin-manifest-not-found",
					message: `No installed plugin manifest for "${id}".`,
					nextAction: "Run `plugin list` to see installed plugins.",
				});
			}
			const declared = Array.isArray(manifest.permissions)
				? manifest.permissions.filter(
						(p): p is string => typeof p === "string",
					)
				: [];
			// Known permissions rendered with their human label + risk (the approval
			// surface); anything outside the closed vocabulary is called out.
			const known = declared
				.map((permissionId) => describePermission(permissionId))
				.filter((spec): spec is NonNullable<typeof spec> => spec != null);
			return buildJsonSuccessEnvelope({
				command: "plugin",
				operation: "permissions",
				extra: {
					pluginId: id,
					permissions: known,
					unknown: unknownPermissions(declared),
				},
			});
		},
	};

	// ── status ────────────────────────────────────────────────────────────────
	// Runtime install/load state from the sidecar. `buildRuntimePluginStatusReport`
	// already returns the exact envelope the legacy command printed (command/
	// operation first), including a graceful ok:false envelope when the sidecar is
	// unreachable (state===null) — no throw, so run() is headless-safe.
	const status: CapabilityDescriptor = {
		name: "status",
		summary: "Show runtime plugin install/load state",
		async run() {
			return buildRuntimePluginStatusReport(
				await deps.readRuntimePluginState(),
			) as CapabilityEnvelope;
		},
	};

	// ── install / update ──────────────────────────────────────────────────────
	// Both lift the pure `buildInstallReport` (the loop + byte-stable envelope);
	// legacy `update` reused installBundledPlugins with force:false, so it stamps
	// the same operation:"install" — preserved here.
	const install: CapabilityDescriptor = {
		name: "install",
		summary: "Install (or force-reinstall) all bundled plugins",
		options: [
			{
				name: "force",
				short: "f",
				kind: "boolean",
				summary: "Reinstall even if already up-to-date",
			},
		],
		async run(input) {
			return (await deps.buildInstallReport({
				force: input.options.force === true,
			})) as CapabilityEnvelope;
		},
	};

	const update: CapabilityDescriptor = {
		name: "update",
		summary: "Update bundled plugins when a newer version is available",
		async run() {
			return (await deps.buildInstallReport({ force: false })) as CapabilityEnvelope;
		},
	};

	// ── bundle <input> ────────────────────────────────────────────────────────
	// Transpile a WASM component to a loadable JS bundle via jco. The pure
	// buildBundleReport keeps the 3 byte-stable branches; the jco spawn is injected.
	// On failure the child's exit code rides as the flat `exitCode` field, which the
	// exit-code hook (pluginCapabilityHooks) forwards — see the hook below.
	const bundle: CapabilityDescriptor = {
		name: "bundle",
		summary: "Transpile a WASM plugin component into a loadable JS bundle",
		args: [{ name: "input", required: true }],
		options: [
			{ name: "output", short: "o", kind: "string", summary: "Output directory" },
			{
				name: "name",
				short: "n",
				kind: "string",
				summary: "Bundle name (defaults to the input basename)",
			},
			{
				name: "dry-run",
				kind: "boolean",
				summary: "Print the transpile command without running it",
			},
		],
		async run(input) {
			return buildBundleReport({
				input: input.args.input as string,
				output: input.options.output as string | undefined,
				name: input.options.name as string | undefined,
				dryRun: Boolean(input.options["dry-run"]),
				runBundle: deps.runBundle,
			});
		},
	};

	// ── reload [pluginIds...] ─────────────────────────────────────────────────
	// The legacy reloadRuntimePluginCommand's 18 print/exit sites collapse to 7
	// single-return branches. Progress is an injected sink (deps.onProgress, no-op
	// headless); the sidecar poll and the child-process restart are injected
	// (deps.reloadAndWait / deps.restartRuntime) so an HTTP handler can gate the
	// spawn. Exit intent stays in the projector: every failure returns ok:false →
	// exit 1. The `extra` key order is preserved verbatim per branch (JSON.stringify
	// order is asserted); `requested` is always the RAW pluginIds.
	const reload: CapabilityDescriptor = {
		name: "reload",
		summary: "Reload runtime plugins (optionally restart the runtime)",
		args: [{ name: "pluginIds", variadic: true }],
		options: [
			{
				name: "restart-if-needed",
				kind: "boolean",
				summary: "Restart the runtime if plugins cannot hot-reload",
			},
			{
				name: "wait",
				kind: "boolean",
				summary: "Wait for the runtime restart to become ready",
			},
		],
		async run(input) {
			const pluginIds = (input.args.pluginIds as string[] | undefined) ?? [];
			const restartIfNeeded = input.options["restart-if-needed"] === true;
			const wait = input.options.wait === true;
			const requested = pluginIds.length > 0 ? pluginIds : undefined;

			deps.onProgress(
				requested
					? `Reloading runtime plugins: ${requested.join(", ")}`
					: "Reloading runtime plugins...",
			);

			const result = await deps.reloadAndWait(requested, {
				onDeferred(pluginId) {
					deps.onProgress(`  waiting for ${pluginId} to become idle...`);
				},
			});

			// ── reload endpoint unavailable ──────────────────────────────────────
			if (!result) {
				if (restartIfNeeded) {
					const restart = await deps.restartRuntime(wait);
					if (restart.ok) {
						return buildJsonSuccessEnvelope({
							command: "plugin",
							operation: "reload",
							nextCommand: PLUGIN_STATUS_JSON_COMMAND,
							nextCommands: [PLUGIN_STATUS_JSON_COMMAND],
							extra: {
								requested: pluginIds,
								reloaded: [],
								skipped: (requested ?? []).map(normalizePluginId),
								restarted: true,
								restart,
							},
						});
					}
					return buildJsonErrorEnvelope({
						command: "plugin",
						operation: "reload",
						error: "runtime-plugin-restart-failed",
						message:
							"Runtime restart failed after plugin reload endpoint was unavailable.",
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
					});
				}
				return buildJsonErrorEnvelope({
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
				});
			}

			// ── partial / timeout (some plugins couldn't hot-reload) ─────────────
			if (result.skipped.length > 0) {
				if (restartIfNeeded) {
					const restart = await deps.restartRuntime(wait);
					if (!restart.ok) {
						return buildJsonErrorEnvelope({
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
						});
					}
					return buildJsonSuccessEnvelope({
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
					});
				}
				const restartCommand = pluginReloadRestartCommand(pluginIds, true);
				const timedOutMessage = result.timedOut
					? "timed out before completing (consider retry or increase timeout)"
					: "require runtime restart to reload";
				return buildJsonErrorEnvelope({
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
				});
			}

			// ── full success (nothing skipped) ───────────────────────────────────
			return buildJsonSuccessEnvelope({
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
			});
		},
	};

	return {
		name: "plugin",
		summary: "Manage refarm plugins",
		actions: { list, permissions, status, install, update, bundle, reload },
		defaultAction: "list",
		transports: {
			cli: {},
			repl: {},
			http: { method: "GET", path: "/plugins" },
		},
		renderers: { tui: { section: "plugins" } },
	};
}

/**
 * Per-sub-verb surface hooks. All verbs use the projector default (exit 1 when
 * `ok === false`) EXCEPT `bundle`, which must forward jco's OWN exit code: the
 * failure envelope carries it as the flat `exitCode` field (envelopes spread
 * `extra` at top level). A successful bundle (`ok:true`) has no exitCode and must
 * exit 0 — so the hook guards on `ok` first.
 */
export function pluginCapabilityHooks(subVerb: string): CapabilitySurfaceHooks {
	switch (subVerb) {
		case "bundle":
			return {
				renderText: (envelope) => formatBundleFromEnvelope(envelope),
				exitCode: (envelope) => {
					if (envelope.ok) return 0;
					const code = (envelope as { exitCode?: number }).exitCode;
					return code && code !== 0 ? code : 1;
				},
			};
		case "status":
			return { renderText: (envelope) => formatStatusFromEnvelope(envelope) };
		case "list":
			return { renderText: (envelope) => formatListFromEnvelope(envelope) };
		case "install":
		case "update":
			return { renderText: (envelope) => formatInstallFromEnvelope(envelope) };
		case "reload":
			return {
				renderText: (envelope, input) =>
					formatReloadFromEnvelope(envelope, input),
			};
		// `permissions` has no bespoke human table → default JSON render.
		default:
			return {};
	}
}
