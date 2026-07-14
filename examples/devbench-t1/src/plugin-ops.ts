import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	type CapabilityDescriptor,
	type CapabilityEnvelope,
	type CapabilityInput,
	type SurfaceableManifest,
} from "@refarm.dev/capability-host";
import { existsSync } from "node:fs";

import { runCatalog, catalogPlugins } from "./live-catalog.js";
import { runResolver, defaultResolverPlugin } from "./live-resolver.js";
import { runExtensionLifecycle, defaultLifecyclePlugin } from "./extension-lifecycle.js";
import { buildExtensionGraph, type BuildExtensionGraphOptions } from "./extension-graph.js";

/**
 * PLUGIN OPERATIONS — one panel that unifies the plugin's sovereign story, offline.
 *
 * The plumbing verbs each prove one thing (catalog: verified inventory; resolve: content-address +
 * tamper rejection; lifecycle: integrity→maturity→install; graph: the SPI edges, real vs
 * illustrative). Alone they are separate cards. This aggregates the four DAEMON-FREE blocks into
 * one report + one HTML dashboard the web content seam mounts — the narrative
 * PROVENANCE → INVENTORY → LIFECYCLE → RECURSION, read as a whole.
 *
 * Daemon-free by design: catalog/resolve/lifecycle/graph are all fs+crypto (no runtime boot), so
 * this runs inside a content-seam call and photographs well; the live verbs (telemetry/audit/
 * enforce/resilience) stay as their own cards (they each boot a daemon).
 */

function escapeHtml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface PluginOpsReport {
	provenance: { hash: string; tamperRejected: boolean; tamperReason?: string };
	inventory: Array<{ name: string; integrity: string; wasmHash: string; cacheStatus: string }>;
	reinstallCacheStatus?: string;
	lifecycle: { integrity: string; maturity: string; installVerified: boolean };
	recursion: { edges: Array<{ from: string; to: string; api: string; executed: boolean }>; executedCount: number };
}

/** Render the aggregate report as a self-contained HTML dashboard (mirrors governanceToHtml). */
export function pluginOpsToHtml(report: PluginOpsReport): string {
	const inv = report.inventory
		.map(
			(e) =>
				`<tr><td>${escapeHtml(e.name)}</td><td class="refarm-code">${escapeHtml(e.wasmHash.slice(0, 16))}…</td><td>${escapeHtml(e.cacheStatus)}</td></tr>`,
		)
		.join("");
	const edges = report.recursion.edges
		.map(
			(e) =>
				`<tr><td>${escapeHtml(e.from.split("/").pop() ?? e.from)} → ${escapeHtml(e.to.split("/").pop() ?? e.to)}</td><td>${escapeHtml(e.api)}</td><td>${e.executed ? "executed" : "declared"}</td></tr>`,
		)
		.join("");
	return `<section class="refarm-stack" data-plugin-ops-dashboard>
  <h3>Plugin operations — provenance → inventory → lifecycle → recursion</h3>
  <p><strong>Provenance:</strong> content-address <span class="refarm-code">${escapeHtml(report.provenance.hash.slice(0, 16))}…</span> — a tampered copy is ${report.provenance.tamperRejected ? "<strong>rejected</strong>" : "accepted"} (${escapeHtml(report.provenance.tamperReason ?? "-")}).</p>
  <table class="governance-table plugin-ops-inventory"><thead><tr><th>Plugin</th><th>wasmHash</th><th>cache</th></tr></thead><tbody>${inv}</tbody></table>
  <p><strong>Lifecycle:</strong> integrity <span class="refarm-code">${escapeHtml(report.lifecycle.integrity.slice(0, 20))}…</span> · maturity <strong>${escapeHtml(report.lifecycle.maturity)}</strong> · install ${report.lifecycle.installVerified ? "verified" : "unverified"}.</p>
  <table class="governance-table plugin-ops-recursion"><thead><tr><th>SPI edge</th><th>API</th><th>state</th></tr></thead><tbody>${edges}</tbody></table>
</section>`;
}

/** Run the four daemon-free blocks and assemble the report. */
export async function runPluginOps(manifests: readonly SurfaceableManifest[], graphOptions: BuildExtensionGraphOptions): Promise<PluginOpsReport> {
	const catalog = await runCatalog();
	const resolver = await runResolver(defaultResolverPlugin());
	const lifecycle = await runExtensionLifecycle(defaultLifecyclePlugin());
	const graph = buildExtensionGraph(manifests, graphOptions);
	return {
		provenance: {
			hash: resolver.hash,
			tamperRejected: resolver.tamperRejected,
			...(resolver.tamperReason ? { tamperReason: resolver.tamperReason } : {}),
		},
		inventory: catalog.installed.map((e) => ({
			name: e.name,
			integrity: e.integrity,
			wasmHash: e.wasmHash,
			cacheStatus: e.cacheStatus,
		})),
		...(catalog.reinstallCacheStatus ? { reinstallCacheStatus: catalog.reinstallCacheStatus } : {}),
		lifecycle: {
			integrity: lifecycle.integrity,
			maturity: lifecycle.maturity.level,
			installVerified: lifecycle.install.integrityVerified,
		},
		recursion: {
			edges: graph.apiEdges,
			executedCount: graph.apiEdges.filter((e) => e.executed).length,
		},
	};
}

/**
 * `plugin-ops` — one panel unifying the plugin's sovereign story from the daemon-free blocks:
 * provenance (content-address + tamper rejection), inventory (verified catalog), lifecycle
 * (integrity→maturity→install), and recursion (the SPI edges). Emits JSON + an HTML dashboard the
 * web content seam mounts. Offline.
 */
export function createPluginOpsCapability(
	manifests: readonly SurfaceableManifest[],
	graphOptions: BuildExtensionGraphOptions = {},
): CapabilityDescriptor {
	return {
		name: "plugin-ops",
		summary: "Unified plugin operations dashboard: provenance + inventory + lifecycle + recursion (offline)",
		transports: { http: { path: "/plugin/ops" } },
		renderers: { tui: { section: "extension" }, web: { route: "/plugin-ops", icon: "layout-dashboard" }, ide: { command: "dgk.plugin-ops" } },
		async run(_input: CapabilityInput): Promise<CapabilityEnvelope> {
			// All four blocks read built .wasm; a missing one is a helpful error, not a crash.
			const needed = [...catalogPlugins().map((p) => p.path), defaultResolverPlugin(), defaultLifecyclePlugin()];
			if (needed.some((p) => !existsSync(p))) {
				return buildJsonErrorEnvelope({
					command: "plugin-ops",
					operation: "plugin-ops",
					error: "artifacts_missing",
					message: "Build the plugins first (source-provider, agent, delegate).",
					nextAction:
						"pnpm --filter @refarm.dev/source-provider-ref run build:plugin && pnpm --filter @refarm.dev/agent run build:wasm && pnpm --filter @refarm.dev/delegate run build:wasm",
				});
			}
			try {
				const report = await runPluginOps(manifests, graphOptions);
				return buildJsonSuccessEnvelope({
					command: "plugin-ops",
					operation: "plugin-ops",
					nextCommand: "dgk extension-graph",
					nextCommands: ["dgk extension-graph"],
					extra: {
						// The aggregate — one narrative from four daemon-free proofs.
						provenance: report.provenance,
						inventory: report.inventory,
						reinstallCacheStatus: report.reinstallCacheStatus,
						lifecycle: report.lifecycle,
						recursion: report.recursion,
						// The content-seam field the web boot reads to mount the dashboard above the cards.
						pluginOpsHtml: pluginOpsToHtml(report),
					},
				});
			} catch (error) {
				return buildJsonErrorEnvelope({
					command: "plugin-ops",
					operation: "plugin-ops",
					error: "plugin_ops_failed",
					message: error instanceof Error ? error.message : String(error),
					nextAction: "Check the plugin artifacts are built and readable.",
				});
			}
		},
	};
}
