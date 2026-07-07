import { describe, expect, it } from "vitest";

import { createWasmEnrichmentProvider } from "./wasm-enrichment-provider.js";
import type { CallRespond } from "./wasm-source-provider.js";

/** A fake respond channel mimicking an enrichment plugin's guest: it routes the
 * `enrich` method and returns an EnrichmentResult, exactly as a real WASM enrichment
 * plugin's `respond` would. Proves the adapter without a daemon. */
const fakeRespond: CallRespond = async (_verb, payload) => {
	const { method, inputs, mode } = JSON.parse(payload) as {
		method: string;
		inputs: Array<{ id: string }>;
		mode: string;
	};
	if (method !== "enrich") throw new Error(`unexpected method ${method}`);
	return JSON.stringify({
		mode,
		records: inputs.map((i) => ({
			id: i.id,
			skipped: null,
			changes: [
				{
					field: "wasm.tag",
					before: undefined,
					after: "enriched",
					provenance: { providerId: "wasm-enrich", ruleId: "r", key: i.id, hash: "h", at: "t" },
				},
			],
		})),
		diagnostics: { total: inputs.length, enriched: inputs.length, skipped: 0, byCode: {} },
	});
};

describe("createWasmEnrichmentProvider — enrichment backed by a WASM plugin's respond", () => {
	function provider(callRespond: CallRespond = fakeRespond) {
		return createWasmEnrichmentProvider({ pluginId: "enrich-ref", callRespond });
	}

	it("is an enrichment:v1 provider with the plugin's id", () => {
		const p = provider();
		expect(p.capability).toBe("enrichment:v1");
		expect(p.pluginId).toBe("enrich-ref");
		expect(p.describe().needsKeyFrom).toEqual(["externalKey"]);
	});

	it("select() filters locally to inputs carrying the key field (synchronous)", () => {
		const p = provider();
		const selected = p.select([
			{ id: "a", fields: { externalKey: "K1" } },
			{ id: "b", fields: {} }, // no externalKey → filtered out
		]);
		expect(selected.map((s) => s.id)).toEqual(["a"]);
	});

	it("enrich() marshals to the guest respond and returns the EnrichmentResult", async () => {
		const result = await provider().enrich([{ id: "a", fields: { externalKey: "K1" } }], {
			mode: "apply",
		});
		expect(result.mode).toBe("apply");
		expect(result.records[0]?.changes[0]?.after).toBe("enriched");
		expect(result.diagnostics.enriched).toBe(1);
	});

	it("passes the enrichment:enrich verb + method payload the sidecar route expects", async () => {
		const calls: Array<{ verb: string; payload: string }> = [];
		const spy: CallRespond = async (verb, payload) => {
			calls.push({ verb, payload });
			return JSON.stringify({ mode: "dry-run", records: [], diagnostics: { total: 0, enriched: 0, skipped: 0, byCode: {} } });
		};
		await provider(spy).enrich([{ id: "a", fields: { externalKey: "K1" } }]);
		expect(calls[0]?.verb).toBe("enrichment:enrich");
		const parsed = JSON.parse(calls[0]!.payload) as { method: string; mode: string };
		expect(parsed.method).toBe("enrich");
		expect(parsed.mode).toBe("dry-run");
	});
});
