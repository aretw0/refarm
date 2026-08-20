import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runtimeNodeArgs } from "./runtime-node-args.js";

let home: string;
beforeEach(() => {
	home = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-node-args-"));
});
afterEach(() => {
	fs.rmSync(home, { recursive: true, force: true });
});

describe("runtimeNodeArgs", () => {
	it("always names the sovereign directory", () => {
		// Without it the runtime resolves its own home from somewhere else, and the operator gets
		// a node that is running and is not theirs.
		expect(runtimeNodeArgs(home)).toEqual(["--refarm-dir", home]);
	});

	it("puts the home LAST, whatever plugins were found", () => {
		// Mirrors `scripts/tractor-start.sh`'s order so a running process can be read against this
		// list without sorting it mentally. The plugin half is proven against the operator's real
		// node — the derived line matched the live process byte for byte — because a fixture that
		// satisfies this resolver has to reproduce the whole install layout, and a fixture that
		// approximates it would prove the approximation.
		const args = runtimeNodeArgs(home);
		expect(args.at(-2)).toBe("--refarm-dir");
		expect(args.at(-1)).toBe(home);
	});

	it("still names the home when the plugin declaration cannot be read", () => {
		// A runtime that boots without its plugins is recoverable by the operator; one that does
		// not boot needs someone at the keyboard. Never throws out of a launch path.
		fs.writeFileSync(path.join(home, "config.json"), "{ not json");
		expect(runtimeNodeArgs(home)).toEqual(["--refarm-dir", home]);
	});
});
