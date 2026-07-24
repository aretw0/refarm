import { describe, expect, it } from "vitest";

import { buildKitManifest, integrityOf } from "./dist.js";

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
});
