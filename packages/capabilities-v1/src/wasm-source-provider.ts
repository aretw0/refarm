import type {
	SourceCatalog,
	SourceLocation,
	SourceProvider,
	SourceStatus,
	MaterializeResult,
	MaterializeOptions,
} from "@refarm.dev/source-contract-v1";

/**
 * A `source:v1` provider backed by a loaded WASM plugin — the payoff of "import less,
 * extend more". Instead of importing a TS provider (source-web), a host loads a plugin
 * `.wasm` and this adapter presents it AS a `SourceProvider` by calling the plugin's
 * synchronous `respond` (ADR-084) through an injected transport. The provider's methods
 * marshal `{method, ...}` to the guest's `respond` and parse its JSON reply — no import
 * of provider code, the extension IS the .wasm.
 *
 * `callRespond` is injected (defaults to the sidecar's POST /plugins/:id/respond) so the
 * adapter is testable without a running daemon and reusable for any respond channel.
 */

/** How the adapter reaches a loaded plugin's synchronous `respond`. Given a verb and a
 * JSON payload, it returns the guest's reply string. The default implementation POSTs
 * to the tractor sidecar's `/plugins/:id/respond`. */
export type CallRespond = (verb: string, payload: string) => Promise<string>;

export interface WasmSourceProviderOptions {
	/** The loaded plugin's id (the sidecar route target). */
	pluginId: string;
	/** How to invoke the plugin's respond. Injected; defaults to the sidecar POST. */
	callRespond: CallRespond;
}

/** Build a `SourceProvider` backed by a WASM plugin's `respond`. The provider offers the
 * verbs the plugin declared synchronous (discover/status here); the materialize/resolve
 * side — which needs host filesystem effects — is delegated to a host-side provider in a
 * real deployment, so this adapter rejects them with a clear message rather than faking
 * them. Discovery + status are the pure, ref-closed surface a WASM provider serves. */
export function createWasmSourceProvider(
	options: WasmSourceProviderOptions,
): SourceProvider {
	const { pluginId, callRespond } = options;

	async function call(method: string, extra: Record<string, unknown> = {}): Promise<unknown> {
		const reply = await callRespond(`source:${method}`, JSON.stringify({ method, ...extra }));
		return JSON.parse(reply);
	}

	const unsupported = (verb: string): never => {
		throw new Error(
			`source-provider "${pluginId}" serves discover/status via WASM respond; ${verb} needs host filesystem effects and is delegated to a host-side provider`,
		);
	};

	return {
		pluginId,
		capability: "source:v1",
		kinds: ["local"],

		async discover(): Promise<SourceCatalog> {
			const catalog = (await call("discover")) as SourceCatalog;
			return { entries: Array.isArray(catalog.entries) ? catalog.entries : [] };
		},

		async status(ref: string): Promise<SourceStatus> {
			return (await call("status", { ref })) as SourceStatus;
		},

		// The materialize/resolve/refresh surface needs host fs effects a sandboxed WASM
		// provider doesn't have — a real host composes this discovery adapter with a
		// host-side materializer. Rejected clearly rather than faked.
		async resolve(): Promise<SourceLocation> {
			return unsupported("resolve");
		},
		async materialize(_ref: string, _opts?: MaterializeOptions): Promise<MaterializeResult> {
			return unsupported("materialize");
		},
		async refresh(_ref: string, _opts?: MaterializeOptions): Promise<MaterializeResult> {
			return unsupported("refresh");
		},
	};
}
