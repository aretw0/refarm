import { isCapabilityGroup, resolveGroupAction } from "@refarm.dev/cli/capabilities";
import { describe, expect, it } from "vitest";

import { createSourceCapabilityGroup } from "./source-capability.js";
import { createWasmSourceProvider, type CallRespond } from "./wasm-source-provider.js";

/** A fake respond channel that mimics the source-provider-ref guest: it routes by the
 * `{method}` in the payload, exactly as the real plugin's `respond` does. This lets the
 * adapter be proven without a running daemon; the real channel (sidecar POST) is
 * substituted in the example. */
const fakeRespond: CallRespond = async (_verb, payload) => {
	const { method, ref } = JSON.parse(payload) as { method: string; ref?: string };
	if (method === "discover") {
		return JSON.stringify({
			entries: [
				{ ref: "wasm:sample-a", label: "Sample A", kind: "local" },
				{ ref: "wasm:sample-b", label: "Sample B", kind: "local" },
			],
		});
	}
	if (method === "status") {
		return JSON.stringify({ kind: "local", materialized: false, known: ref === "wasm:sample-a" });
	}
	throw new Error(`unexpected method ${method}`);
};

describe("createWasmSourceProvider — a SourceProvider backed by a WASM plugin's respond", () => {
	function provider(callRespond: CallRespond = fakeRespond) {
		return createWasmSourceProvider({ pluginId: "source-provider-ref", callRespond });
	}

	it("is a source:v1 provider with the loaded plugin's id", () => {
		const p = provider();
		expect(p.capability).toBe("source:v1");
		expect(p.pluginId).toBe("source-provider-ref");
	});

	it("discover() marshals to the guest respond and returns the catalog", async () => {
		const catalog = await provider().discover();
		expect(catalog.entries).toHaveLength(2);
		expect(catalog.entries[0]?.ref).toBe("wasm:sample-a");
		expect(catalog.entries[0]?.label).toBe("Sample A");
	});

	it("status(ref) routes independently through the same respond channel", async () => {
		const p = provider();
		const known = (await p.status("wasm:sample-a")) as unknown as { known: boolean };
		expect(known.known).toBe(true);
		const missing = (await p.status("wasm:nope")) as unknown as { known: boolean };
		expect(missing.known).toBe(false);
	});

	it("passes the verb + method payload the sidecar route expects", async () => {
		const calls: Array<{ verb: string; payload: string }> = [];
		const spy: CallRespond = async (verb, payload) => {
			calls.push({ verb, payload });
			return JSON.stringify({ entries: [] });
		};
		await provider(spy).discover();
		expect(calls[0]?.verb).toBe("source:discover");
		expect(JSON.parse(calls[0]!.payload)).toEqual({ method: "discover" });
	});

	it("rejects materialize/resolve/refresh — host fs effects, not the WASM surface", async () => {
		const p = provider();
		await expect(p.materialize("wasm:sample-a")).rejects.toThrow(/host filesystem effects/);
		await expect(p.resolve("wasm:sample-a")).rejects.toThrow(/host filesystem effects/);
		await expect(p.refresh("wasm:sample-a")).rejects.toThrow(/host filesystem effects/);
	});

	it("feeds the neutral `source` group — `source discover` runs over a WASM provider", async () => {
		// The payoff: the neutral source:v1 verb group, unchanged, driven by a provider
		// that is a loaded .wasm — not an imported TS provider. Import less, extend more.
		const group = createSourceCapabilityGroup({ sourceProvider: provider() });
		if (!isCapabilityGroup(group)) throw new Error("expected a group");
		const resolved = resolveGroupAction(group, ["discover"]);
		if (!resolved) throw new Error("could not resolve discover");
		const env = (await resolved.action.run(resolved.input)) as unknown as {
			ok: boolean;
			count: number;
			sources: Array<{ ref: string }>;
		};
		expect(env.ok).toBe(true);
		expect(env.count).toBe(2);
		expect(env.sources.map((s) => s.ref)).toEqual(["wasm:sample-a", "wasm:sample-b"]);
	});
});
