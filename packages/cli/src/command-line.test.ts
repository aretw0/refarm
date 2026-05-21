import { describe, expect, it } from "vitest";
import { splitCommandLine } from "./command-line.js";

describe("splitCommandLine", () => {
	it("splits simple command lines", () => {
		expect(splitCommandLine("runner -C apps/dev run dev")).toEqual([
			"runner",
			"-C",
			"apps/dev",
			"run",
			"dev",
		]);
	});

	it("supports quotes and escaped spaces", () => {
		expect(splitCommandLine("custom\\ open --profile 'Refarm Dev'")).toEqual([
			"custom open",
			"--profile",
			"Refarm Dev",
		]);
	});

	it("rejects unterminated quotes with the provided label", () => {
		expect(() => splitCommandLine("custom-open 'broken", "REFARM_TEST")).toThrow(
			/Unterminated quote in REFARM_TEST/,
		);
	});
});
