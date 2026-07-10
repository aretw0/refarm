import type {
	CapabilityDescriptor,
	CapabilityEnvelope,
	CapabilityGroup,
} from "@refarm.dev/capabilities";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
} from "@refarm.dev/capabilities/envelope";
import {
	describePermission,
	unknownPermissions,
	type PluginPolicyMode,
} from "@refarm.dev/plugin-manifest";
import type { LedgerScope } from "@refarm.dev/storage-node-view";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CapabilitySurfaceHooks } from "./capability-commander.js";

import {
	approvalConfigPath,
	setApprovedPermissions,
	type ApprovalResult,
} from "./plugin-approval.js";
import {
	revocationConfigPath,
	revoke,
	unrevoke,
	type RevocationResult,
} from "./plugin-revocation.js";

import { runProcessHandoff } from "@refarm.dev/cli/process-handoff";
import { normalizePluginId } from "@refarm.dev/config/plugin-identity";
import os from "node:os";
import { pluginsBaseDir } from "../utils/refarm-home.js";
import { buildBundleReport, type RunBundleProcess } from "./plugin-bundle.js";
import {
	PLUGIN_INSTALL_JSON_COMMAND,
	PLUGIN_STATUS_JSON_COMMAND,
} from "./plugin-handoffs.js";
import { buildExtensionInstallReport } from "./plugin-install-from-path.js";
import { buildUrlInstallReport } from "./plugin-install-from-url.js";
import { buildInstallReport } from "./plugin-install.js";
import {
	formatBundleFromEnvelope,
	formatInstallFromEnvelope,
	formatListFromEnvelope,
	formatReloadFromEnvelope,
	formatStatusFromEnvelope,
} from "./plugin-render.js";
import {
	buildExtensionReviewReport,
	type ExtensionReviewReport,
} from "./plugin-review-capability.js";
import {
	buildPluginListReport,
	buildRuntimePluginStatusReport,
	pluginReloadRestartCommand,
	restartRuntimeForPluginReload,
	runtimePluginUnavailableRecommendations,
} from "./plugin-runtime.js";
import {
	buildCreatedPluginReport,
	type CreatedExtensionReport,
} from "./plugin-scaffold.js";
import {
	detectPluginOrigin,
	pluginIdToFsToken,
	type BundledPlugin,
	type PluginOrigin,
} from "./plugin-shared.js";
import {
	readRuntimePluginState,
	reloadRuntimePluginsAndWait,
} from "./runtime-plugins.js";
import {
	RUNTIME_DOCTOR_NEXT_COMMAND,
	RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
	RUNTIME_START_WAIT_COMMAND,
} from "./runtime-recovery.js";

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
	/**
	 * The bundled plugin set this app ships (ADR-086 white-label seam). Undefined =
	 * refarm's own `BUNDLED_PLUGINS`; a white-label app passes ITS descriptors so
	 * `plugin list --origin bundled` and `plugin install --bundled` reflect the
	 * app's plugins, not refarm's. Flows through to the list + install builders.
	 */
	bundledPlugins?: readonly BundledPlugin[];
	/** Spawn the jco transpiler (the only side effect `bundle` had). */
	runBundle: RunBundleProcess;
	// ── reload ────────────────────────────────────────────────────────────────
	/** Progress sink; no-op headless/HTTP, CLI injects a writer. */
	onProgress: OperatorProgress;
	/** POST /plugins/reload + poll deferred (null when the endpoint is unavailable). */
	reloadAndWait: typeof reloadRuntimePluginsAndWait;
	/** Spawn `runtime restart [--wait]`. Injected so an HTTP handler can GATE it. */
	restartRuntime: typeof restartRuntimeForPluginReload;
	// ── approve ───────────────────────────────────────────────────────────────
	/** Persist the operator-approved capability set for a plugin (scope-resolved). */
	persistApproval: typeof setApprovedPermissions;
	// ── revoke / unrevoke (G) ──────────────────────────────────────────────────
	/** Append an add-only revocation (monotonic; the host materializes a tombstone). */
	persistRevocation: typeof revoke;
	/** Append an add-only un-revoke (annulment; bumps the seq above the revoke). */
	persistUnrevocation: typeof unrevoke;
}

/** The closed `PluginOrigin` vocabulary, as `--origin` values (ADR-086). */
const PLUGIN_ORIGINS: readonly PluginOrigin[] = [
	"local",
	"installed",
	"bundled",
	"npm",
	"git",
	"url",
];

/** Parse a `--origin` value: undefined ⇒ no filter; a known origin ⇒ that filter;
 *  anything else ⇒ a loud error (loud > silent, CLAUDE.md). */
function parsePluginOrigin(value: unknown): {
	value?: PluginOrigin;
	error?: string;
} {
	if (value === undefined) return {};
	if (
		typeof value === "string" &&
		(PLUGIN_ORIGINS as readonly string[]).includes(value)
	) {
		return { value: value as PluginOrigin };
	}
	return {
		error: `--origin must be one of: ${PLUGIN_ORIGINS.join(", ")}`,
	};
}

export function defaultPluginDeps(): PluginCommandDeps {
	return {
		buildListReport: buildPluginListReport,
		readManifest: async (id) => {
			const manifestPath = path.join(
				pluginsBaseDir(),
				pluginIdToFsToken(id),
				"plugin.json",
			);
			return JSON.parse(await readFile(manifestPath, "utf-8")) as unknown;
		},
		readRuntimePluginState,
		buildInstallReport,
		runBundle: (spec) => runProcessHandoff(spec, { capture: true }),
		onProgress: NOOP_PROGRESS,
		reloadAndWait: reloadRuntimePluginsAndWait,
		restartRuntime: restartRuntimeForPluginReload,
		persistApproval: setApprovedPermissions,
		persistRevocation: revoke,
		persistUnrevocation: unrevoke,
	};
}

export function createPluginCapabilityGroup(
	deps: PluginCommandDeps = defaultPluginDeps(),
): CapabilityGroup {
	// ── list ─────────────────────────────────────────────────────────────────
	// Unified inventory over the origin axis (ADR-086): bundled + local plugins,
	// each origin-tagged; `--origin` filters to one provenance. The missing→
	// nextCommand logic stays here so the no-filter envelope is byte-compatible
	// with what the legacy command printed.
	const list: CapabilityDescriptor = {
		name: "list",
		summary: "List plugins (bundled + local); --origin filters by provenance",
		options: [
			{
				name: "origin",
				kind: "string",
				summary:
					"Filter by provenance: local | installed | bundled | npm | git | url",
			},
		],
		async run(input) {
			const origin = parsePluginOrigin(input.options.origin);
			if (origin.error) {
				return buildJsonErrorEnvelope({
					command: "plugin",
					operation: "list",
					error: "invalid-origin",
					message: origin.error,
					nextAction: "Run `refarm plugin list --help`.",
				});
			}
			const report = await deps.buildListReport({
				...(origin.value ? { origin: origin.value } : {}),
				bundled: deps.bundledPlugins,
			});
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

	// ── new <name> ────────────────────────────────────────────────────────────
	// Authoring scaffold (ADR-086): create a local plugin under .refarm/extensions/.
	// Lifts the shared buildCreatedPluginReport (validation + fs writes + report,
	// returns-an-envelope not fs-free) with commandName:"plugin" so the report + list
	// handoff name THIS verb. cwd/homeDir come from process here; the builder itself
	// takes them injected so it stays testable over a tmpdir.
	const newPlugin: CapabilityDescriptor = {
		name: "new",
		summary: "Scaffold a new local plugin in .refarm/extensions/<name>/",
		args: [{ name: "name", required: true }],
		options: [
			{
				name: "global",
				short: "g",
				kind: "boolean",
				summary: "Create in ~/.refarm/extensions/ (available in all projects)",
			},
			{
				name: "verb",
				kind: "string",
				summary:
					"Declare a dispatchable verb (bare 'open' -> <name>:open, surfaces as <name>-open)",
			},
		],
		async run(input) {
			return (await buildCreatedPluginReport({
				name: input.args.name as string,
				isGlobal: input.options.global === true,
				verb: input.options.verb as string | undefined,
				cwd: process.cwd(),
				homeDir: os.homedir(),
				commandName: "plugin",
			})) as CapabilityEnvelope;
		},
	};

	// ── review <path> ─────────────────────────────────────────────────────────
	// Authoring gate (ADR-086): review a prepared plugin against a capability grant
	// BEFORE installing. Lifts the shared, host-agnostic buildExtensionReviewReport
	// AS-IS (same policy engine the legacy `extension review` used) — passing
	// commandName:"plugin" so the envelope + install handoff name THIS verb. run()
	// stays pure over the builder; nothing is installed here.
	const review: CapabilityDescriptor = {
		name: "review",
		summary:
			"Review a prepared plugin against a capability grant (review-first; installs nothing)",
		args: [{ name: "path", required: true }],
		options: [
			{
				name: "grant",
				kind: "string[]",
				summary:
					"Grant a capability for this review (repeatable); default grants none",
			},
			{
				name: "policy",
				kind: "string",
				summary: "Policy mode: fail-fast or warn+continue",
				defaultValue: "fail-fast",
			},
		],
		run(input) {
			const policy = input.options.policy;
			if (
				policy !== undefined &&
				policy !== "fail-fast" &&
				policy !== "warn+continue"
			) {
				return buildJsonErrorEnvelope({
					command: "plugin",
					operation: "review",
					error: "plugin_review_failed",
					message: "--policy must be fail-fast or warn+continue",
					nextAction: "Run `refarm plugin review --help`.",
				});
			}
			try {
				return buildExtensionReviewReport({
					targetPath: input.args.path as string,
					grantedCapabilities: (input.options.grant as string[]) ?? [],
					policyMode: (policy as PluginPolicyMode) ?? "fail-fast",
					commandName: "plugin",
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return buildJsonErrorEnvelope({
					command: "plugin",
					operation: "review",
					error: "plugin_review_failed",
					message,
					nextAction:
						"Run `refarm plugin review --help`; point at a prepared plugin directory or manifest.",
				});
			}
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
		summary:
			"Install a plugin from <ref> (origin detected), or --bundled to sync all bundled",
		args: [{ name: "ref", required: false }],
		options: [
			{
				name: "bundled",
				kind: "boolean",
				summary: "Sync ALL bundled plugins (the default when no <ref> is given)",
			},
			{
				name: "force",
				short: "f",
				kind: "boolean",
				summary: "For --bundled: reinstall even if already up-to-date",
			},
			{
				name: "grant",
				kind: "string[]",
				summary:
					"For a <ref>: grant a capability for this install (repeatable)",
			},
			{
				name: "policy",
				kind: "string",
				summary: "For a <ref>: policy mode: fail-fast or warn+continue",
				defaultValue: "fail-fast",
			},
		],
		async run(input) {
			const ref = input.args.ref as string | undefined;
			const bundled = input.options.bundled === true;

			// --bundled and a positional <ref> are distinct intents (sync the fixed
			// set vs install one unit); asking for both is an error, not a merge.
			if (bundled && ref) {
				return buildJsonErrorEnvelope({
					command: "plugin",
					operation: "install",
					error: "install-ambiguous",
					message:
						"Pass either a <ref> to install one plugin OR --bundled to sync all bundled plugins, not both.",
					nextAction: "Run `refarm plugin install --help`.",
				});
			}

			// No ref (or explicit --bundled): the mass-sync of bundled plugins,
			// preserving today's `plugin install` behavior byte-for-byte.
			if (!ref) {
				return (await deps.buildInstallReport({
					force: input.options.force === true,
					bundled: deps.bundledPlugins,
				})) as CapabilityEnvelope;
			}

			// A ref: its shape selects the origin. `local` (a reviewed path) and `url`
			// (a content-addressed descriptor, ADR-086 Fase 7) are materializable;
			// npm/git are recognized and routed to a loud not-wired envelope (never a
			// silent no-op that pretends coverage — ADR-086).
			const origin = detectPluginOrigin(ref);
			if (origin === "local") {
				const policy = input.options.policy;
				if (
					policy !== undefined &&
					policy !== "fail-fast" &&
					policy !== "warn+continue"
				) {
					return buildJsonErrorEnvelope({
						command: "plugin",
						operation: "install",
						error: "invalid-policy",
						message: "--policy must be fail-fast or warn+continue",
						nextAction: "Run `refarm plugin install --help`.",
					});
				}
				return (await buildExtensionInstallReport({
					targetPath: ref,
					grantedCapabilities: (input.options.grant as string[]) ?? [],
					policyMode: (policy as "fail-fast" | "warn+continue") ?? "fail-fast",
					commandName: "plugin",
				})) as CapabilityEnvelope;
			}

			// url: fetch a plugin descriptor, verify the wasm against its declared
			// content-address (the hash gate), then content-store + install. Safe from
			// an untrusted URL by construction — tampered bytes are rejected, not run.
			if (origin === "url") {
				return (await buildUrlInstallReport({ url: ref })) as CapabilityEnvelope;
			}

			return buildJsonErrorEnvelope({
				command: "plugin",
				operation: "install",
				error: "resolver-not-wired",
				message: `Installing from a ${origin} reference ("${ref}") is not wired yet. Today a local path, a url descriptor, and --bundled are supported.`,
				nextAction:
					"Install a local prepared plugin by path, a url descriptor, or `refarm plugin install --bundled`.",
				extra: { origin, ref },
			});
		},
	};

	const update: CapabilityDescriptor = {
		name: "update",
		summary: "Update bundled plugins when a newer version is available",
		async run() {
			return (await deps.buildInstallReport({
				force: false,
				bundled: deps.bundledPlugins,
			})) as CapabilityEnvelope;
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

	// ── approve <id> --approve <cap>... ───────────────────────────────────────
	// The persona loop's write step: the operator APPROVES (a subset of) the
	// permissions a plugin declares. Persists the approved set to the sovereign
	// .refarm/config.json (the same file the host reads at load), keyed by plugin
	// id, on a SEPARATE key from trusted_plugins (identity ⊥ capability). The host
	// (a follow-on slice) intersects declared ∩ approved, so approving fewer
	// capabilities actually restricts.
	//
	// Surface-neutral + headless by design (the multi-surface invariant): approval
	// intent is the `--approve <cap>` flag (repeatable) or `--deny` — no TTY prompt,
	// so CLI / TUI / HTTP / a PWA all drive it through the same envelope. An
	// interactive surface renders the plugin's permissions (via `permissions <id>`)
	// and collects the flags; run() only persists the already-parsed decision.
	const approve: CapabilityDescriptor = {
		name: "approve",
		summary: "Approve the host-effect permissions a plugin may use",
		args: [{ name: "id", required: true }],
		options: [
			{
				name: "approve",
				kind: "string[]",
				summary: "Grant this declared capability (repeatable)",
			},
			{ name: "deny", kind: "boolean", summary: "Revoke all approved capabilities" },
			{
				name: "scope",
				kind: "string",
				summary: "Config scope to persist to: user | workspace | org",
				defaultValue: "user",
			},
		],
		async run(input) {
			const id = input.args.id as string;
			const scopeRaw = (input.options.scope as string) ?? "user";
			if (scopeRaw !== "user" && scopeRaw !== "workspace" && scopeRaw !== "org") {
				return buildJsonErrorEnvelope({
					command: "plugin",
					operation: "approve",
					error: "unknown-scope",
					message: `Unknown scope "${scopeRaw}". Use user, workspace, or org.`,
					nextAction: "Retry with --scope user|workspace|org.",
				});
			}
			const scope = scopeRaw as LedgerScope;

			// Read the plugin's DECLARED permissions — you can only approve what the
			// plugin asked for. Manifest absent → nothing to approve against.
			let declared: string[];
			try {
				const manifest = (await deps.readManifest(id)) as {
					permissions?: unknown;
				};
				declared = Array.isArray(manifest.permissions)
					? manifest.permissions.filter((p): p is string => typeof p === "string")
					: [];
			} catch {
				return buildJsonErrorEnvelope({
					command: "plugin",
					operation: "approve",
					error: "plugin-manifest-not-found",
					message: `No installed plugin manifest for "${id}".`,
					nextAction: "Run `plugin list` to see installed plugins.",
				});
			}

			const deny = Boolean(input.options.deny);
			const requested = deny
				? []
				: ((input.options.approve as string[] | undefined) ?? []);

			// Every approved capability must be one the plugin DECLARED (approving a
			// capability the plugin never asked for is meaningless — the host only
			// grants declared ∩ approved).
			const notDeclared = requested.filter((c) => !declared.includes(c));
			if (notDeclared.length > 0) {
				return buildJsonErrorEnvelope({
					command: "plugin",
					operation: "approve",
					error: "capability-not-declared",
					message: `Plugin "${id}" does not declare: ${notDeclared.join(", ")}.`,
					nextAction: `Run \`plugin permissions ${id}\` to see what it declares.`,
				});
			}

			const filePath = approvalConfigPath(scope);
			if (!filePath) {
				return buildJsonErrorEnvelope({
					command: "plugin",
					operation: "approve",
					error: "scope-unavailable",
					message: `The ${scope} scope is not available.`,
					nextAction: "Set REFARM_ORG_HOME for org scope, or use --scope user.",
				});
			}

			const result: ApprovalResult = deps.persistApproval(
				filePath,
				id,
				requested,
			);
			// Render the approved set with its human labels + risk (the vocab).
			const approvedSpecs = result.approved
				.map((cap) => describePermission(cap))
				.filter((spec): spec is NonNullable<typeof spec> => spec != null);

			return buildJsonSuccessEnvelope({
				command: "plugin",
				operation: "approve",
				nextCommand: PLUGIN_STATUS_JSON_COMMAND,
				nextCommands: [PLUGIN_STATUS_JSON_COMMAND],
				extra: {
					pluginId: id,
					scope,
					approved: approvedSpecs,
					changed: result.changed,
				},
			});
		},
	};

		// Shared run() for revoke + unrevoke — same shape (validate scope → resolve
		// path → persist via the injected add-only primitive → envelope). `operation`
		// names the verb; `persist` is the primitive (revoke or unrevoke).
		const revocationRun = async (
			input: { args: Record<string, unknown>; options: Record<string, unknown> },
			operation: "revoke" | "unrevoke",
			persist: typeof revoke,
		) => {
			const id = input.args.id as string;
			const scopeRaw = (input.options.scope as string) ?? "user";
			if (scopeRaw !== "user" && scopeRaw !== "workspace" && scopeRaw !== "org") {
				return buildJsonErrorEnvelope({
					command: "plugin",
					operation,
					error: "unknown-scope",
					message: `Unknown scope "${scopeRaw}". Use user, workspace, or org.`,
					nextAction: "Retry with --scope user|workspace|org.",
				});
			}
			const scope = scopeRaw as LedgerScope;
			const capability = (input.options.cap as string | undefined) ?? null;

			const filePath = revocationConfigPath(scope);
			if (!filePath) {
				return buildJsonErrorEnvelope({
					command: "plugin",
					operation,
					error: "scope-unavailable",
					message: `The ${scope} scope is not available.`,
					nextAction: "Set REFARM_ORG_HOME for org scope, or use --scope user.",
				});
			}

			const result: RevocationResult = persist(filePath, id, capability);
			return buildJsonSuccessEnvelope({
				command: "plugin",
				operation,
				nextCommand: PLUGIN_STATUS_JSON_COMMAND,
				nextCommands: [PLUGIN_STATUS_JSON_COMMAND],
				extra: {
					pluginId: id,
					scope,
					capability: result.capability,
					changed: result.changed,
				},
			});
		};

		// ── revoke <id> [--cap <c>] [--scope] ──────────────────────────────────────
		// The monotonic counterpart to approve --deny: writes an add-only revocation
		// the host materializes into a graph tombstone. Unlike approve, a revoked id/cap
		// is denied even under a `*` wildcard, and a stale device can't resurrect it.
		const revokeVerb: CapabilityDescriptor = {
			name: "revoke",
			summary: "Revoke a plugin (or one capability) — monotonic, denies even under wildcard",
			args: [{ name: "id", required: true }],
			options: [
				{
					name: "cap",
					kind: "string",
					summary: "Revoke only this capability (default: the whole plugin)",
				},
				{
					name: "scope",
					kind: "string",
					summary: "Config scope to persist to: user | workspace | org",
					defaultValue: "user",
				},
			],
			async run(input) {
				return revocationRun(input, "revoke", deps.persistRevocation);
			},
		};

		// ── unrevoke <id> [--cap <c>] [--scope] ────────────────────────────────────
		// The reversible counterpart: writes an add-only annulment (bumps the seq above
		// the revoke), so the plugin/cap is re-admitted at the next load/reload. Nothing
		// is removed; a later re-revoke bumps back and denies again.
		const unrevokeVerb: CapabilityDescriptor = {
			name: "unrevoke",
			summary: "Un-revoke a plugin (or one capability) — reversible, re-admits at reload",
			args: [{ name: "id", required: true }],
			options: [
				{
					name: "cap",
					kind: "string",
					summary: "Un-revoke only this capability (default: the whole plugin)",
				},
				{
					name: "scope",
					kind: "string",
					summary: "Config scope to persist to: user | workspace | org",
					defaultValue: "user",
				},
			],
			async run(input) {
				return revocationRun(input, "unrevoke", deps.persistUnrevocation);
			},
		};

	return {
		name: "plugin",
		summary: "Manage refarm plugins",
		actions: {
			list,
			new: newPlugin,
			review,
			permissions,
			status,
			install,
			update,
			bundle,
			reload,
			approve,
			revoke: revokeVerb,
			unrevoke: unrevokeVerb,
		},
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
		case "new":
			return {
				renderText(envelope) {
					if (envelope.ok === false) {
						return `Plugin scaffold failed: ${(envelope as { message?: string }).message ?? "unknown error"}`;
					}
					const report = envelope as unknown as CreatedExtensionReport;
					const lines = [
						`Created plugin '${report.slug}' at ${report.dir} (${report.scope})`,
						`  id: ${report.id}`,
						`  Edit: ${report.indexPath}`,
					];
					if (report.surfaceCommand) lines.push(`  Surface: ${report.surfaceCommand}`);
					lines.push(`  Activate: ${report.nextActions[0]}`);
					if (report.nextActions[1]) lines.push(`  Fallback: ${report.nextActions[1]}`);
					return lines.join("\n");
				},
				exitCode: (envelope) => (envelope.ok === false ? 1 : 0),
			};
		case "review":
			// Same shape as the legacy extension-review hook, relabelled for the verb:
			// the report is the shared ExtensionReviewReport (one builder, ADR-086).
			return {
				renderText(envelope) {
					if (envelope.ok === false) {
						return `Plugin review failed: ${(envelope as { message?: string }).message ?? "unknown error"}`;
					}
					const report = envelope as ExtensionReviewReport;
					const { decision, deniedCapabilities, readyToInstall } = report;
					const lines = [
						`Plugin review: ${decision.pluginId ?? "unknown"} — ${decision.status} (policy: ${decision.policyMode})`,
					];
					if (!decision.manifestValid) {
						for (const err of decision.manifestErrors) {
							lines.push(`  manifest error: ${err}`);
						}
					}
					if (deniedCapabilities.length > 0) {
						lines.push(
							`  denied capabilities (not granted): ${deniedCapabilities.join(", ")}`,
						);
					}
					lines.push(
						`  ready to install: ${readyToInstall ? "yes" : "no — review required"}`,
					);
					return lines.join("\n");
				},
				exitCode(envelope) {
					if (envelope.ok === false) return 1;
					return (envelope as ExtensionReviewReport).readyToInstall ? 0 : 1;
				},
			};
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
