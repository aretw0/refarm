import type {
	EnrichmentInput,
	EnrichmentOptions,
	EnrichmentProvider,
	EnrichmentProviderDescription,
	EnrichmentResult,
} from "@refarm.dev/enrichment-contract-v1";

import type { CallRespond } from "./wasm-source-provider.js";

/**
 * An `enrichment:v1` provider backed by a loaded WASM plugin — the enrichment twin of
 * createWasmSourceProvider. Enrichment is the RIGHT contract to run as a WASM extension:
 * `enrich` is the async, I/O-shaped step (a real lookup — CNPJ, an external registry),
 * exactly the remote work a sandboxed plugin does. So `enrich` marshals `{method,...}`
 * to the plugin's synchronous `respond` and parses the JSON result.
 *
 * `select` and `describe` are light, synchronous shaping — this adapter handles them
 * locally (select filters by the key field the provider needs; describe is metadata) so
 * the plugin only implements the one method that actually reaches out. `callRespond` is
 * injected (defaults to the sidecar POST), reusing the same channel as the source
 * adapter.
 */

export interface WasmEnrichmentProviderOptions {
	/** The loaded plugin's id (the sidecar route target). */
	pluginId: string;
	/** How to invoke the plugin's respond. Injected; defaults to the sidecar POST. */
	callRespond: CallRespond;
	/** The input field the provider keys enrichment off (default `externalKey`). Used to
	 * filter `select` locally, mirroring the reference provider's keyField. */
	keyField?: string;
}

/** Build an `EnrichmentProvider` backed by a WASM plugin's `respond`. */
export function createWasmEnrichmentProvider(
	options: WasmEnrichmentProviderOptions,
): EnrichmentProvider {
	const { pluginId, callRespond } = options;
	const keyField = options.keyField ?? "externalKey";

	return {
		pluginId,
		capability: "enrichment:v1",

		describe(): EnrichmentProviderDescription {
			return { providerId: pluginId, needsKeyFrom: [keyField], addsFields: [] };
		},

		// Local, synchronous: only inputs that carry the key field can be enriched.
		select(inputs: EnrichmentInput[]): EnrichmentInput[] {
			return inputs.filter((input) => typeof input.fields[keyField] === "string");
		},

		// The remote step: marshal the selected inputs to the plugin's respond and parse
		// its EnrichmentResult. This is the I/O-shaped method a WASM extension owns.
		async enrich(inputs: EnrichmentInput[], opts?: EnrichmentOptions): Promise<EnrichmentResult> {
			opts?.signal?.throwIfAborted();
			const mode = opts?.mode ?? "dry-run";
			const reply = await callRespond(
				"enrichment:enrich",
				JSON.stringify({ method: "enrich", inputs, mode }),
			);
			return JSON.parse(reply) as EnrichmentResult;
		},
	};
}
