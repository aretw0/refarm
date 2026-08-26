import { mkdtempSync, rmSync } from "node:fs";
import * as os from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	buildCreatedPluginReport,
	type CreatedExtensionReport,
} from "../../src/commands/plugin-scaffold.js";

describe("the scaffold produces something this node can run", () => {
	let cwd: string;
	let homeDir: string;

	beforeEach(() => {
		cwd = mkdtempSync(join(os.tmpdir(), "refarm-plugin-scaffold-cwd-"));
		homeDir = mkdtempSync(join(os.tmpdir(), "refarm-plugin-scaffold-home-"));
	});

	afterEach(() => {
		rmSync(cwd, { recursive: true, force: true });
		rmSync(homeDir, { recursive: true, force: true });
	});

	it("writes a plugin.json, which is what install and the host read", async () => {
		// MEASURED 2026-08-25: the scaffold wrote `ext.json` + `index.js`; no loader consumed
		// them (the host has zero occurrences of `workerEntry`/`executionContext`),
		// `plugin install` could not install that shape, and both live plugins are WASM
		// components. A developer following the documented onboarding produced an artifact the
		// node cannot execute, and found out late.
		const report = (await buildCreatedPluginReport({
			name: "my-tool",
			isGlobal: false,
			cwd,
			homeDir,
		})) as CreatedExtensionReport;

		expect(report.files.some((f) => f.endsWith("plugin.json"))).toBe(true);
	});

	it("says the light track is designed and not built, rather than implying it works", async () => {
		const report = (await buildCreatedPluginReport({
			name: "my-tool",
			isGlobal: false,
			cwd,
			homeDir,
		})) as CreatedExtensionReport;

		expect(report.notice).toMatch(/not (yet )?built|designed/iu);
	});
});
