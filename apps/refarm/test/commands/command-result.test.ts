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

	it("falls back to singular handoff fields when arrays are absent or empty", () => {
		expect(commandPayloadNextActions({
			nextAction: " Start runtime. ",
		})).toEqual(["Start runtime."]);
		expect(commandPayloadNextCommands({
			nextCommand: "refarm runtime start --wait",
		})).toEqual(["refarm runtime start --wait"]);
		expect(commandPayloadNextCommands({
			nextCommand: "refarm doctor --next-command",
			nextCommands: [],
		})).toEqual(["refarm doctor --next-command"]);
	});

	it("ignores empty handoff strings", () => {
		expect(commandPayloadNextActions({
			nextAction: " ",
			nextActions: ["", "   ", null],
		})).toBeUndefined();
		expect(commandPayloadNextCommands({
			nextCommand: "",
			nextCommands: ["  ", null],
		})).toBeUndefined();
	});

	it("ignores missing or malformed command payload fields", () => {
		expect(commandPayloadOk({ ok: "false" })).toBeUndefined();
		expect(commandPayloadNextActions({ nextActions: "start" })).toBeUndefined();
		expect(commandPayloadNextCommands({ nextCommands: [] })).toBeUndefined();
		expect(commandPayloadNextCommands(null)).toBeUndefined();
	});
});
