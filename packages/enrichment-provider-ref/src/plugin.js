// An enrichment:v1 PROVIDER as a refarm `integration` plugin — the enrichment twin of
// source-provider-ref, and the proof that a domain LOOKUP comes in as a real WASM
// extension, not an imported TS dep. It reuses the CANONICAL `integration` interface
// (the doctrine is ONE interface — a plugin is what it IMPLEMENTS), and does its lookup
// work in `respond`: the SYNCHRONOUS request/response channel. The host calls
// `respond(JSON{method:"enrich", inputs, mode})` and reads the EnrichmentResult JSON
// reply directly — no graph round-trip, no dispatch-result node.
//
// `enrich` is the I/O-shaped step a sandboxed plugin owns (a real registry lookup — CNPJ,
// an external system). Here it's an offline reference table keyed by an input field, so
// the mechanism is provable without a network. Real domain data lives with the work app.

/** The offline lookup table, keyed by the input's `externalKey`. Adds domain fields. */
const LOOKUP = {
	"REQ-1": { "req.prioridade": "alta", "req.modulo": "cadastro" },
	"REQ-2": { "req.prioridade": "media", "req.modulo": "validacao" },
};

const PROVIDER_ID = "enrichment-provider-ref";
const KEY_FIELD = "externalKey";

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

/** Enrich the inputs against the lookup table, producing an EnrichmentResult. Each input
 * whose key resolves to a table entry gets one change per added field; a missing key is
 * skipped with `no-key`. PURE — no host effects, no round-trip. */
function enrich(inputs, mode) {
	const records = [];
	let enriched = 0;
	let skipped = 0;
	const byCode = {};

	for (const input of Array.isArray(inputs) ? inputs : []) {
		const key = input?.fields?.[KEY_FIELD];
		const entry = typeof key === "string" ? LOOKUP[key] : undefined;
		if (!entry) {
			skipped += 1;
			byCode["no-key"] = (byCode["no-key"] ?? 0) + 1;
			records.push({ id: input?.id ?? "", changes: [], skipped: { code: "no-key" } });
			continue;
		}
		const changes = Object.entries(entry).map(([field, after]) => ({
			field,
			before: input.fields[field] ?? null,
			after,
			provenance: {
				providerId: PROVIDER_ID,
				key,
				sourceRef: `wasm:enrichment-provider-ref#${key}`,
				hash: `ref-${key}-${field}`,
				at: "1970-01-01T00:00:00Z",
			},
		}));
		enriched += 1;
		records.push({ id: input.id, changes });
	}

	return {
		mode: mode === "apply" ? "apply" : "dry-run",
		records,
		diagnostics: { total: records.length, enriched, skipped, byCode },
	};
}

/** Route an enrichment:v1 method to its JSON result. */
function handle(request) {
	switch (request.method) {
		case "enrich":
			return enrich(request.inputs, request.mode);
		case "describe":
			return {
				providerId: PROVIDER_ID,
				needsKeyFrom: [KEY_FIELD],
				addsFields: ["req.prioridade", "req.modulo"],
			};
		case "capability":
			return { capability: "enrichment:v1", pluginId: PROVIDER_ID };
		default:
			return { error: `unknown enrichment method "${request.method}"` };
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
			name: "enrichment-provider-ref",
			version: "0.1.0",
			description: "enrichment:v1 provider as a WASM extension — respond routes by method",
			supportedTypes: [],
			requiredCapabilities: [],
		};
	},
	onEvent(_event, _payload) {
		// This provider serves via respond (synchronous), not event dispatch.
	},
	// The provider surface: a synchronous JSON request/response over the canonical
	// `respond` export. jco lowers WIT `result<string, plugin-error>` to the JS exception
	// convention: RETURN the success string; THROW (with a `.payload` tagged variant) on
	// error. Returning a `{tag:"ok"}` object traps.
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
