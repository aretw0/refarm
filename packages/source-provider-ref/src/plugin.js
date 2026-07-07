// A source:v1 PROVIDER as a refarm `integration` plugin — the proof that a provider
// comes in as a real WASM extension, not an imported TS dep. It reuses the CANONICAL
// `integration` interface (the doctrine is ONE interface — a plugin is what it
// IMPLEMENTS), and it does its provider work in `respond`: the SYNCHRONOUS
// request/response channel. The host calls `respond(JSON{method,...})` and reads the
// JSON reply directly — no graph round-trip, no dispatch-result node.
//
// This is the extension form of a source provider: where source-web is a TS object
// the app injects, this is a .wasm the host loads and calls. `respond` routes by
// `method` to the source:v1 surface (discover / status; materialize is host-side
// filesystem work, so a WASM provider advertises + describes, the host materializes).

/** A minimal offline catalog this provider advertises via `respond({method:"discover"})`.
 * Real domain data lives with the work app; this ref proves the mechanism. */
const CATALOG = [
	{ ref: "wasm:sample-system-a", label: "Sample system A", kind: "local" },
	{ ref: "wasm:sample-system-b", label: "Sample system B", kind: "local" },
];

/** Parse the respond payload into { method, ...args }, or undefined if malformed. */
function parseRequest(payload) {
	if (typeof payload !== "string") return undefined;
	try {
		const parsed = JSON.parse(payload);
		if (!parsed || typeof parsed !== "object") return undefined;
		if (typeof parsed.method !== "string") return undefined;
		return parsed;
	} catch {
		return undefined;
	}
}

/** Route a source:v1 method to its JSON result. PURE — no host effects, no round-trip. */
function handle(request) {
	switch (request.method) {
		case "discover":
			return { entries: CATALOG };
		case "status": {
			const ref = typeof request.ref === "string" ? request.ref : "";
			const known = CATALOG.some((e) => e.ref === ref);
			return { kind: "local", materialized: false, known };
		}
		case "capability":
			return { capability: "source:v1", pluginId: "source-provider-ref" };
		default:
			return { error: `unknown source method "${request.method}"` };
	}
}

export const integration = {
	setup() {
		return { tag: "ok" };
	},
	ingest() {
		return { tag: "ok", val: 0 };
	},
	push(_payload) {
		return { tag: "ok" };
	},
	teardown() {},
	getHelpNodes() {
		return { tag: "ok", val: [] };
	},
	metadata() {
		return {
			name: "source-provider-ref",
			version: "0.1.0",
			description: "source:v1 provider as a WASM extension — respond routes by method",
			supportedTypes: [],
			requiredCapabilities: [],
		};
	},
	onEvent(_event, _payload) {
		// This provider serves via respond (synchronous), not event dispatch.
	},
	// The provider surface: a synchronous JSON request/response over the canonical
	// `respond` export. jco lowers WIT `result<string, plugin-error>` to the JS
	// exception convention: RETURN the success string directly; THROW (with a `.payload`
	// tagged variant) for the error case. Returning a `{tag:"ok"}` object traps.
	respond(payload) {
		const request = parseRequest(payload);
		if (!request) {
			throw {
				payload: { tag: "invalid-input", val: "respond payload must be JSON {method, ...}" },
			};
		}
		return JSON.stringify(handle(request));
	},
};
