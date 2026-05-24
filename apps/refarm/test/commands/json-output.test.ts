import { describe, expect, it, vi } from "vitest";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	formatJson,
	printJson,
} from "../../src/commands/json-output.js";

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
		});
	});

	it("builds a standard success envelope without a follow-up action", () => {
		expect(buildJsonSuccessEnvelope()).toEqual({
			ok: true,
			nextAction: null,
			nextActions: [],
		});
	});

	it("builds a standard success envelope with contextual next actions", () => {
		expect(
			buildJsonSuccessEnvelope({
				command: "tidy",
				operation: "imports",
				nextAction: "refarm check --next-action --json",
				extra: {
					exitCode: 0,
				},
			}),
		).toEqual({
			exitCode: 0,
			command: "tidy",
			operation: "imports",
			ok: true,
			nextAction: "refarm check --next-action --json",
			nextActions: ["refarm check --next-action --json"],
		});
	});

	it("preserves explicit next actions in error envelopes", () => {
		expect(
			buildJsonErrorEnvelope({
				error: "runtime-unavailable",
				message: "Refarm runtime is not running.",
				nextAction: "refarm runtime start",
				nextActions: ["refarm runtime status", "refarm runtime start"],
			}),
		).toEqual({
			ok: false,
			error: "runtime-unavailable",
			message: "Refarm runtime is not running.",
			nextAction: "refarm runtime start",
			nextActions: ["refarm runtime status", "refarm runtime start"],
		});
	});

	it("adds extra fields before the standard error shape", () => {
		expect(
			buildJsonErrorEnvelope({
				command: "tasks",
				operation: "show",
				error: "ambiguous-task-prefix",
				nextAction: "refarm tasks --json",
				extra: {
					schemaVersion: 1,
					prefix: "abc",
					matches: ["abc1", "abc2"],
				},
			}),
		).toEqual({
			schemaVersion: 1,
			prefix: "abc",
			matches: ["abc1", "abc2"],
			command: "tasks",
			operation: "show",
			ok: false,
			error: "ambiguous-task-prefix",
			nextAction: "refarm tasks --json",
			nextActions: ["refarm tasks --json"],
		});
	});
});
