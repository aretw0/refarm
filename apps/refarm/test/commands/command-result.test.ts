import { describe, expect, it } from "vitest";
import {
	commandPayloadNextActions,
	commandPayloadNextCommands,
	commandPayloadOk,
	parseCommandJsonPayload,
} from "../../src/commands/command-result.js";

describe("command result helpers", () => {
	it("parses JSON payloads from command stdout", () => {
		expect(parseCommandJsonPayload('{"ok":true}\n')).toEqual({ ok: true });
		expect(parseCommandJsonPayload("")).toBeUndefined();
		expect(parseCommandJsonPayload("not json")).toBeUndefined();
	});

	it("reads ok and handoff arrays from payloads", () => {
		const payload = {
			ok: false,
			nextActions: ["Start runtime.", 1, "Inspect diagnostics."],
			nextCommands: ["refarm runtime start --wait", null],
		};

		expect(commandPayloadOk(payload)).toBe(false);
		expect(commandPayloadNextActions(payload)).toEqual([
			"Start runtime.",
			"Inspect diagnostics.",
		]);
		expect(commandPayloadNextCommands(payload)).toEqual([
			"refarm runtime start --wait",
		]);
	});

	it("ignores missing or malformed command payload fields", () => {
		expect(commandPayloadOk({ ok: "false" })).toBeUndefined();
		expect(commandPayloadNextActions({ nextActions: "start" })).toBeUndefined();
		expect(commandPayloadNextCommands({ nextCommands: [] })).toBeUndefined();
		expect(commandPayloadNextCommands(null)).toBeUndefined();
	});
});
