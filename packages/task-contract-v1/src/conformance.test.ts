import { describe, expect, it } from "vitest";
import { runTaskV1Conformance } from "./conformance.js";
import { createInMemoryTaskAdapter } from "./in-memory.js";

describe("runTaskV1Conformance", () => {
	it("passes with in-memory adapter", async () => {
		const adapter = createInMemoryTaskAdapter();
		const result = await runTaskV1Conformance(adapter);
		expect(result.pass).toBe(true);
		expect(result.failed).toBe(0);
		expect(result.failures).toEqual([]);
	});

	it("includes optional checks when adapter exposes optional APIs", async () => {
		const adapter = createInMemoryTaskAdapter();
		const result = await runTaskV1Conformance(adapter);
		expect(result.total).toBe(7);
	});
});
