import { describe, expect, it, vi } from "vitest";
import { formatJson, printJson } from "../../src/commands/json-output.js";

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
});
