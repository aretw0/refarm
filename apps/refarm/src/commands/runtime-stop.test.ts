/**
 * ISS-053. `runtime-stop.ts` read its pid file with a bare `Number.parseInt` plus a finiteness
 * check, which is lenient in exactly the way that matters here: `parseInt("123abc", 10)` is `123`.
 * A truncated or corrupted pid file was therefore accepted as a plausible pid — and the next thing
 * this module does with a pid is send it a signal.
 *
 * `scripts/refarm-sandbox.mjs` had already been fixed for this and carries the pattern in a comment;
 * porting it is the whole change. The guard lives in an exported pure function for the same reason
 * the launcher's does: it is provable without a filesystem.
 */
import { describe, expect, it } from "vitest";

import { parseRuntimePid } from "./runtime-stop.js";

describe("parseRuntimePid (ISS-053)", () => {
	it("accepts a pid file refarm itself wrote", () => {
		expect(parseRuntimePid("2025451")).toBe(2025451);
		expect(parseRuntimePid("  2025451\n")).toBe(2025451);
	});

	it("REFUSES a truncated file that parseInt would have accepted", () => {
		// The defect, stated as its input: parseInt("123abc", 10) === 123.
		expect(parseRuntimePid("123abc")).toBeNull();
	});

	it("refuses a decimal, which parseInt would silently floor", () => {
		expect(parseRuntimePid("3.5")).toBeNull();
	});

	it("refuses emptiness, whitespace and a negative", () => {
		expect(parseRuntimePid("")).toBeNull();
		expect(parseRuntimePid("   ")).toBeNull();
		expect(parseRuntimePid("-1")).toBeNull();
	});

	it("refuses zero — pid 0 is not a process this may signal", () => {
		expect(parseRuntimePid("0")).toBeNull();
	});
});
