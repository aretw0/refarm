import { describe, expect, it } from "vitest";
import type { CapabilityTable } from "./contract.js";
import { rejectUnsupportedFields } from "./contract.js";

const REMOTE_LIKE: CapabilityTable = {
	id: "native",
	title: "native",
	body: "native",
	location: "unsupported",   // GitHub has no location field — this is the real case
	status: "emulated",
	priority: "emulated",
	category: "emulated",
	package: "emulated",
	axis: "emulated",
	// A remote backend carries the requirement link as a label, the same way it carries the axis.
	requirement: "emulated",
	source: "unsupported",
	resolvedBy: "emulated",
};

describe("rejectUnsupportedFields", () => {
	it("names every unsupported field the caller tried to write", () => {
		expect(rejectUnsupportedFields(REMOTE_LIKE, { location: "a.ts:1", source: "agent" })).toEqual([
			"location",
			"source",
		]);
	});

	it("allows an unsupported field that is absent or blank", () => {
		expect(rejectUnsupportedFields(REMOTE_LIKE, { title: "t", location: "   " })).toEqual([]);
	});

	it("never rejects an emulated field — emulated is supported, just not natively", () => {
		expect(rejectUnsupportedFields(REMOTE_LIKE, { axis: "cost", status: "open" })).toEqual([]);
	});
});
