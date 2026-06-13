import { describe, expect, it, vi } from "vitest";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	formatJson,
	printJson,
} from "./json-output.js";

describe("json output helpers", () => {
	it("formats stable pretty JSON", () => {
		expect(formatJson({ ok: true, nextAction: null })).toBe(
			'{\n  "ok": true,\n  "nextAction": null\n}',
		);
	});

	it("prints formatted JSON", () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		printJson({ ok: true });

		expect(logSpy).toHaveBeenCalledWith('{\n  "ok": true\n}');
		logSpy.mockRestore();
	});

	it("builds a standard error envelope with one fallback action", () => {
		expect(
			buildJsonErrorEnvelope({
				command: "tasks",
				operation: "show",
				error: "task-not-found",
				nextAction: "refarm tasks --json",
			}),
		).toEqual({
			command: "tasks",
			operation: "show",
			ok: false,
			error: "task-not-found",
			nextAction: "refarm tasks --json",
			nextActions: ["refarm tasks --json"],
			nextCommand: null,
			nextCommands: [],
		});
	});

	it("builds a standard success envelope without a follow-up action", () => {
		expect(buildJsonSuccessEnvelope()).toEqual({
			ok: true,
			nextAction: null,
			nextActions: [],
			nextCommand: null,
			nextCommands: [],
		});
	});

	it("keeps singular next commands first in plural command lists", () => {
		expect(
			buildJsonSuccessEnvelope({
				nextAction: " Inspect diagnostics. ",
				nextActions: ["Start runtime.", "Inspect diagnostics."],
				nextCommand: " refarm doctor --next-command ",
				nextCommands: [
					"refarm runtime ensure --wait --next-command",
					"refarm doctor --next-command",
				],
			}),
		).toMatchObject({
			nextAction: "Inspect diagnostics.",
			nextActions: ["Start runtime.", "Inspect diagnostics."],
			nextCommand: "refarm doctor --next-command",
			nextCommands: [
				"refarm doctor --next-command",
				"refarm runtime ensure --wait --next-command",
			],
		});
	});

	it("preserves explicit next actions in error envelopes", () => {
		expect(
			buildJsonErrorEnvelope({
				error: "runtime-unavailable",
				message: "Refarm runtime is not running.",
				nextAction: "refarm runtime start",
				nextActions: ["refarm runtime status", "refarm runtime start"],
				nextCommands: ["refarm runtime start --wait"],
			}),
		).toEqual({
			ok: false,
			error: "runtime-unavailable",
			message: "Refarm runtime is not running.",
			nextAction: "refarm runtime start",
			nextActions: ["refarm runtime status", "refarm runtime start"],
			nextCommand: "refarm runtime start --wait",
			nextCommands: ["refarm runtime start --wait"],
		});
	});
});
