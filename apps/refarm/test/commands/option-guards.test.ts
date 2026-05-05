import { describe, expect, it } from "vitest";
import { assertAtMostOneFlagEnabled } from "../../src/commands/option-guards.js";

describe("assertAtMostOneFlagEnabled", () => {
	it("allows zero or one flag enabled", () => {
		expect(() =>
			assertAtMostOneFlagEnabled([
				{ flag: "--json", enabled: false },
				{ flag: "--markdown", enabled: false },
			]),
		).not.toThrow();

		expect(() =>
			assertAtMostOneFlagEnabled([
				{ flag: "--json", enabled: true },
				{ flag: "--markdown", enabled: false },
			]),
		).not.toThrow();
	});

	it("throws with provided message when multiple flags are enabled", () => {
		expect(() =>
			assertAtMostOneFlagEnabled(
				[
					{ flag: "--json", enabled: true },
					{ flag: "--markdown", enabled: true },
				],
				"Choose only one output format: --json or --markdown.",
			),
		).toThrow(/Choose only one output format/);
	});

	it("throws with default message when message is omitted", () => {
		expect(() =>
			assertAtMostOneFlagEnabled([
				{ flag: "--json", enabled: true },
				{ flag: "--markdown", enabled: true },
			]),
		).toThrow(/Choose only one option/);
	});
});
