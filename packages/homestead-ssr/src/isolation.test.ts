import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceDir = fileURLToPath(new URL(".", import.meta.url));

describe("homestead ssr package isolation", () => {
	it("does not import the bundled homestead runtime/sdk tier", () => {
		for (const file of readdirSync(sourceDir)) {
			if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
			const source = readFileSync(new URL(file, import.meta.url), "utf-8");

			expect(source.includes("@refarm.dev/homestead"), file).toBe(false);
			expect(source.includes("../sdk"), file).toBe(false);
			expect(source.includes("custom-element"), file).toBe(false);
			expect(source.includes("@refarm.dev/runtime"), file).toBe(false);
			expect(source.includes("@refarm.dev/tractor"), file).toBe(false);
			expect(source.includes("@refarm.dev/storage-sqlite"), file).toBe(false);
			expect(source.includes("@refarm.dev/sync-loro"), file).toBe(false);
			expect(source.includes("astro"), file).toBe(false);
		}
	});

	it("stays browser-safe (no Node built-in imports) so helpers run client-side too", () => {
		for (const file of readdirSync(sourceDir)) {
			if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
			const source = readFileSync(new URL(file, import.meta.url), "utf-8");

			// The render/shell helpers are isomorphic: a consumer may serve dist/
			// to the browser and call the same helpers client-side. That only holds
			// while the source imports no Node built-ins.
			expect(/from\s+["']node:/.test(source), file).toBe(false);
			expect(/require\(\s*["']node:/.test(source), file).toBe(false);
		}
	});
});
