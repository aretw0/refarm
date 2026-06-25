import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("ssr tier isolation", () => {
	it("no ssr source imports ../sdk or browser-runtime modules", () => {
		const dir = fileURLToPath(new URL("./", import.meta.url));

		for (const file of readdirSync(dir)) {
			if (!file.endsWith(".ts") || file.endsWith(".test.ts")) {
				continue;
			}

			const source = readFileSync(`${dir}${file}`, "utf8");

			expect(source.includes("../sdk"), `${file} must not import ../sdk`).toBe(
				false,
			);
			expect(
				/from\s+["'][^"']*custom-element/.test(source),
				`${file} must not import custom-element`,
			).toBe(false);
		}
	});
});
