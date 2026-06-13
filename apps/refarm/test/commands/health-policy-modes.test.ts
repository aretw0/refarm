import { afterEach, describe, expect, it, vi } from "vitest";
import { healthCommand } from "../../src/commands/health.js";

describe("health policy modes", () => {
	afterEach(() => {
		process.exitCode = undefined;
	});

	it("prints JSON recovery for ambiguous policy mode combinations", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await healthCommand.parseAsync([
			"--policy",
			"--apply-suggested-policy",
			"--json",
		], { from: "user" });

		expect(process.exitCode).toBe(1);
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			ok: false,
			command: "health",
			operation: "policy-mode",
			error: "invalid-health-policy-mode",
			message: "Choose only one health policy mode: --policy, --suggest-policy, or --apply-suggested-policy.",
			nextAction: "Run `refarm health --help` and choose one health policy mode.",
			nextActions: ["Run `refarm health --help` and choose one health policy mode."],
			nextCommand: "refarm health --help",
			nextCommands: ["refarm health --help"],
		});
		logSpy.mockRestore();
	});
});
