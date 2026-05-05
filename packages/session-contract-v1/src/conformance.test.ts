import { describe, expect, it } from "vitest";
import { runSessionV1Conformance } from "./conformance.js";
import { createInMemorySessionAdapter } from "./in-memory.js";

describe("runSessionV1Conformance", () => {
	it("passes with in-memory adapter", async () => {
		const adapter = createInMemorySessionAdapter();
		const result = await runSessionV1Conformance(adapter);
		expect(result.pass).toBe(true);
		expect(result.failed).toBe(0);
		expect(result.failures).toEqual([]);
	});

	it("includes optional checks when optional APIs exist", async () => {
		const adapter = createInMemorySessionAdapter();
		const result = await runSessionV1Conformance(adapter);
		expect(result.total).toBe(5);
	});
});
