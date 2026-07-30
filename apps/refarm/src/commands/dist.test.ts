import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { bakeInstaller, buildKitManifest, collectKitFiles, integrityOf } from "./dist.js";

const KIT_DIR = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../../packages/farm-client",
);

describe("refarm dist — the kit manifest", () => {
	it("integrityOf is SRI-style sha256-<base64> and content-addressed", () => {
		expect(integrityOf("hello")).toMatch(/^sha256-[A-Za-z0-9+/]+=*$/);
		expect(integrityOf("hello")).toBe(integrityOf(Buffer.from("hello")));
		expect(integrityOf("hello")).not.toBe(integrityOf("world"));
	});

	it("buildKitManifest hashes each file, records bytes, and sorts by path", () => {
		const manifest = buildKitManifest(
			[
				{ path: "src/index.mjs", content: Buffer.from("export {}") },
				{ path: "bin/farm-ask.mjs", content: Buffer.from("#!/usr/bin/env node") },
			],
			{ name: "farm-client", version: "0.1.0", createdAt: "2026-07-24T00:00:00.000Z" },
		);
		expect(manifest.name).toBe("farm-client");
		expect(manifest.version).toBe("0.1.0");
		expect(manifest.platform).toBe(null);
		expect(manifest.createdAt).toBe("2026-07-24T00:00:00.000Z");
		// sorted by path so the device's diff is stable: bin/ before src/
		expect(manifest.files.map((f) => f.path)).toEqual(["bin/farm-ask.mjs", "src/index.mjs"]);
		const index = manifest.files.find((f) => f.path === "src/index.mjs");
		expect(index?.integrity).toBe(integrityOf("export {}"));
		expect(index?.bytes).toBe(Buffer.from("export {}").length);
	});

	it("is deterministic — same inputs, same manifest (the farm-update diff relies on it)", () => {
		const files = [{ path: "src/a.mjs", content: Buffer.from("a") }];
		const meta = { name: "farm-client", version: "0.1.0", createdAt: "2026-07-24T00:00:00.000Z" };
		expect(buildKitManifest(files, meta)).toEqual(buildKitManifest(files, meta));
	});

	it("bakeInstaller substitutes the farm host + port into the installer template", () => {
		const template = 'const HOST = process.env.FARM_HOST || "__FARM_HOST__";\nconst PORT = Number("__FARM_PORT__");';
		const baked = bakeInstaller(template, { host: "serpro-1577853", port: 4321 });
		expect(baked).toContain('|| "serpro-1577853"');
		expect(baked).toContain('Number("4321")');
		expect(baked).not.toContain("__FARM_HOST__");
		expect(baked).not.toContain("__FARM_PORT__");
	});

	it("bakeInstaller with an empty host leaves the installer requiring FARM_HOST", () => {
		const baked = bakeInstaller('x || "__FARM_HOST__"', { host: "", port: 4321 });
		expect(baked).toBe('x || ""');
	});
});

describe("refarm dist — what actually reaches the device", () => {
	it("distributes the vendored prompt block, so the kit that ASKS is the kit that installs", async () => {
		const files = await collectKitFiles(KIT_DIR);
		const paths = files.map((f) => f.path);
		// The kit is zero-dependency: nothing to INSTALL on the phone. The prompt
		// block therefore travels INSIDE the kit — and a carried file that is not
		// distributed is a wizard that never reaches the device.
		expect(paths).toContain("vendor/prompt-contract-v1.mjs");
		expect(paths).toContain("src/ask-host.mjs");
		expect(paths).toContain("src/shims.mjs");
	});

	it("manifest + sha256 cover EVERY distributed file, vendored block included", async () => {
		const files = await collectKitFiles(KIT_DIR);
		const manifest = buildKitManifest(files, {
			name: "farm-client",
			version: "0.1.0",
			createdAt: "2026-07-30T00:00:00.000Z",
		});
		expect(manifest.files.length).toBe(files.length);
		for (const file of files) {
			const entry = manifest.files.find((f) => f.path === file.path);
			expect(entry, `${file.path} is served but not in the manifest`).toBeDefined();
			expect(entry?.integrity).toBe(integrityOf(file.content));
			expect(entry?.bytes).toBe(file.content.length);
		}
		const vendored = manifest.files.find((f) => f.path === "vendor/prompt-contract-v1.mjs");
		expect(vendored?.integrity).toMatch(/^sha256-/);
		expect(vendored?.bytes).toBeGreaterThan(0);
	});
});
