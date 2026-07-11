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

import {
	DISPATCH_RESULT_TYPE,
	serializeDispatchResult,
} from "@refarm.dev/dispatch-result-contract-v1";
import { callPlugin, getPluginApi, storeNode } from "plugin:host/tractor-bridge@0.1.0";

import { runVault } from "./run-core.js";

/** The SPI api name the vault discovers + calls to validate record quality. Vault
 * declares `requiresApi: ["QualityApi"]`; quality declares `providesApi: ["QualityApi"]`. */
const QUALITY_API = "QualityApi";

/** Verbs whose output vault validates for quality before persisting. */
const QUALITY_GATED_VERBS = new Set(["organize", "extract"]);

/**
 * Validate a record's quality via the SPI before persisting — the consumer side of
 * the cross-plugin contract. Discovers the provider (get-plugin-api) and calls it
 * (call-plugin → quality:check). Advisory + lazy: if no provider is loaded,
 * get-plugin-api throws and vault proceeds without the check (honest degradation,
 * matching requiresApi's warn-not-bail posture). Returns the provider's result
 * string, or undefined when the check couldn't run.
 */
function checkQuality(request) {
	try {
		// `get-plugin-api` returns `result<node-id, plugin-error>`; the jco binding
		// surfaces it as a `{ tag, val }` result (not a bare string / thrown error),
		// so read the tag before using the id.
		const discovered = getPluginApi(QUALITY_API);
		const providerId = resultOk(discovered);
		if (typeof providerId !== "string") return undefined; // no provider loaded
		const res = callPlugin(
			providerId,
			"check",
			JSON.stringify({
				subject: request.note.text ?? "",
				profile: request.profile,
			}),
		);
		return resultOk(res);
	} catch {
		// Provider absent / call failed → degrade gracefully; persistence proceeds.
		return undefined;
	}
}

/** Unwrap a jco `result` `{ tag: "ok"|"err", val }` to its Ok value, or undefined.
 * Tolerates a bare value too (some bindings return the Ok payload directly). */
function resultOk(result) {
	if (result && typeof result === "object" && "tag" in result) {
		return result.tag === "ok" ? result.val : undefined;
	}
	return result;
}

/** The event a caller sends to dispatch a vault verb. */
const DISPATCH_EVENT = "vault:dispatch";

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
	// search/organize/profile (and a summary of extract): one correlated result
	// node via the shared dispatch-result:v1 contract, so a caller recovers it by
	// replyRef the same way for EVERY async plugin (no per-plugin @type to learn).
	try {
		storeNode(
			serializeDispatchResult({
				replyRef: request.replyRef ?? `${request.verb}:${request.note.path}`,
				verb: request.verb,
				result,
			}),
		);
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
			supportedTypes: [DISPATCH_RESULT_TYPE, "VaultRecord"],
			requiredCapabilities: ["tractor-bridge"],
		};
	},
	onEvent(event, payload) {
		if (event !== DISPATCH_EVENT) return;
		const request = parseDispatch(payload);
		if (!request) return;
		// SPI: before persisting an organize/extract result, validate its quality
		// through the discovered quality provider. Advisory — never blocks the verb.
		if (QUALITY_GATED_VERBS.has(request.verb)) {
			checkQuality(request);
		}
		const result = runVault(request.verb, request.note, request.profile);
		emitResult(request, result);
	},
	respond(_payload) {
		// The runtime never calls respond today (a dead channel); vault dispatch
		// rides on-event instead. Stub it per the interface convention.
		return {
			tag: "err",
			val: { tag: "not-permitted", val: "vault dispatches via on-event 'vault:dispatch'" },
		};
	},
};
