import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { buildRegistry } from "./cli.js";
import { catalogPlugins } from "./live-catalog.js";
import { defaultResolverPlugin } from "./live-resolver.js";
import { defaultLifecyclePlugin } from "./extension-lifecycle.js";
import { pluginOpsToHtml, type PluginOpsReport } from "./plugin-ops.js";

const artifactsReady =
	catalogPlugins().every((p) => existsSync(p.path)) &&
	existsSync(defaultResolverPlugin()) &&
	existsSync(defaultLifecyclePlugin());

describe("plugin-ops — the unified daemon-free plugin dashboard", () => {
	it("pluginOpsToHtml renders provenance + inventory + lifecycle + recursion (pure, HTML-escaped)", () => {
		const report: PluginOpsReport = {
			provenance: { hash: "abcd".repeat(16), tamperRejected: true, tamperReason: "hash-mismatch" },
			inventory: [{ name: "agent", integrity: "sha256-x", wasmHash: "deadbeef".repeat(8), cacheStatus: "miss" }],
			lifecycle: { integrity: "sha256-y", maturity: "productive", installVerified: true },
			recursion: { edges: [{ from: "@refarm/delegate", to: "@refarm/agent", api: "AgentRespond", executed: true }], executedCount: 1 },
		};
		const html = pluginOpsToHtml(report);
		expect(html).toContain("data-plugin-ops-dashboard");
		expect(html).toContain("provenance"); // the narrative heading
		expect(html).toContain("rejected"); // tamper rejected
		expect(html).toContain("productive"); // maturity
		expect(html).toContain("delegate → agent"); // the executed SPI edge, short names
		expect(html).toContain("executed");
	});

	it("is mounted with an IDE command + web route", () => {
		const verb = buildRegistry().get("plugin-ops");
		if (!verb || "actions" in verb) throw new Error("plugin-ops not mounted");
		expect(verb.renderers?.web?.route).toBe("/plugin-ops");
		expect((verb.renderers?.ide as { command?: string } | undefined)?.command).toBe("dgk.plugin-ops");
	});

	it.skipIf(!artifactsReady)("the VERB aggregates the four blocks + emits the dashboard HTML", async () => {
		const verb = buildRegistry().get("plugin-ops");
		if (!verb || "actions" in verb) throw new Error("plugin-ops not mounted");
		const env = (await verb.run({ args: {}, options: {}, json: true })) as unknown as {
			ok: boolean;
			provenance: { tamperRejected: boolean };
			inventory: Array<{ wasmHash: string }>;
			lifecycle: { maturity: string; installVerified: boolean };
			recursion: { executedCount: number };
			pluginOpsHtml: string;
		};
		expect(env.ok).toBe(true);
		// Provenance: a tampered copy was rejected.
		expect(env.provenance.tamperRejected).toBe(true);
		// Inventory: the verified catalog.
		expect(env.inventory.length).toBe(catalogPlugins().length);
		// Lifecycle: install verified.
		expect(env.lifecycle.installVerified).toBe(true);
		// Recursion: at least the delegate → agent executed edge.
		expect(env.recursion.executedCount).toBeGreaterThanOrEqual(1);
		// The dashboard HTML the web content seam mounts.
		expect(env.pluginOpsHtml).toContain("data-plugin-ops-dashboard");
	});
});
