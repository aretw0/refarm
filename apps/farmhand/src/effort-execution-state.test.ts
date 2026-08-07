import { describe, expect, it } from "vitest";
import { EffortExecutionState } from "./effort-execution-state.js";

describe("EffortExecutionState", () => {
	it("admits one in-flight execution per effort", () => {
		const state = new EffortExecutionState();

		expect(state.begin("effort-1")).toBe(true);
		expect(state.begin("effort-1")).toBe(false);
		expect(state.isInFlight("effort-1")).toBe(true);
		expect(state.inFlightCount).toBe(1);

		state.finish("effort-1");
		expect(state.isInFlight("effort-1")).toBe(false);
		expect(state.inFlightCount).toBe(0);
	});

	it("tracks cancellation independently from execution", () => {
		const state = new EffortExecutionState();
		state.requestCancellation("effort-1");

		expect(state.isCancellationRequested("effort-1")).toBe(true);
		expect(state.isInFlight("effort-1")).toBe(false);
		expect(state.cancellationCount).toBe(1);

		state.clearCancellation("effort-1");
		expect(state.isCancellationRequested("effort-1")).toBe(false);
		expect(state.cancellationCount).toBe(0);
	});
});
