import { describe, it, expect } from "vitest";
import { runEffortV1Conformance } from "./conformance.js";
import { createInMemoryEffortAdapter } from "./in-memory.js";

describe("EffortTransportAdapter conformance — in-memory (done)", () => {
	it("passes all conformance checks", async () => {
		const adapter = createInMemoryEffortAdapter({ resolve: "done" });
		const result = await runEffortV1Conformance(adapter);
		expect(result.failures).toEqual([]);
		expect(result.pass).toBe(true);
	});

	it("runs the full check suite", async () => {
		const adapter = createInMemoryEffortAdapter();
		const result = await runEffortV1Conformance(adapter);
		expect(result.total).toBeGreaterThanOrEqual(7);
	});
});

describe("EffortTransportAdapter conformance — in-memory (failed)", () => {
	it("passes protocol checks even when resolving as failed", async () => {
		const adapter = createInMemoryEffortAdapter({ resolve: "failed" });
		const result = await runEffortV1Conformance(adapter);
		expect(result.failures).toEqual([]);
		expect(result.pass).toBe(true);
	});
});

describe("createInMemoryEffortAdapter — unit", () => {
	it("submit returns the effort id", async () => {
		const adapter = createInMemoryEffortAdapter();
		const id = await adapter.submit({
			id: "e1",
			direction: "test",
			tasks: [{ id: "t1", pluginId: "p", fn: "f" }],
			submittedAt: new Date().toISOString(),
		});
		expect(id).toBe("e1");
	});

	it("query returns null for unknown id", async () => {
		const adapter = createInMemoryEffortAdapter();
		expect(await adapter.query("nope")).toBeNull();
	});

	it("cancel returns false for already-done effort", async () => {
		const adapter = createInMemoryEffortAdapter({ resolve: "done" });
		const id = await adapter.submit({
			id: "e-done",
			direction: "test",
			tasks: [{ id: "t1", pluginId: "p", fn: "f" }],
			submittedAt: new Date().toISOString(),
		});
		const result = await adapter.cancel!(id);
		expect(result).toBe(false);
	});

	it("logs() returns entries after submit", async () => {
		const adapter = createInMemoryEffortAdapter();
		await adapter.submit({
			id: "e-logs",
			direction: "test",
			tasks: [{ id: "t1", pluginId: "p", fn: "f" }],
			submittedAt: new Date().toISOString(),
		});
		const logs = await adapter.logs!("e-logs");
		expect(logs).not.toBeNull();
		expect(logs!.length).toBeGreaterThan(0);
		expect(logs!.some((l) => l.event === "submitted")).toBe(true);
	});

	it("summary() counts correctly", async () => {
		const adapter = createInMemoryEffortAdapter();
		for (let i = 0; i < 3; i++) {
			await adapter.submit({
				id: `e${i}`,
				direction: "test",
				tasks: [{ id: `t${i}`, pluginId: "p", fn: "f" }],
				submittedAt: new Date().toISOString(),
			});
		}
		const summary = await adapter.summary!();
		expect(summary.total).toBe(3);
		expect(summary.done).toBe(3);
	});
});
