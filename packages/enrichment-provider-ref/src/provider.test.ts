import { runEnrichmentV1Conformance } from "@refarm.dev/enrichment-contract-v1";
import { describe, expect, it } from "vitest";

// The REAL guest logic — the same module componentized into enrichment_provider.wasm.
// Driving the adapter through this proves parity with the shipped .wasm without a
// running daemon (the sidecar POST is the deployment substitution).
// @ts-expect-error — plugin.js is JS-atomic (no .d.ts); we use its runtime shape.
import { integration } from "./plugin.js";
import { createWasmEnrichmentProvider, type CallRespond } from "./provider.js";

/** A respond channel backed by the real guest's `respond` — routes by {method}. */
const guestRespond: CallRespond = async (_verb, payload) => {
	return integration.respond(payload) as string;
};

describe("createWasmEnrichmentProvider — enrichment:v1 backed by the plugin's respond", () => {
	async function provider(callRespond: CallRespond = guestRespond) {
		return createWasmEnrichmentProvider({ pluginId: "enrichment-provider-ref", callRespond });
	}

	it("is an enrichment:v1 provider that describes itself from the guest", async () => {
		const p = await provider();
		expect(p.capability).toBe("enrichment:v1");
		expect(p.pluginId).toBe("enrichment-provider-ref");
		const desc = p.describe();
		expect(desc.needsKeyFrom.length).toBeGreaterThan(0);
		expect(desc.addsFields).toContain("req.prioridade");
	});

	it("select() keeps inputs with a usable key and drops those without", async () => {
		const p = await provider();
		const keyField = p.describe().needsKeyFrom[0]!;
		const selected = p.select([
			{ id: "has-key", fields: { [keyField]: "REQ-1" } },
			{ id: "no-key", fields: {} },
		]);
		expect(selected.map((i) => i.id)).toEqual(["has-key"]);
	});

	it("enrich() marshals to the guest and returns the EnrichmentResult", async () => {
		const p = await provider();
		const keyField = p.describe().needsKeyFrom[0]!;
		const result = await p.enrich(
			[{ id: "req-1", fields: { [keyField]: "REQ-1" } }],
			{ mode: "dry-run" },
		);
		expect(result.mode).toBe("dry-run");
		expect(result.records).toHaveLength(1);
		expect(result.diagnostics.total).toBe(1);
	});

	it("passes the verb + method payload the sidecar route expects", async () => {
		const calls: Array<{ verb: string; payload: string }> = [];
		const spy: CallRespond = async (verb, payload) => {
			calls.push({ verb, payload });
			return integration.respond(payload) as string;
		};
		const p = await provider(spy);
		await p.enrich([{ id: "x", fields: { externalKey: "REQ-1" } }], { mode: "apply" });
		// First call is describe (at construction), then enrich.
		expect(calls[0]?.verb).toBe("enrichment:describe");
		expect(calls.at(-1)?.verb).toBe("enrichment:enrich");
		expect(JSON.parse(calls.at(-1)!.payload).method).toBe("enrich");
	});

	it("passes the enrichment:v1 conformance suite (parity with a TS provider)", async () => {
		const p = await provider();
		const result = await runEnrichmentV1Conformance(p);
		expect(result.failures).toEqual([]);
		expect(result.pass).toBe(true);
	});
});
