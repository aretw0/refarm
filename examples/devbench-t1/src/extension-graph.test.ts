import type { SurfaceableManifest } from "@refarm.dev/capability-host";
import { describe, expect, it } from "vitest";

import { buildRegistry } from "./cli.js";
import { buildExtensionGraph, pluginShortName } from "./extension-graph.js";

const MANIFESTS: SurfaceableManifest[] = [
	{ id: "@devbench/coding-agent", capabilities: { provides: ["agent:code"], requiresApi: ["NotesLookup"] } },
	{ id: "@devbench/notes-indexer", capabilities: { provides: ["notes:search"], providesApi: ["NotesLookup"] } },
];

describe("extension-graph — the plugin dependency graph (the SPI recursion, drawn)", () => {
	it("derives the SPI edge from requiresApi → providesApi", () => {
		const { graph, apiEdges } = buildExtensionGraph(MANIFESTS);
		expect(graph.nodes.map((n) => n.id)).toEqual([
			"@devbench/coding-agent",
			"@devbench/notes-indexer",
		]);
		// The recursion: coding-agent consumes notes-indexer via the NotesLookup API. Not executed
		// (these are illustrative synthetic manifests, not backed by a built .wasm).
		expect(apiEdges).toEqual([
			{ from: "@devbench/coding-agent", to: "@devbench/notes-indexer", api: "NotesLookup", executed: false },
		]);
		expect(graph.links).toEqual([
			{ source: "@devbench/coding-agent", target: "@devbench/notes-indexer" },
		]);
	});

	it("marks an SPI edge `executed` when BOTH endpoints are real, built plugins", () => {
		const real: SurfaceableManifest[] = [
			{ id: "@refarm/agent", capabilities: { providesApi: ["AgentRespond"] } },
			{ id: "@refarm/delegate", capabilities: { requiresApi: ["AgentRespond"] } },
		];
		const { apiEdges } = buildExtensionGraph(real, {
			livePluginIds: ["@refarm/agent", "@refarm/delegate"],
		});
		// The delegate → agent edge is the one the runtime actually drives (delegate-run --chain).
		expect(apiEdges).toEqual([
			{ from: "@refarm/delegate", to: "@refarm/agent", api: "AgentRespond", executed: true },
		]);
	});

	it("does not draw an edge when no plugin provides the required API", () => {
		const orphan: SurfaceableManifest[] = [
			{ id: "@x/a", capabilities: { requiresApi: ["Missing"] } },
		];
		expect(buildExtensionGraph(orphan).apiEdges).toEqual([]);
	});

	it("pluginShortName strips the scope", () => {
		expect(pluginShortName("@devbench/coding-agent")).toBe("coding-agent");
		expect(pluginShortName("plain")).toBe("plain");
	});

	it("the verb renders an SVG carrying both nodes + the SPI edge, on all surfaces", async () => {
		const verb = buildRegistry().get("extension-graph");
		if (!verb || "actions" in verb) throw new Error("extension-graph not mounted");
		// declare once → everywhere: the graph reaches web + IDE too.
		expect(verb.renderers?.web?.route).toBe("/extension-graph");
		const ide = verb.renderers?.ide as { command?: string } | undefined;
		expect(ide?.command).toBe("dgk.extension-graph");

		const env = (await verb.run({ args: {}, options: { svg: true }, json: true })) as unknown as {
			ok: boolean;
			pluginCount: number;
			spiEdges: Array<{ api: string; executed: boolean }>;
			executedEdges: Array<{ from: string; to: string; api: string }>;
			executedCount: number;
			svg: string;
		};
		expect(env.ok).toBe(true);
		expect(env.pluginCount).toBeGreaterThanOrEqual(2);
		expect(env.spiEdges.some((e) => e.api === "NotesLookup")).toBe(true);
		// The graph now carries the REAL, executed edge (delegate → agent), not only the synthetic one.
		expect(env.executedCount).toBeGreaterThanOrEqual(1);
		expect(env.executedEdges.some((e) => e.api === "AgentRespond" && e.from === "@refarm/delegate")).toBe(true);
		expect(env.svg).toContain("<svg");
		expect(env.svg).toContain("surveyor-graph__edges");
	});
});
