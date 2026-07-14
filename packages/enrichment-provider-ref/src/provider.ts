import {
	ENRICHMENT_CAPABILITY,
	type EnrichmentInput,
	type EnrichmentOptions,
	type EnrichmentProvider,
	type EnrichmentProviderDescription,
	type EnrichmentResult,
} from "@refarm.dev/enrichment-contract-v1";

/**
 * An `enrichment:v1` provider backed by the loaded WASM plugin's `respond` — the
 * enrichment twin of `createWasmSourceProvider`. Instead of importing a TS rules
 * provider, a host loads `enrichment_provider.wasm` and this adapter presents it AS
 * an `EnrichmentProvider` by marshalling `{method, ...}` to the guest's synchronous
 * `respond` (ADR-084) and parsing its JSON reply. No import of provider code — the
 * extension IS the .wasm.
 *
 * `callRespond` is injected (defaults, in a deployment, to the sidecar's POST
 * /plugins/:id/respond) so the adapter is testable without a running daemon and
 * reusable for any respond channel — including the plugin's own `integration.respond`
 * in-process, which is how the tests prove parity with the real guest logic.
 */

/** How the adapter reaches the loaded plugin's synchronous `respond`: given a verb
 * and a JSON payload, return the guest's reply string. */
export type CallRespond = (verb: string, payload: string) => Promise<string>;

export interface WasmEnrichmentProviderOptions {
	pluginId: string;
	callRespond: CallRespond;
	/** The guest's declared description, fetched once at construction so the sync
	 * `describe()`/`select()` contract methods can answer without a round-trip. */
	description: EnrichmentProviderDescription;
}

function hasUsableKey(input: EnrichmentInput, needsKeyFrom: string[]): boolean {
	if (needsKeyFrom.length === 0) return true;
	return needsKeyFrom.some((field) => {
		const value = input.fields[field];
		return typeof value === "string" && value.length > 0;
	});
}

/** Build an `EnrichmentProvider` backed by a WASM plugin's `respond`. `describe`/
 * `select` answer synchronously from the description captured at construction;
 * `enrich` marshals to the guest. Use {@link createWasmEnrichmentProvider} to fetch
 * the description for you. */
export function createWasmEnrichmentProviderWith(
	options: WasmEnrichmentProviderOptions,
): EnrichmentProvider {
	const { pluginId, callRespond, description } = options;

	return {
		pluginId,
		capability: ENRICHMENT_CAPABILITY,

		describe(): EnrichmentProviderDescription {
			return description;
		},

		select(inputs: EnrichmentInput[]): EnrichmentInput[] {
			return inputs.filter((input) => hasUsableKey(input, description.needsKeyFrom));
		},

		async enrich(inputs: EnrichmentInput[], opts?: EnrichmentOptions): Promise<EnrichmentResult> {
			const mode = opts?.mode ?? "dry-run";
			const reply = await callRespond(
				"enrichment:enrich",
				JSON.stringify({ method: "enrich", inputs, mode }),
			);
			return JSON.parse(reply) as EnrichmentResult;
		},
	};
}

/** Build the provider, fetching the guest's `describe()` first so the sync contract
 * methods work immediately. The async wrapper a host uses. */
export async function createWasmEnrichmentProvider(options: {
	pluginId: string;
	callRespond: CallRespond;
}): Promise<EnrichmentProvider> {
	const reply = await options.callRespond(
		"enrichment:describe",
		JSON.stringify({ method: "describe" }),
	);
	const description = JSON.parse(reply) as EnrichmentProviderDescription;
	return createWasmEnrichmentProviderWith({ ...options, description });
}
