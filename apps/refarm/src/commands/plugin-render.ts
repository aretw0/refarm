// Human projections of the `plugin` group envelopes — the surface layer.
//
// Canonical separation (mirrors model/health): a verb's run() returns the JSON
// envelope (the machine contract); THIS file projects that envelope to a human
// string for the non-JSON CLI surface, via the renderText hooks in
// pluginCapabilityHooks. Each fn reads ONLY the envelope — it never reruns
// business logic. The projector prints the returned string on the non-JSON path;
// `--json` prints the envelope instead. Kept out of plugin-capability.ts so the
// group declaration stays lean and these projections have one test target.

import chalk from "chalk";

import type { CapabilityEnvelope, CapabilityInput } from "@refarm.dev/capabilities";
import { RUNTIME_AGENT_PLUGIN_ID } from "@refarm.dev/config/plugin-identity";
import { renderCapabilityError } from "./capability-commander.js";
import { describeModelRateCatalog } from "./model-rate-catalog.js";
import { PACKAGE_MANAGER_OVERRIDE, PACKAGE_MANAGERS } from "./package-manager.js";
import { PLUGIN_INSTALL_COMMAND } from "./plugin-handoffs.js";
import {
	PLUGIN_RELOAD_RUNTIME_AGENT_JSON_COMMAND,
	type PluginInstallReport,
	type PluginListReport,
	type RuntimePluginStatusReport,
} from "./plugin-shared.js";
import {
	RUNTIME_DOCTOR_COMMAND,
	RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
	RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
	RUNTIME_START_WAIT_COMMAND,
	RUNTIME_STATUS_COMMAND,
} from "./runtime-recovery.js";

const PACKAGE_MANAGER_OVERRIDE_HELP = PACKAGE_MANAGERS.join("|");

// ── status ────────────────────────────────────────────────────────────────
/** Human projection of the `plugin status` envelope (the runtime plugin table +
 *  the not-loaded recovery block). Reads only the envelope. */
export function formatStatusFromEnvelope(envelope: CapabilityEnvelope): string {
	const report = envelope as unknown as RuntimePluginStatusReport;

	if (!report.available) {
		const r = report.recovery ?? {
			ensure: RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
			start: RUNTIME_START_WAIT_COMMAND,
			status: RUNTIME_STATUS_COMMAND,
			doctorNextAction: RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
			doctor: RUNTIME_DOCTOR_COMMAND,
		};
		return [
			"Refarm runtime plugin status is unavailable.",
			`Ensure runtime readiness with \`${r.ensure}\`, then retry.`,
			`Fallback start command: \`${r.start}\`.`,
			`Inspect runtime readiness with \`${r.status}\`.`,
			`Next recovery action: \`${r.doctorNextAction}\`.`,
			`Diagnose readiness with \`${r.doctor}\`.`,
		].join("\n");
	}

	const idWidth = Math.max(...report.plugins.map((p) => p.id.length), 6);
	const lines: string[] = [`  ${"PLUGIN".padEnd(idWidth)}  INSTALLED  LOADED  LOCAL`];
	for (const plugin of report.plugins) {
		const installed = plugin.installed ? "yes" : "no";
		const loaded = plugin.loaded ? "yes" : "no";
		const local = plugin.local ? "yes" : "no";
		lines.push(
			`  ${plugin.id.padEnd(idWidth)}  ${installed.padEnd(9)}  ${loaded.padEnd(6)}  ${local}`,
		);
	}

	// Not-loaded block — predicate is the runtime-agent plugin's loaded flag, not
	// envelope.ok (reproduced verbatim).
	if (!report.plugins.some((p) => p.id === RUNTIME_AGENT_PLUGIN_ID && p.loaded)) {
		lines.push("");
		lines.push("Runtime agent plugin is not loaded.");
		lines.push(`  Install:  ${PLUGIN_INSTALL_COMMAND}`);
		lines.push(`  Reload:   ${PLUGIN_RELOAD_RUNTIME_AGENT_JSON_COMMAND}`);
		lines.push("  Ask:      refarm ask hello");
		lines.push(`  Diagnose: ${RUNTIME_DOCTOR_COMMAND}`);
	}

	return lines.join("\n");
}

// ── list ──────────────────────────────────────────────────────────────────
/** Human projection of the `plugin list` envelope (the inventory table). */
export function formatListFromEnvelope(envelope: CapabilityEnvelope): string {
	const results = (envelope as unknown as PluginListReport).plugins;
	if (results.length === 0) {
		return `No plugins installed. Run '${PLUGIN_INSTALL_COMMAND}' to install bundled plugins.`;
	}

	const idWidth = Math.max(...results.map((r) => r.id.length), 4);
	const verWidth = Math.max(...results.map((r) => (r.version ?? "not installed").length), 7);
	const sourceWidth = Math.max(...results.map((r) => `${r.source}/${r.packageSource}`.length), 6);

	const lines: string[] = [
		`  ${"PLUGIN".padEnd(idWidth)}  ${"VERSION".padEnd(verWidth)}  ${"SOURCE".padEnd(sourceWidth)}  PACKAGE`,
	];
	for (const { id, version, source, packageSource, packageDir } of results) {
		const ver = version ?? "not installed";
		const sourceLabel = `${source}/${packageSource}`;
		lines.push(
			`  ${id.padEnd(idWidth)}  ${ver.padEnd(verWidth)}  ${sourceLabel.padEnd(sourceWidth)}  ${packageDir ?? "-"}`,
		);
	}
	return lines.join("\n");
}

// ── install / update ────────────────────────────────────────────────────────
/** Human projection of the `plugin install`/`update` envelope — per-plugin result
 *  lines read back from extra.plugins[].
 *
 *  CANONICAL SHIFT (deliberate): the old code printed LIVE progress as a side
 *  effect of the install loop; run() now installs quietly, so this SUMMARIZES the
 *  result from the (byte-identical) envelope. The line shapes below are exactly
 *  the ones the install loop emitted per plugin. */
export function formatInstallFromEnvelope(envelope: CapabilityEnvelope): string {
	// Two envelope shapes flow through `plugin install` (ADR-086): the bundled
	// sync (`{ plugins: [...] }`) and a single local install (`{ pluginId, … }`).
	// An error envelope (ok:false) has neither. Detect and render each.
	if (envelope.ok === false) {
		return chalk.red(`  ✗ ${(envelope as { message?: string }).message ?? "install failed"}`);
	}
	const single = envelope as unknown as {
		pluginId?: string;
		installedFrom?: string;
		installedTo?: string;
		integrity?: string;
		bytes?: number;
	};
	if (single.pluginId && single.installedTo) {
		return chalk.green(
			`  ✓ ${single.pluginId} installed (${single.bytes ?? 0} bytes)\n` +
				`    from: ${single.installedFrom}\n` +
				`    to:   ${single.installedTo}\n` +
				`    integrity: ${single.integrity}`,
		);
	}
	const report = envelope as unknown as PluginInstallReport;
	const lines = (report.plugins ?? []).map((p) => {
		switch (p.status) {
			case "installed":
				return chalk.green(
					`  ✓ ${p.id} v${p.version} installed from ${p.packageSource} (${p.bytes} bytes)`,
				);
			case "cached":
				return chalk.green(`  ✓ ${p.id} v${p.version} already up-to-date`);
			default:
				return chalk.red(`  ✗ ${p.id}: ${p.message}`);
		}
	});
	// The same pass materialises the runtime's rate catalog. It used to be reported ONLY
	// in `--json`, so a node running last month's prices — or holding back an update
	// because someone edited the catalog — was invisible to the human who ran the command.
	const catalog = formatModelRateCatalogLine(report.modelRateCatalog);
	if (catalog) lines.push(catalog);
	return lines.join("\n");
}

/** Colour the one catalog line by what it means: taken, held back, or missing. `kept`
 *  renders nothing, so the ordinary start stays quiet. */
function formatModelRateCatalogLine(
	result: PluginInstallReport["modelRateCatalog"],
): string | null {
	if (!result) return null;
	const line = describeModelRateCatalog(result);
	if (!line) return null;
	switch (result.status) {
		case "materialized":
		case "updated":
			return chalk.green(line);
		case "edited":
		case "unknown":
			return chalk.yellow(line);
		default:
			return chalk.red(line);
	}
}

// ── bundle ──────────────────────────────────────────────────────────────────
/** Human projection of the `plugin bundle` envelope (dry-run plan / success /
 *  failure). run() already spawned via deps.runBundle, so this is a summary. */
export function formatBundleFromEnvelope(envelope: CapabilityEnvelope): string {
	const b = envelope as unknown as {
		name?: string;
		input?: string;
		output?: string;
		display?: string;
		artifact?: string;
		dryRun?: boolean;
		message?: string;
	};
	const name = b.name ?? "";
	const input = b.input ?? "";

	if (b.dryRun) {
		return [`Bundle dry-run for ${name} from ${input}:`, `  → ${b.display}`].join("\n");
	}

	if (envelope.ok === false) {
		const msg = b.message ?? "bundle failed";
		return [
			`  ✗ Bundle failed: ${msg}`,
			`    Command: ${b.display}`,
			`    Override package manager with ${PACKAGE_MANAGER_OVERRIDE}=${PACKAGE_MANAGER_OVERRIDE_HELP}.`,
		].join("\n");
	}

	const artifact = b.artifact ?? `${b.output ?? "./dist"}/${name}.js`;
	return [
		`Bundling plugin ${name} from ${input}...`,
		`  → ${b.display}`,
		`  ✓ Plugin bundled to ${artifact}`,
	].join("\n");
}

// ── reload ────────────────────────────────────────────────────────────────
/** Human projection of the `plugin reload` envelope — per-plugin reloaded/skipped
 *  lines, restart outcome, and (for a partial without --restart-if-needed) the
 *  restart hint from the envelope's nextCommand. Reads only the envelope. */
export function formatReloadFromEnvelope(
	envelope: CapabilityEnvelope,
	input?: CapabilityInput,
): string {
	const e = envelope as CapabilityEnvelope & {
		reloaded?: string[];
		skipped?: string[];
		timedOut?: boolean;
		restarted?: boolean;
		restart?: { ok: boolean; restartCommand: string; failedCommand?: string };
		requested?: string[];
		nextCommand?: string | null;
	};

	const requestedIds = (input?.args.pluginIds as string[] | undefined) ?? e.requested ?? [];
	const requested = requestedIds.length > 0 ? requestedIds : undefined;
	const lines: string[] = [
		requested
			? `Reloading runtime plugins: ${requested.join(", ")}`
			: "Reloading runtime plugins...",
	];

	const reloaded = e.reloaded ?? [];
	const skipped = e.skipped ?? [];

	// Pure error envelope with no per-plugin story (unavailable / restart-failed):
	// defer to the shared error line, like the model group.
	if (envelope.ok === false && reloaded.length === 0 && skipped.length === 0) {
		return [lines[0], renderCapabilityError(envelope, "plugin reload error")].join("\n");
	}

	for (const pluginId of reloaded) {
		lines.push(chalk.green(`  ✓ ${pluginId} reloaded`));
	}
	for (const pluginId of skipped) {
		const status = e.timedOut
			? "timed out before reload completion"
			: "requires runtime restart to reload";
		lines.push(chalk.red(`  ✗ ${pluginId} ${status}`));
	}

	if (e.restart) {
		if (e.restarted && e.restart.ok) {
			lines.push(chalk.green(`  ✓ runtime restarted (${e.restart.restartCommand})`));
		} else if (!e.restart.ok) {
			lines.push(chalk.red(`  ✗ runtime restart failed: ${e.restart.failedCommand}`));
		}
	} else if (skipped.length > 0) {
		const hint = e.nextCommand ?? (envelope as { nextAction?: string }).nextAction;
		if (hint) lines.push(chalk.red(`  Restart if needed: ${hint}`));
	}

	if (reloaded.length === 0 && skipped.length === 0 && !e.restart) {
		lines.push("  No plugins to reload.");
	}

	return lines.join("\n");
}
