// The quality:v1 checker as an `integration`-world plugin — the SECOND real
// consumer of dispatch-result:v1 (the vault is the first), proving the async
// result-envelope contract generalizes across plugin FAMILIES (quality, not
// vault). It is the runtime-plugin form of the quality checker: where
// quality-checker-ref is the sandbox-by-absence WASM component (world imports
// nothing), this exports the canonical `integration` interface, imports
// tractor-bridge, and runs on the real runtime like the agent and the vault.
//
// It reuses runRegexQualityRules from quality-contract-v1 (no duplicated matcher
// — the same logic the contract's conformance pins), and emits its findings
// through the shared dispatch-result:v1 contract, so a caller correlates a
// quality result by replyRef EXACTLY as it does a vault result. One contract, two
// families.

import {
	DISPATCH_RESULT_TYPE,
	serializeDispatchResult,
} from "@refarm.dev/dispatch-result-contract-v1";
import { runRegexQualityRules } from "@refarm.dev/quality-contract-v1";
import { storeNode } from "host:plugin/tractor-bridge@0.1.0";

/** The event a caller sends to dispatch a quality check. */
const DISPATCH_EVENT = "quality:dispatch";

/** Parse the on-event payload into a check request, or undefined if malformed. */
function parseDispatch(payload) {
	if (typeof payload !== "string") return undefined;
	try {
		const parsed = JSON.parse(payload);
		if (!parsed || typeof parsed !== "object") return undefined;
		const { subject, profile } = parsed;
		if (typeof subject !== "string") return undefined;
		if (!profile || typeof profile !== "object") return undefined;
		return { subject, profile, replyRef: parsed.replyRef };
	} catch {
		return undefined;
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
			name: "quality",
			version: "0.1.0",
			description: "quality:v1 checker — regex findings over a text subject",
			supportedTypes: [DISPATCH_RESULT_TYPE],
			requiredCapabilities: ["tractor-bridge"],
		};
	},
	onEvent(event, payload) {
		if (event !== DISPATCH_EVENT) return;
		const request = parseDispatch(payload);
		if (!request) return;
		const findings = runRegexQualityRules(request.subject, request.profile);
		try {
			storeNode(
				serializeDispatchResult({
					replyRef: request.replyRef ?? `quality:${request.profile.name ?? "check"}`,
					verb: "check",
					result: { findings },
				}),
			);
		} catch {
			// advisory: a store failure must not throw out of on-event.
		}
	},
	respond(_payload) {
		return {
			tag: "err",
			val: { tag: "not-permitted", val: "quality dispatches via on-event 'quality:dispatch'" },
		};
	},
};
