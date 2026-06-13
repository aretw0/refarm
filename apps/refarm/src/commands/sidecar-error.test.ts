import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildRuntimeUnavailableRecommendation,
	buildSidecarErrorPayload,
	isSidecarUnavailable,
	printSidecarUnavailable,
} from "./sidecar-error.js";

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
		expect(output).toContain("Ensure:     refarm runtime ensure --wait --next-command");
		expect(output).toContain("Start:      refarm runtime start");
		expect(output).toContain("Next:       refarm doctor --next-action");
		expect(output).toContain("Command:    refarm doctor --next-command");
		expect(output).toContain("Autostart:  refarm config set runtime.autostart always");
		expect(output).toContain("Engine:     refarm config set tractor.engine auto");
	});

	it("includes executable recovery commands in runtime unavailable JSON", () => {
		expect(buildSidecarErrorPayload("fetch failed")).toMatchObject({
			ok: false,
			error: "runtime-unavailable",
			nextAction: "refarm runtime ensure --wait --next-command",
			nextCommand: "refarm runtime ensure --wait --next-command",
			nextCommands: [
				"refarm runtime ensure --wait --next-command",
				"refarm runtime start --wait",
				"refarm doctor --next-command",
			],
			recommendations: [
				expect.objectContaining({
					diagnostic: "runtime:unavailable",
					severity: "failure",
					command: "refarm runtime ensure --wait --next-command",
				}),
			],
		});
	});

	it("builds runtime unavailable recommendations with contextual overrides", () => {
		expect(
			buildRuntimeUnavailableRecommendation({
				summary: "Runtime is unavailable while submitting a task.",
				action: "Ensure the runtime, then retry the task.",
			}),
		).toEqual({
			diagnostic: "runtime:unavailable",
			severity: "failure",
			summary: "Runtime is unavailable while submitting a task.",
			action: "Ensure the runtime, then retry the task.",
			command: "refarm runtime ensure --wait --next-command",
		});
	});

	it("includes executable doctor command for generic runtime request failures", () => {
		expect(buildSidecarErrorPayload("sidecar HTTP 500")).toMatchObject({
			ok: false,
			error: "runtime-request-failed",
			nextAction: "refarm doctor --next-action",
			nextCommand: "refarm doctor --next-command",
			nextCommands: ["refarm doctor --next-command"],
			recommendations: [
				expect.objectContaining({
					diagnostic: "runtime:request-failed",
					severity: "failure",
					command: "refarm doctor --next-command",
				}),
			],
		});
	});
});
