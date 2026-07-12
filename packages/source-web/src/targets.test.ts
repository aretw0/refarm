import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWebSourceProvider } from "./provider.js";
import {
	loadWebSourceTargets,
	loadWebSourceTargetsSync,
	parseWebSourceTargetsConfig,
	webSourceFixturesFromConfig,
} from "./targets.js";

const CONFIG = {
	targets: [
		{
			identity: "system-a",
			url: "https://example.invalid/a",
			body: "<article data-record='A-1'>Alpha</article>",
			session: { principal: "analyst", credentialRef: "silo://analyst/a" },
		},
		{ identity: "system-b", url: "https://example.invalid/b", body: "<p>Beta</p>" },
	],
};

describe("config-driven web source targets", () => {
	it("builds the identity→snapshot map from config, with defaults filled", () => {
		const fixtures = webSourceFixturesFromConfig(CONFIG);
		expect(Object.keys(fixtures)).toEqual(["system-a", "system-b"]);
		expect(fixtures["system-a"]?.url).toBe("https://example.invalid/a");
		// session merges the declared principal/credentialRef over the fixture defaults.
		expect(fixtures["system-a"]?.session.principal).toBe("analyst");
		expect(fixtures["system-a"]?.session.credentialRef).toBe("silo://analyst/a");
		expect(fixtures["system-a"]?.session.authenticated).toBe(true);
		// pacing/redaction get sane defaults.
		expect(fixtures["system-a"]?.pacing.maxRequestsPerMinute).toBeGreaterThan(0);
		expect(fixtures["system-b"]?.redaction.applied).toBe(true);
	});

	it("discover() lists exactly the configured targets (what THIS user's config declares)", async () => {
		const provider = createWebSourceProvider({ fixtures: webSourceFixturesFromConfig(CONFIG) });
		const catalog = await provider.discover();
		expect(catalog.entries.map((e) => e.ref)).toEqual(["web:system-a", "web:system-b"]);
	});

	it("materializes a configured target's body (round-trips through the provider)", async () => {
		const provider = createWebSourceProvider({
			fixtures: webSourceFixturesFromConfig(CONFIG),
			egress: { allowedHosts: ["example.invalid"] },
		});
		const result = await provider.materialize("web:system-a");
		expect(result.action).toBeDefined();
		const status = await provider.status("web:system-a");
		expect(status).toBeDefined();
	});

	it("rejects a malformed config", () => {
		expect(() => parseWebSourceTargetsConfig({})).toThrow(/expected \{ targets/);
		expect(() => parseWebSourceTargetsConfig({ targets: [{ url: "x" }] })).toThrow(/identity/);
		expect(() => parseWebSourceTargetsConfig({ targets: [{ identity: "a" }] })).toThrow(/url/);
	});
});

describe("loadWebSourceTargets (from a ledger file)", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "refarm-source-targets-"));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("reads the analyst's targets from a .dgk-style config file", async () => {
		const configPath = join(dir, "sources.json");
		await writeFile(configPath, JSON.stringify(CONFIG), "utf-8");
		const fixtures = await loadWebSourceTargets(configPath);
		expect(Object.keys(fixtures)).toEqual(["system-a", "system-b"]);
	});

	it("returns an empty map when no config exists yet (fresh install)", async () => {
		const fixtures = await loadWebSourceTargets(join(dir, "does-not-exist.json"));
		expect(fixtures).toEqual({});
	});

	it("loadWebSourceTargetsSync reads a config file synchronously (startup path)", async () => {
		const configPath = join(dir, "sources.json");
		await writeFile(configPath, JSON.stringify(CONFIG), "utf-8");
		const fixtures = loadWebSourceTargetsSync(configPath);
		expect(Object.keys(fixtures)).toEqual(["system-a", "system-b"]);
		expect(loadWebSourceTargetsSync(join(dir, "missing.json"))).toEqual({});
	});
});
