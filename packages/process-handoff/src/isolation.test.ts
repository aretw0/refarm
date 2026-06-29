import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceDir = fileURLToPath(new URL(".", import.meta.url));

describe("process-handoff package isolation", () => {
	it("does not import the bundled CLI/runtime tier", () => {
		for (const file of readdirSync(sourceDir)) {
			if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
			const source = readFileSync(new URL(file, import.meta.url), "utf-8");

			expect(source.includes("@refarm.dev/cli"), file).toBe(false);
			expect(source.includes("@refarm.dev/homestead"), file).toBe(false);
			expect(source.includes("@refarm.dev/runtime"), file).toBe(false);
			expect(source.includes("@refarm.dev/trust"), file).toBe(false);
			expect(source.includes("@refarm.dev/config"), file).toBe(false);
		}
	});
});
