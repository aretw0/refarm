import { createCapabilityRegistry } from "@refarm.dev/cli/capabilities";
import type { Effort } from "@refarm.dev/effort-contract-v1";
import { describe, expect, it } from "vitest";

import {
	definePluginInspectorCapability,
	pluginDescriptorsFrom,
	pluginSurfaceName,
	registerPluginCapabilities,
	surfaceablePluginVerbsFrom,
	type PluginDescriptorDeps,
} from "./plugin-bridge.js";

function makeDeps(): PluginDescriptorDeps & { submitted: Effort[] } {
	const submitted: Effort[] = [];
	let n = 0;
	return {
		submitted,
		submitEffort: async (effort) => {
			submitted.push(effort);
			return effort.id;
		},
		newId: () => `id-${++n}`,
		nowIso: () => "2026-01-01T00:00:00Z",
	};
}

function manifest(
	id: string,
	provides: string[],
	subscribes: string[] = [],
) {
	return { id, capabilities: { provides, subscribes } };
}

describe("surfaceablePluginVerbsFrom — manifest metadata without host deps", () => {
	it("describes dispatchable plugin verbs with their stable surface names", () => {
		const m = manifest("@example/vault", ["vault:search", "vault:extract"], [
			"vault:dispatch",
		]);

		expect(surfaceablePluginVerbsFrom(m)).toEqual([
			{
				pluginId: "@example/vault",
				pluginKey: "vault",
				verb: "search",
				target: "vault:search",
				dispatchEvent: "vault:dispatch",
				surfaceName: "vault-search",
			},
			{
				pluginId: "@example/vault",
				pluginKey: "vault",
				verb: "extract",
				target: "vault:extract",
				dispatchEvent: "vault:dispatch",
				surfaceName: "vault-extract",
			},
		]);
		expect(pluginSurfaceName("web", "search")).toBe("web-search");
	});

	it("keeps the same subscribes guard as descriptor synthesis", () => {
		const m = manifest("@example/vault", ["vault:search", "vault:dispatch", "bad"], []);
		expect(surfaceablePluginVerbsFrom(m)).toEqual([]);
	});
});

describe("pluginDescriptorsFrom — a plugin surfaces a capability", () => {
	it("synthesizes a descriptor per dispatchable verb (provides + subscribes:dispatch)", () => {
		const m = manifest("@example/vault", ["vault:search", "vault:extract"], [
			"vault:dispatch",
		]);
		const caps = pluginDescriptorsFrom(m, makeDeps());
		expect(caps.map((c) => c.name).sort()).toEqual(["vault-extract", "vault-search"]);
		// It's a real CapabilityDescriptor: name, summary, run fn, projects to surfaces.
		const search = caps.find((c) => c.name === "vault-search");
		if (!search) throw new Error("search descriptor missing");
		expect(typeof search.run).toBe("function");
		expect(search.summary).toContain("@example/vault");
		expect(search.transports?.cli).toBeDefined();
		expect(search.transports?.repl).toBeDefined();
		expect(search.renderers).toEqual({
			tui: { section: "vault" },
			web: { route: "/vault-search" },
		});
	});

	it("only surfaces a verb the plugin can receive a dispatch for (subscribes guard)", () => {
		// provides a verb but does NOT subscribe to its own dispatch → not surfaceable.
		const m = manifest("@example/vault", ["vault:search"], [] /* no dispatch */);
		expect(pluginDescriptorsFrom(m, makeDeps())).toEqual([]);
	});

	it("ignores the :dispatch routing key and non-verb entries", () => {
		const m = manifest(
			"@example/vault",
			["vault:dispatch", "novcolon", "vault:"],
			["vault:dispatch"],
		);
		expect(pluginDescriptorsFrom(m, makeDeps())).toEqual([]);
	});

	it("run() dispatches to WASM and returns a delivery-receipt envelope (two-phase)", async () => {
		const deps = makeDeps();
		const m = manifest("@example/vault", ["vault:search"], ["vault:dispatch"]);
		const search = pluginDescriptorsFrom(m, deps)[0];
		if (!search) throw new Error("search descriptor missing");

		const env = await search.run({ args: { args: ['q="notes"'] } } as never);
		expect(env.ok).toBe(true);
		// The verb was dispatched to the plugin's WASM via the neutral seam...
		expect(deps.submitted).toHaveLength(1);
		// ...and run() returned a RECEIPT (effortId + replyRef), not the verb's result.
		const x = env as unknown as { command: string; effortId: string; replyRef: string; verb: string };
		expect(x.command).toBe("vault-search");
		expect(x.verb).toBe("search");
		expect(x.effortId).toBeTruthy();
		expect(x.replyRef).toBeTruthy();
	});

	it("a plugin with no surfaceable verbs contributes nothing", () => {
		// Most plugins: they subscribe/provide runtime events but no user verb.
		const m = manifest("@example/agent", ["integration:respond"], ["user:prompt"]);
		expect(pluginDescriptorsFrom(m, makeDeps())).toEqual([]);
	});
});

describe("definePluginInspectorCapability — manifest visibility as an extension block", () => {
	it("declares an inspector that explains manifest provides → surfaced verbs", async () => {
		const deps = makeDeps();
		const inspector = definePluginInspectorCapability({
			name: "extension",
			summary: "Inspect the coding-agent extension",
			manifest: manifest("@devbench/coding-agent", ["agent:code", "agent:review"], [
				"agent:dispatch",
			]),
			deps,
			httpPath: "/ext/inspect",
			note: "Declared once, reachable on every surface.",
		});

		expect(inspector.name).toBe("extension");
		expect(inspector.transports?.http).toEqual({ method: "GET", path: "/ext/inspect" });
		expect(inspector.renderers?.tui).toEqual({ section: "extension" });

		const env = await inspector.run({ args: {}, options: {}, json: true }) as unknown as {
			ok: boolean;
			command: string;
			operation: string;
			pluginId: string;
			declared: string[];
			surfaced: Array<{ verb: string; summary: string }>;
			note: string;
		};

		expect(env.ok).toBe(true);
		expect(env.command).toBe("extension");
		expect(env.operation).toBe("inspect");
		expect(env.pluginId).toBe("@devbench/coding-agent");
		expect(env.declared).toEqual(["agent:code", "agent:review"]);
		expect(env.surfaced.map((item) => item.verb).sort()).toEqual(["agent-code", "agent-review"]);
		expect(env.note).toBe("Declared once, reachable on every surface.");
	});
});

describe("registerPluginCapabilities — the register-at-load wire", () => {
	it("registers plugin verbs into the registry so they project to every surface", () => {
		const registry = createCapabilityRegistry([]);
		const result = registerPluginCapabilities(
			registry,
			[manifest("@example/vault", ["vault:search", "vault:extract"], ["vault:dispatch"])],
			makeDeps(),
		);
		expect(result.registered.sort()).toEqual(["vault-extract", "vault-search"]);
		expect(result.collided).toEqual([]);
		// Now reachable via the generic registry the projectors read.
		expect(registry.list().map((c) => c.name).sort()).toEqual(["vault-extract", "vault-search"]);
		expect(registry.has("vault-search")).toBe(true);
	});

	it("keeps same-named plugin verbs separate by using stable scoped surface names", () => {
		const registry = createCapabilityRegistry([]);
		const result = registerPluginCapabilities(
			registry,
			[
				manifest("@example/vault", ["vault:search"], ["vault:dispatch"]),
				manifest("@example/web", ["web:search"], ["web:dispatch"]),
			],
			makeDeps(),
		);
		expect(result.collided).toEqual([]);
		expect(result.registered).toEqual(["vault-search", "web-search"]);
		expect(registry.has("vault-search")).toBe(true);
		expect(registry.has("web-search")).toBe(true);
	});

	it("no installed plugins → registers nothing", () => {
		const registry = createCapabilityRegistry([]);
		const result = registerPluginCapabilities(registry, [], makeDeps());
		expect(result).toEqual({ registered: [], collided: [] });
	});

	it("reachability: a registered plugin verb surfaces through the generic projector seams", () => {
		// The projectors (REPL slash names + CLI commands) are blind registry.list()
		// loops — so a registered plugin verb is reachable on both, byte-identical to a
		// built-in, with no per-surface wiring. Prove it via the SAME logic the seams use.
		const registry = createCapabilityRegistry([]);
		registerPluginCapabilities(
			registry,
			[manifest("@example/vault", ["vault:search"], ["vault:dispatch"])],
			makeDeps(),
		);
		const entry = registry.get("vault-search");
		if (!entry) throw new Error("registered plugin verb not found in registry");

		// REPL seam: capabilitySlashNames() = list().flatMap(name + aliases).
		const slashNames = new Set(
			registry.list().flatMap((d) => [
				d.name.toLowerCase(),
				...((d.transports?.repl?.slashAliases ?? []).map((a) => a.toLowerCase())),
			]),
		);
		expect(slashNames.has("vault-search")).toBe(true);

		// CLI seam: capabilityCliCommands() filters list() by transports.cli — the plugin
		// verb declares transports.cli, so it's included.
		const cliReachable = registry
			.list()
			.filter((d) => d.transports?.cli !== undefined)
			.map((d) => d.name);
		expect(cliReachable).toContain("vault-search");
	});
});
