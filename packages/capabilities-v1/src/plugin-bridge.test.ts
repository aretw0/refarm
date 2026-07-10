import { createCapabilityRegistry } from "@refarm.dev/capabilities";
import type { Effort } from "@refarm.dev/effort-contract-v1";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
	apiProvideKey,
	createPluginDescriptorDeps,
	definePluginInspectorCapability,
	isConnectionError,
	pluginDescriptorsFrom,
	pluginSurfaceName,
	registerPluginCapabilities,
	resolveApiLinks,
	surfaceablePluginVerbsFrom,
	type PluginDescriptorDeps,
	type SurfaceableManifest,
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

function manifest(id: string, provides: string[], subscribes: string[] = []) {
	return { id, capabilities: { provides, subscribes } };
}

interface SurfaceVerbConformanceFixture {
	manifests: ReturnType<typeof manifest>[];
	expected: ReturnType<typeof surfaceablePluginVerbsFrom>;
}

describe("surfaceablePluginVerbsFrom — manifest metadata without host deps", () => {
	it("describes dispatchable plugin verbs with their stable surface names", () => {
		const m = manifest("@example/vault", ["vault:search", "vault:extract"], ["vault:dispatch"]);

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

	it("matches the shared TS/Rust plugin surface verb conformance fixture", () => {
		const fixture = JSON.parse(
			readFileSync(new URL("../fixtures/plugin-surface-verbs.json", import.meta.url), "utf-8"),
		) as SurfaceVerbConformanceFixture;

		expect(fixture.manifests.flatMap((entry) => surfaceablePluginVerbsFrom(entry))).toEqual(
			fixture.expected,
		);
	});
});

describe("pluginDescriptorsFrom — a plugin surfaces a capability", () => {
	it("builds descriptor deps from a host submit sink and default id/time factories", async () => {
		const submitted: Effort[] = [];
		const deps = createPluginDescriptorDeps({
			submitEffort: async (effort) => {
				submitted.push(effort);
				return effort.id;
			},
		});
		const m = manifest("@example/vault", ["vault:search"], ["vault:dispatch"]);
		const [search] = pluginDescriptorsFrom(m, deps);
		if (!search) throw new Error("search descriptor missing");

		const env = (await search.run({ args: { args: ['q="notes"'] } } as never)) as unknown as {
			ok: boolean;
			effortId: string;
			replyRef: string;
		};

		expect(env.ok).toBe(true);
		expect(env.effortId).toBe(submitted[0]?.id);
		expect(env.replyRef).toBe(submitted[0]?.id);
		expect(submitted[0]?.submittedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it("synthesizes a descriptor per dispatchable verb (provides + subscribes:dispatch)", () => {
		const m = manifest("@example/vault", ["vault:search", "vault:extract"], ["vault:dispatch"]);
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
		const x = env as unknown as {
			command: string;
			effortId: string;
			replyRef: string;
			verb: string;
		};
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

	it("folds a plugin's manifest-declared surfaces onto its verb's renderers (manifest→descriptor gap closed)", () => {
		// The plugin declares a homestead panel in its manifest; without the fold, that
		// surface was IGNORED — the descriptor only carried hardcoded tui/web. Now the
		// declared surface reaches the open axis, so a projector for it can find the verb.
		const m = {
			id: "@example/vault",
			capabilities: { provides: ["vault:search"], subscribes: ["vault:dispatch"] },
			extensions: {
				surfaces: [{ layer: "homestead", kind: "panel", id: "vault-panel", slot: "main" }],
			},
		};
		const search = pluginDescriptorsFrom(m, makeDeps())[0];
		if (!search) throw new Error("search descriptor missing");
		// The defaults survive...
		expect(search.renderers?.tui).toEqual({ section: "vault" });
		expect(search.renderers?.web).toEqual({ route: "/vault-search" });
		// ...and the manifest-declared homestead surface is now on the verb.
		expect((search.renderers as Record<string, unknown>).homestead).toEqual({
			id: "vault-panel",
			kind: "panel",
			slot: "main",
		});
	});
});

describe("definePluginInspectorCapability — manifest visibility as an extension block", () => {
	it("declares an inspector that explains manifest provides → surfaced verbs", async () => {
		const deps = makeDeps();
		const inspector = definePluginInspectorCapability({
			name: "extension",
			summary: "Inspect the coding-agent extension",
			manifest: manifest(
				"@devbench/coding-agent",
				["agent:code", "agent:review"],
				["agent:dispatch"],
			),
			deps,
			httpPath: "/ext/inspect",
			note: "Declared once, reachable on every surface.",
		});

		expect(inspector.name).toBe("extension");
		expect(inspector.transports?.http).toEqual({ method: "GET", path: "/ext/inspect" });
		expect(inspector.renderers?.tui).toEqual({ section: "extension" });

		const env = (await inspector.run({ args: {}, options: {}, json: true })) as unknown as {
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
		expect(
			registry
				.list()
				.map((c) => c.name)
				.sort(),
		).toEqual(["vault-extract", "vault-search"]);
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
			registry
				.list()
				.flatMap((d) => [
					d.name.toLowerCase(),
					...(d.transports?.repl?.slashAliases ?? []).map((a) => a.toLowerCase()),
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

describe("resolveApiLinks — the plugin-to-plugin (SPI) recursion, checked on the TS side", () => {
	const CODING_AGENT: SurfaceableManifest = {
		id: "@devbench/coding-agent",
		capabilities: {
			provides: ["agent:code"],
			subscribes: ["agent:dispatch"],
			requiresApi: ["NotesLookup"],
		},
	};
	const NOTES_INDEXER: SurfaceableManifest = {
		id: "@devbench/notes-indexer",
		capabilities: {
			provides: ["notes:search"],
			subscribes: ["notes:dispatch"],
			providesApi: ["NotesLookup"],
		},
	};

	it("folds providesApi into the host's api:<name> convention", () => {
		// Mirrors tractor plugin_registry::plugin_providing_api (needle `api:<name>`).
		expect(apiProvideKey("NotesLookup")).toBe("api:NotesLookup");
	});

	it("pairs a requiresApi to the manifest that providesApi it (recursion resolves)", () => {
		const links = resolveApiLinks([CODING_AGENT, NOTES_INDEXER]);
		expect(links).toEqual([
			{
				api: "NotesLookup",
				requiredBy: "@devbench/coding-agent",
				providedBy: "@devbench/notes-indexer",
			},
		]);
	});

	it("leaves an unmet requirement as providedBy:null (degrade, not error)", () => {
		// The provider is not loaded — the requirement stands unmet, no throw.
		const links = resolveApiLinks([CODING_AGENT]);
		expect(links).toEqual([
			{ api: "NotesLookup", requiredBy: "@devbench/coding-agent", providedBy: null },
		]);
	});

	it("resolves nothing when no manifest requires an api", () => {
		expect(resolveApiLinks([NOTES_INDEXER])).toEqual([]);
	});

	it("first provider wins when two manifests provide the same api (registration order)", () => {
		const second: SurfaceableManifest = {
			id: "@devbench/other-notes",
			capabilities: { providesApi: ["NotesLookup"] },
		};
		const links = resolveApiLinks([CODING_AGENT, NOTES_INDEXER, second]);
		expect(links[0]?.providedBy).toBe("@devbench/notes-indexer");
	});
});

describe("isConnectionError — a white-label app degrades on an unreachable runtime", () => {
	it("classifies a Node fetch-to-down-daemon TypeError as a connection error", () => {
		// This is the exact shape undici throws when the sidecar isn't up.
		const err = new TypeError("fetch failed");
		(err as { cause?: unknown }).cause = Object.assign(new Error("connect ECONNREFUSED"), {
			code: "ECONNREFUSED",
		});
		expect(isConnectionError(err)).toBe(true);
	});

	it("classifies an AbortError (timeout) as a connection error", () => {
		expect(isConnectionError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(
			true,
		);
	});

	it("does NOT classify a plugin-level error as a connection error", () => {
		expect(isConnectionError(new Error("plugin revoked: quality"))).toBe(false);
		expect(isConnectionError({ error: "not-supported" })).toBe(false);
	});

	it("dispatch reports runtime-unreachable (not dispatch-failed) when the runtime is down", async () => {
		const deps: PluginDescriptorDeps = {
			submitEffort: async () => {
				const err = new TypeError("fetch failed");
				(err as { cause?: unknown }).cause = Object.assign(new Error("ECONNREFUSED"), {
					code: "ECONNREFUSED",
				});
				throw err;
			},
			newId: () => "id-1",
			nowIso: () => "2026-01-01T00:00:00Z",
		};
		const [descriptor] = pluginDescriptorsFrom(
			{
				id: "@devbench/coding-agent",
				capabilities: { provides: ["agent:code"], subscribes: ["agent:dispatch"] },
			},
			deps,
		);
		const env = (await descriptor!.run!({ args: { args: [] } } as never)) as {
			ok: boolean;
			error: string;
			nextAction: string;
		};
		expect(env.ok).toBe(false);
		expect(env.error).toBe("runtime-unreachable");
		expect(env.nextAction).toMatch(/start the runtime/i);
	});
});
