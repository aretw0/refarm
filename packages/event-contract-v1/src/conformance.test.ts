import { describe, it, expect } from "vitest";
import { runEventBusConformance } from "./conformance.js";
import { createInMemoryEventBus } from "./in-memory.js";

describe("EventBus conformance — in-memory", () => {
	it("passes all conformance checks", () => {
		const result = runEventBusConformance(createInMemoryEventBus());
		expect(result.pass).toBe(true);
		expect(result.failures).toEqual([]);
	});

	it("runs at least 5 checks", () => {
		const result = runEventBusConformance(createInMemoryEventBus());
		expect(result.total).toBeGreaterThanOrEqual(5);
	});
});
