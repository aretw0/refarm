import { describe, expect, it } from "vitest";

import {
	PLUGIN_FACT_KEYS,
	projectPluginFacts,
	type PluginFacts,
} from "./plugin-runtime.js";

/**
 * A FACT THE MODEL CARRIES MUST REACH THE SURFACE, and the enumeration is the compiler's.
 *
 * On 2026-08-26 the host emitted new grant facts, the parser read them, the merge assembled
 * them, six tests were green — and the hand-listed projection between them dropped them. It was
 * found by installing the node and looking. This is the guard that would have caught it, and the
 * spec's D4 asked for exactly this shape: enumerate FROM THE CODE, so a field added later cannot
 * silently fail to appear.
 */
function sampleFacts(): PluginFacts {
	return {
		runtimeId: "agent",
		manifestId: "@refarm/agent",
		dir: "/home/op/.refarm/plugins/refarm_agent",
		requested: true,
		loaded: true,
		installed: true,
		integrity: { state: "matches" } as unknown as PluginFacts["integrity"],
		known: true,
		development: true,
		effectivePermissions: ["fs:read"],
		declaredPermissions: ["fs:read", "shell:spawn"],
		loadedUnderDevelopment: true,
	};
}

describe("the plugin status projection", () => {
	it("carries every field the facts type declares", () => {
		const projected = projectPluginFacts(sampleFacts());
		// `PLUGIN_FACT_KEYS` is `Record<keyof PluginFacts, true>`: the COMPILER refuses it if a
		// field is missing, so this list cannot drift from the type it enumerates.
		for (const key of Object.keys(PLUGIN_FACT_KEYS)) {
			expect(projected, `projection dropped "${key}"`).toHaveProperty(key);
		}
	});

	it("carries the values, not merely the keys", () => {
		// A projection that spread `undefined` into every field would satisfy the key check and
		// report a plugin with no permissions and no development state — green, and wrong.
		const projected = projectPluginFacts(sampleFacts()) as unknown as Record<string, unknown>;
		expect(projected.development).toBe(true);
		expect(projected.loadedUnderDevelopment).toBe(true);
		expect(projected.effectivePermissions).toEqual(["fs:read"]);
		expect(projected.declaredPermissions).toEqual(["fs:read", "shell:spawn"]);
	});

	it("displays the manifest id, falling back to the runtime id", () => {
		expect(projectPluginFacts(sampleFacts()).id).toBe("@refarm/agent");
		expect(projectPluginFacts({ ...sampleFacts(), manifestId: null }).id).toBe("agent");
	});
});
