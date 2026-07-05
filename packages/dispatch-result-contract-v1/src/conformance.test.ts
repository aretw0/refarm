import { describe, expect, it } from "vitest";

import {
	buildDispatchResultNode,
	dispatchResultId,
	serializeDispatchResult,
} from "./builders.js";
import { runDispatchResultV1Conformance } from "./conformance.js";
import {
	isDispatchResultNode,
	matchDispatchResults,
	parseDispatchResult,
} from "./match.js";
import {
	DISPATCH_RESULT_CAPABILITY,
	DISPATCH_RESULT_TYPE,
} from "./types.js";

describe("dispatch-result:v1 constants + builder", () => {
	it("exposes the capability id and canonical @type", () => {
		expect(DISPATCH_RESULT_CAPABILITY).toBe("dispatch-result:v1");
		expect(DISPATCH_RESULT_TYPE).toBe("refarm:DispatchResult");
	});

	it("builds a correlated node with a deterministic @id", () => {
		const node = buildDispatchResultNode({
			replyRef: "effort-1",
			verb: "extract",
			result: { n: 1 },
		});
		expect(node["@type"]).toBe(DISPATCH_RESULT_TYPE);
		expect(node["refarm:replyRef"]).toBe("effort-1");
		expect(node["refarm:verb"]).toBe("extract");
		expect(node["refarm:result"]).toEqual({ n: 1 });
		expect(node["@id"]).toBe(dispatchResultId("effort-1", "extract"));
		expect(node["@id"]).toBe("refarm:DispatchResult:effort-1:extract");
	});

	it("omits the verb field when no verb is given", () => {
		const node = buildDispatchResultNode({ replyRef: "e", result: 1 });
		expect(node["refarm:verb"]).toBeUndefined();
		expect(node["@id"]).toBe("refarm:DispatchResult:e");
	});
});

describe("consumer: content-based correlation (no fragile formula)", () => {
	const stored = [
		serializeDispatchResult({ replyRef: "e1", verb: "extract", result: { a: 1 } }),
		JSON.stringify({ "@type": "refarm:SomethingElse", value: 9 }),
		serializeDispatchResult({ replyRef: "e2", verb: "search", result: { hits: [] } }),
		serializeDispatchResult({ replyRef: "e1", verb: "profile", result: { ok: true } }),
	];

	it("recovers only the results for one replyRef", () => {
		const mine = matchDispatchResults(stored, "e1");
		expect(mine).toHaveLength(2);
		expect(mine.every((n) => n["refarm:replyRef"] === "e1")).toBe(true);
	});

	it("a second caller recovers only its own", () => {
		expect(matchDispatchResults(stored, "e2")).toHaveLength(1);
	});

	it("the verb filter narrows within one replyRef", () => {
		expect(matchDispatchResults(stored, "e1", "extract")).toHaveLength(1);
		expect(matchDispatchResults(stored, "e1", "extract")[0]?.["refarm:result"]).toEqual({ a: 1 });
	});

	it("ignores non-result nodes and never throws on garbage", () => {
		expect(matchDispatchResults(["{ not json", "42", "null"], "e1")).toEqual([]);
	});
});

describe("type guard + parse", () => {
	it("isDispatchResultNode accepts a well-formed node, rejects others", () => {
		expect(isDispatchResultNode(buildDispatchResultNode({ replyRef: "x", result: 0 }))).toBe(true);
		expect(isDispatchResultNode({ "@type": "other", "refarm:replyRef": "x" })).toBe(false);
		expect(isDispatchResultNode({ "@type": DISPATCH_RESULT_TYPE })).toBe(false);
		expect(isDispatchResultNode(null)).toBe(false);
	});

	it("parseDispatchResult returns undefined for a non-result node", () => {
		expect(parseDispatchResult(JSON.stringify({ "@type": "x" }))).toBeUndefined();
		expect(parseDispatchResult("{ not json")).toBeUndefined();
	});
});

describe("conformance harness", () => {
	it("the round-trip passes conformance", () => {
		const result = runDispatchResultV1Conformance();
		expect(result.failures).toEqual([]);
		expect(result.pass).toBe(true);
	});
});
