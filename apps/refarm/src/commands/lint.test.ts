import type { LintFilesReport } from "@refarm.dev/quality-contract-v1/node";
import { describe, expect, it } from "vitest";

import { createLintCommand } from "./lint.js";

/** A fake report so the command is tested without touching disk. */
function fakeReport(worstVerdict: LintFilesReport["worstVerdict"]): LintFilesReport {
	return {
		files: [{ path: "a.md", kind: "prose", findings: [], verdict: worstVerdict, tellsPerThousandWords: 0 }],
		findings: [],
		counts: {},
		worstVerdict,
	};
}

describe("refarm lint command", () => {
	it("lints the passed paths (not the default set) when paths are given", () => {
		let seen: string[] = [];
		const cmd = createLintCommand({ run: (files) => ((seen = files), fakeReport("human")), listDefault: () => ["DEFAULT"] });
		cmd.parse(["node", "lint", "x.md", "y.css"], { from: "node" });
		expect(seen).toEqual(["x.md", "y.css"]);
	});

	it("falls back to the default file set when no paths are given", () => {
		let seen: string[] = [];
		const cmd = createLintCommand({ run: (files) => ((seen = files), fakeReport("human")), listDefault: () => ["tracked.md"] });
		cmd.parse(["node", "lint"], { from: "node" });
		expect(seen).toEqual(["tracked.md"]);
	});

	it("--fail-on sets a non-zero exit code when the worst verdict reaches the threshold", () => {
		process.exitCode = 0;
		const cmd = createLintCommand({ run: () => fakeReport("likely-ai"), listDefault: () => [] });
		cmd.parse(["node", "lint", "--fail-on", "uncertain"], { from: "node" });
		expect(process.exitCode).toBe(1);
		process.exitCode = 0; // reset for other tests
	});

	it("--fail-on stays zero when the worst verdict is below the threshold", () => {
		process.exitCode = 0;
		const cmd = createLintCommand({ run: () => fakeReport("likely-human"), listDefault: () => [] });
		cmd.parse(["node", "lint", "--fail-on", "ai"], { from: "node" });
		expect(process.exitCode).toBe(0);
	});
});
