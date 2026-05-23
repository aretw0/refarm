import { afterEach, describe, expect, it, vi } from "vitest";
import { isSidecarUnavailable, printSidecarUnavailable } from "./sidecar-error.js";

describe("sidecar-error", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("recognizes transport and runtime HTTP failures as runtime unavailable", () => {
		expect(isSidecarUnavailable("fetch failed")).toBe(true);
		expect(isSidecarUnavailable("connect ECONNREFUSED 127.0.0.1:42001")).toBe(true);
		expect(isSidecarUnavailable("Runtime HTTP 503")).toBe(true);
		expect(isSidecarUnavailable("Farmhand HTTP 503")).toBe(true);
	});

	it("does not treat generic sidecar HTTP status as unavailable", () => {
		expect(isSidecarUnavailable("sidecar HTTP 404")).toBe(false);
	});

	it("prints recovery commands for runtime unavailability", () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		printSidecarUnavailable();

		const output = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("Refarm runtime is not running");
		expect(output).toContain("Status:     refarm runtime status");
		expect(output).toContain("Start now:  refarm runtime start");
		expect(output).toContain("Next:       refarm doctor --next-action");
		expect(output).toContain("Autostart:  refarm config set runtime.autostart always");
		expect(output).toContain("Engine:     refarm config set tractor.engine auto");
	});
});
