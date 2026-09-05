import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import * as os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	buildCreatedPluginReport,
	type CreatedExtensionReport,
} from "../../src/commands/plugin-scaffold.js";

// `packages/agent/plugin.json` is the real, worked TEMPLATE: measured 2026-08-26,
// neither it nor `packages/lsp-code-ops/plugin.json` (the other real source manifest)
// carries `entry`/`integrity` — both are injected at install time. That is the shape
// every scaffold must match, not a shape re-derived from the validator (a different
// stage — see the round-2 fix note in plugin-scaffold.ts).
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const AGENT_TEMPLATE_PATH = join(repoRoot, "packages/agent/plugin.json");

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

	// REVIEW ROUND 2 (2026-08-26): round 1's test ran the scaffold's manifest through
	// `decidePluginPolicy` and required it to be ACCEPTED — but that tests the wrong
	// stage. MEASURED: neither real source manifest in this repo
	// (`packages/agent/plugin.json`, `packages/lsp-code-ops/plugin.json`) carries
	// `entry`/`integrity` — both are injected at install time — so `decidePluginPolicy`
	// fails EVERY real source manifest on that same missing field. Round 1's fix
	// (declaring `entry: "index.js"` to satisfy the validator) made the scaffold UNLIKE
	// every real plugin and pointed at a JS file the WASM-only host can never execute.
	// The meaningful guard is instead: does this scaffold's shape match the real
	// template's shape? It fails the moment the scaffold and the real convention drift
	// apart, which is the actual risk.
	it("writes a plugin.json matching the real template's shape (packages/agent/plugin.json), not a schema fiction", async () => {
		const report = (await buildCreatedPluginReport({
			name: "my-tool",
			isGlobal: false,
			cwd,
			homeDir,
		})) as CreatedExtensionReport;

		const pluginJsonPath = report.files.find((f) => f.endsWith("plugin.json"));
		expect(pluginJsonPath).toBeDefined();
		const manifest = JSON.parse(readFileSync(pluginJsonPath!, "utf-8"));
		const template = JSON.parse(readFileSync(AGENT_TEMPLATE_PATH, "utf-8"));

		// Top-level shape parity with the real template — the actual risk this guards is
		// the scaffold and the real convention drifting apart, not schema fiction.
		expect(Object.keys(manifest).sort()).toEqual(Object.keys(template).sort());

		// `capabilities` core: `provides`/`requires` are the universal pair every
		// manifest needs (and the crash `requires: undefined` used to cause). The
		// template's `providesApi`/`requiresApi`/`verbs`/`syncVerbs` are ITS OWN
		// plugin-specific capability surface, not part of the shape a bare scaffold
		// must carry.
		expect(Object.keys(manifest.capabilities).sort()).toEqual(["provides", "requires"]);
		expect(Array.isArray(manifest.capabilities.requires)).toBe(true);
		expect(manifest.capabilities.provides.length).toBeGreaterThan(0);

		// Neither manifest declares entry/integrity — both are injected at install time,
		// not authored here. This is the fact round 1 got wrong.
		expect(manifest.entry).toBeUndefined();
		expect(manifest.integrity).toBeUndefined();
		expect(template.entry).toBeUndefined();
		expect(template.integrity).toBeUndefined();
	});

	// REVIEW ROUND 2, point 3: the acceptance story must be stated plainly, measured
	// rather than assumed — round 1's report claimed a failure mode it never verified
	// against the ACTUAL fixed manifest. `report.notice` is the one place an author
	// reads this before ever running a CLI command, so it carries the measured install
	// story: this manifest cannot be installed until a real WASM component exists.
	it("tells the author, before they try, that plugin install needs a built WASM component first", async () => {
		const report = (await buildCreatedPluginReport({
			name: "my-tool",
			isGlobal: false,
			cwd,
			homeDir,
		})) as CreatedExtensionReport;

		expect(report.notice).toMatch(/build (a )?WASM component/iu);
		expect(report.notice).toMatch(/before[\s\S]*install/iu);
	});
});
