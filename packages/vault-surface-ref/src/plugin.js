// The vault:v1 plugin as the JS entry that `jco componentize` compiles into a
// `refarm-plugin`-world component — the SAME canonical `integration` interface
// every refarm plugin exports, so the tractor host loads and calls it exactly
// like the agent (load_plugin → register_for_events → call_on_event). This is the
// bridge that runs vault verbs through the REAL runtime, no tractor edits.
//
// The runtime only CALLS setup/ingest/teardown/metadata/on-event; respond/push/
// get-help-nodes are declared but dead channels. So the one live, payload-bearing
// entrypoint is `on-event`: a caller sends `vault:dispatch` with a JSON payload
// `{ verb, note, profile, replyRef? }`; the plugin runs the pure vault core and,
// because on-event returns nothing, emits each result OUT through the host's
// `tractor-bridge store-node` as a JSON-LD node — the exact side channel the agent
// uses. Input travels in via the payload; output travels out as persisted nodes.

import { storeNode } from "refarm:plugin/tractor-bridge@0.1.0";

import { runVault } from "./run-core.js";

/** The event a caller sends to dispatch a vault verb. */
const DISPATCH_EVENT = "vault:dispatch";

/** The @type stamped on emitted result nodes so a caller can query them back. */
const RESULT_TYPE = "refarm:VaultDispatchResult";

/** Parse the on-event payload into a dispatch request, or undefined if malformed. */
function parseDispatch(payload) {
	if (typeof payload !== "string") return undefined;
	try {
		const parsed = JSON.parse(payload);
		if (!parsed || typeof parsed !== "object") return undefined;
		const { verb, note, profile } = parsed;
		if (typeof verb !== "string") return undefined;
		if (!note || typeof note !== "object") return undefined;
		if (!profile || typeof profile !== "object") return undefined;
		return { verb, note, profile, replyRef: parsed.replyRef };
	} catch {
		return undefined;
	}
}

/**
 * Emit a vault result through the host. The extract verb's records already ARE
 * JSON-LD-shaped KnowledgeRecords (record-json.json); other verbs' outputs are
 * wrapped in a result node keyed by replyRef so a caller can query-nodes them.
 */
function emitResult(request, result) {
	// extract: each KnowledgeRecord is stored as its own JSON-LD node.
	for (const record of result.records) {
		try {
			storeNode(record.json);
		} catch {
			// A store failure on one record must not abort the rest (advisory).
		}
	}
	// search/organize/profile (and a summary of extract): one result node carrying
	// the whole VaultResult, tagged so the caller can find it by replyRef.
	const resultNode = {
		"@type": RESULT_TYPE,
		"@id": request.replyRef
			? `${RESULT_TYPE}:${request.replyRef}`
			: `${RESULT_TYPE}:${request.verb}:${request.note.path}`,
		"refarm:verb": request.verb,
		"refarm:replyRef": request.replyRef ?? null,
		"refarm:result": result,
	};
	try {
		storeNode(JSON.stringify(resultNode));
	} catch {
		// advisory: the per-record nodes may still have landed.
	}
}

export const integration = {
	setup() {
		// No host handshake needed; a vault surface is pure compute.
		return { tag: "ok" };
	},
	ingest() {
		// Vault does not pull an external source on ingest; dispatch is event-driven.
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
			name: "vault",
			version: "0.1.0",
			description: "vault:v1 surface — search/extract/organize/profile over a note",
			supportedTypes: [RESULT_TYPE, "refarm:VaultRecord"],
			requiredCapabilities: ["tractor-bridge"],
		};
	},
	onEvent(event, payload) {
		if (event !== DISPATCH_EVENT) return;
		const request = parseDispatch(payload);
		if (!request) return;
		const result = runVault(request.verb, request.note, request.profile);
		emitResult(request, result);
	},
	respond(_payload) {
		// The runtime never calls respond today (a dead channel); vault dispatch
		// rides on-event instead. Stub it per the interface convention.
		return { tag: "err", val: { tag: "not-permitted", val: "vault dispatches via on-event 'vault:dispatch'" } };
	},
};
