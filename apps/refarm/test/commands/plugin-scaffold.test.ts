import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import * as os from "node:os";
import { join } from "node:path";
import { decidePluginPolicy } from "@refarm.dev/plugin-manifest";
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

	// REVIEW ROUND 1, CRITICAL 1 (2026-08-26): the manifest this scaffold wrote could not
	// be installed — `decidePluginPolicy` (the function BOTH `plugin review` and `plugin
	// install` call first, verified by reading plugin-review-capability.ts /
	// plugin-install-from-path.ts) returned `invalid-manifest`, crashing on
	// `hasDuplicates(manifest.capabilities.requires)` because `requires` was never set,
	// and — even past that — missing `entry`, a non-empty `capabilities.provides`,
	// `certification`, and the 5 `observability.hooks` `validatePluginManifest`
	// (packages/plugin-manifest/src/validate.js) unconditionally demands. This is the ONE
	// test the reviewer asked for by name: run the scaffold's ACTUAL on-disk `plugin.json`
	// through the SAME validator/policy path install uses, on the real written bytes (not
	// a hand-built stand-in), and assert it is genuinely accepted.
	it("writes a plugin.json that decidePluginPolicy — the gate both review and install call first — actually accepts", async () => {
		const report = (await buildCreatedPluginReport({
			name: "my-tool",
			isGlobal: false,
			cwd,
			homeDir,
		})) as CreatedExtensionReport;

		const pluginJsonPath = report.files.find((f) => f.endsWith("plugin.json"));
		expect(pluginJsonPath).toBeDefined();
		const manifest = JSON.parse(readFileSync(pluginJsonPath!, "utf-8"));

		const decision = decidePluginPolicy(manifest, { grantedCapabilities: [], policyMode: "fail-fast" });

		expect(decision.manifestErrors).toEqual([]);
		expect(decision.manifestValid).toBe(true);
		expect(decision.status).toBe("completed");
	});
});
